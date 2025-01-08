const { main, worker } = require("../common-lib/config.js");
const { setup_service, services, update_service } = require("./services.js");
const { restart_tunnel } = require("./tunnels.js");

const EventEmitter = require("node:events");
const Queue = require("promise-queue");
const { Server } = require("socket.io");

const server = new Server(main.port, {
  "cors": { "origin": "*" }
});

// worker-id: { socket, services (currently running), ip }
const workers = {};
// service-name: worker-id
const services_map = {};
// service name: status
// (0: stopped, 1: installing dependencies, 2: stopping, 3: error, 4: running)
const service_status = {};
for (const { name } of services) {
  service_status[name] = 0;
}
// easier for tunnel updates
const service_last_worker = {};

const statusEmitter = new EventEmitter();
async function poll() {
  await new Promise(r => statusEmitter.once("update", r));
}

const q = new Queue(1, Infinity);
function enqueue(type, data) {
  if (type == "start") {
    const { worker, service } = data;
    q.add(async () => {
      console.log("starting", service.name);
      while (service_status[service.name] != 0) await poll();
      if (worker.socket.connected) {
        worker.socket.emit("start", service.name, service.port);
        services_map[service.name] = worker.id;
        while (![3,4].includes(service_status[service.name])) await poll();
      }
    });
  } else if (type == "stop") {
    const { worker, service } = data;
    q.add(async () => {
      console.log("stopping", service.name);
      if (worker) {
        if (worker.socket.connected) worker.socket.emit("stop", service.name);
        while (![0, 3].includes(service_status[service.name])) await poll();
      } else {
        service_status[service.name] = 0;
      }
      delete services_map[service.name];
    });
  } else if (type == "delete") {
    const { id } = data;
    q.add(() => {
      console.log("deleting", id);
      if (id in workers && workers[id].socket.connected) workers[id].socket.emit("shutdown");
      delete workers[id];
    });
  } else if (type == "exit") {
    const { res } = data;
    q.add(() => {
      console.log("exitting");
      server.close();
      res();
    });
  } else if (type == "relay") {
    const { last } = data;
    q.add(async () => {
      console.log("relaying");
      if (last_relay == last) await relay();
      else console.log("dequeue relay");
    });
  } else if (type == "restart") {
    const { last } = data;
    q.add(async () => {
      console.log("restarting tunnel");
      if (last_restart == last) await restart_tunnel();
      else console.log("dequeue restart");
    });
  } else if (type == "shutdown") {
    const { worker } = data;
    q.add(async () => {
      worker.socket.emit("shutdown");
    });
  }
}

server.on("connection", async socket => {
  const id = await new Promise(r => {
    socket.emit("whoareyou");
    socket.once("iam", name => r(name));
  });
  console.log("connected:", id);

  if (!(id in workers)) {
    workers[id] = { id, socket, "services": [], "ip": socket.handshake.address };
  }
  schedule_relay();

  socket.on("disconnect", () => {
    console.log("disconnected:", id);
    for (const service of workers[id].services) {
      enqueue("stop", { service });
    }
    enqueue("delete", { id });
    schedule_relay();
  });

  socket.on("status", (service, status) => {
    service_status[service] = status;
    console.log("status", service, status);
    statusEmitter.emit("update");

    if (status == 3) {
      const sr = services.find(s => s.name == service);
      enqueue("stop", { "service": sr });
      schedule_relay();
    }
  });
});

let last_relay = null;
function schedule_relay() {
  last_relay = {};
  setTimeout(() => enqueue("relay", { "last": last_relay }), 5000);
}
let last_restart = null;
function schedule_restart() {
  last_restart = {};
  enqueue("restart", { "last": last_restart });
}

function ram_sum(services) {
  return services.reduce((acc, b) => (acc + b.ram), 0);
}

async function relay() {
  const g = worker.ram;
  const avg_load = ram_sum(services) / Object.keys(workers).length;
  const new_workers = {};
  for (const wid in workers) {
    new_workers[wid] = { "services": [] };
  }
  let need_restart_tunnel = false;
  for (const service of services) {
    // if error: skip this service, assume it's stopped
    if (service_status[service.name] == 3) continue;

    let best_worker = null;
    let min_move = Infinity;
    let min_devia = Infinity;
    for (const wid in workers) {
      const total = ram_sum(new_workers[wid].services) + service.ram;
      if (total > g) continue;

      let move;
      if (workers[wid].services.includes(service)) {
        move = 0;
      } else if (!(service.name in services_map)) {
        move = 1;
      } else {
        move = 2;
      }
      const devia = total - avg_load;
      if ((move < min_move) || (move == min_move && devia < min_devia)) {
        min_move = move;
        min_devia = devia;
        best_worker = wid;
      }
    }
    // stop service on old worker
    const oldw = services_map[service.name];
    if (service.name in services_map) {
      if (oldw != best_worker && oldw in workers) {
        enqueue("stop", { "worker": workers[oldw], service });
      }
    }

    if (best_worker != null) {
      new_workers[best_worker].services.push(service);
      // start service on new worker
      if (oldw != best_worker) {
        console.log("enqueue(" + service.name + ")");
        enqueue("start", { "worker": workers[best_worker], service });

        if (service.port && service_last_worker[service.name] != best_worker)
          need_restart_tunnel = true;
        service_last_worker[service.name] = best_worker;

      }
    }
  }
  for (const wid in workers) {
    workers[wid].services = new_workers[wid].services;
  }
  if (need_restart_tunnel) schedule_restart();
}

async function stop() {
  for (const service of services) {
    enqueue("stop", { service, "worker": workers[services_map[service.name]] });
  }
  await new Promise(res => enqueue("exit", { res }));
}

// API endpoints

async function restart(name) {
  update_service(name);
  if (service_status[name] == 3) {
    service_status[name] = 0;
  } else {
    const worker = workers[services_map[name]];
    const service = services.find(s => s.name == name);
    enqueue("stop", { worker, service });
  }
  schedule_relay();
}

function add_service(name) {
  const service = setup_service(name);
  services.push(service);
  service_status[name] = 0;
  schedule_relay();
}

function identify_worker(id) {
  workers[id]?.socket.emit("identify");
}

async function shutdown_worker(id) {
  const worker = workers[id];
  for (const service of worker.services) {
    enqueue("stop", { service, worker });
  }
  enqueue("shutdown", { worker });
}

module.exports = {
  workers, services_map, service_status,
  schedule_restart,
  stop,
  add_service, restart,
  identify_worker, shutdown_worker
};
