const { main, worker } = require("../common-lib/config.js");
const { setup_service, services, update_service } = require("./services.js");
const { switch_tunnels } = require("./tunnels.js");

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

server.on("connection", socket => {
  workers[socket.id] = {
    socket,
    "services": [],
    "ip": socket.handshake.address
  };
  schedule_relay();

  socket.on("disconnect", () => {
    for (const service of workers[socket.id].services) {
      delete services_map[service.name];
      if (service_status[service.name] != 3)
        service_status[service.name] = 0;
    }
    delete workers[socket.id];
    schedule_relay();
  });

  // status handling
  socket.on("status", (service, status) => {
    service_status[service] = status;
  });
});

let current_timeout = null;
function schedule_relay() {
  clearTimeout(current_timeout);
  current_timeout = setTimeout(relay, 5000);
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
  let need_change_tunnels = false;
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
        const { socket } = workers[oldw];
        if (socket.connected) {
          socket.emit("stop", service.name);
          await new Promise(r => socket.once("stopped-" + service.name, r));
          service_status[service.name] = 0;
        }
      }
    }

    if (best_worker != null) {
      new_workers[best_worker].services.push(service);
      // start service on new worker
      if (oldw != best_worker) {
        workers[best_worker].socket.emit("start", service.name, service.port);
        services_map[service.name] = best_worker;
        if (service.port && service_last_worker[service.name] != best_worker)
          need_change_tunnels = true;
        service_last_worker[service.name] = best_worker;
      }
    } else {
      delete services_map[service.name];
    }
  }
  for (const wid in workers) {
    workers[wid].services = new_workers[wid].services;
  }
  if (need_change_tunnels) await switch_tunnels();
}

async function stop() {
  // TODO: point all records to a static website

  for (const service of services) {
    const worker = services_map[service.name];
    if (!worker) continue;
    const { socket } = workers[worker];
    socket.emit("stop", service.name);
    await new Promise(r => socket.once("stopped-" + service.name, r));
    delete services_map[service.name];
  }
  server.close();
}

// API endpoints

async function restart(name) {
  const worker = services_map[name];
  if (worker) {
    const { socket } = workers[worker];
    socket.emit("stop", name);
    await new Promise(r => socket.once("stopped-" + name, r));
    delete services_map[name];
  }
  update_service(name);
  service_status[name] = 0;
  schedule_relay();
}

function add_service(name) {
  const service = setup_service(name);
  services.push(service);
  service_status[name] = 0;
  schedule_relay();
}

function identify_worker(id) {
  workers[id].socket.emit("identify");
}

async function shutdown_worker(id) {
  const { socket, services } = workers[id];
  for (const service of services) {
    socket.emit("stop", service.name);
    await new Promise(r => socket.once("stopped-" + service.name, r));
    delete services_map[service.name];
  }
  socket.emit("shutdown");
}

module.exports = {
  workers, services_map, service_status,
  stop,
  add_service, restart,
  identify_worker, shutdown_worker
};
