const fs = require("fs");
const Queue = require("promise-queue");

const { Socket } = require("./socket.js");
const { Panel } = require("./panel");
const { Service } = require("./service.js");
const { Tunnel } = require("./tunnel.js");
const { Worker } = require("./worker.js");
const { PortAssigner } = require("./ports.js");

const RELOAD_WAIT_TIME = 10000;
const PORT_MIN = 18000;
const PORT_MAX = 18500;

class Manager {
  constructor(config) {
    this.config = config;
    this.socket = new Socket(config);
    this.panel = new Panel(config);
    this.tunnel = new Tunnel(config);

    this.port_assigner = new PortAssigner(PORT_MIN, PORT_MAX);
    this.workers = new Set();
    this.services = new Set();
    this.errored_services = new Set();
    this.pairs = new Set();

    this.reload_timeout = null;
    this.reload_pipe = new Queue(1, Infinity);

    this.init_promise = new Promise(res => {
      this.init_resolve = res;
    });

    this.stopping = false;
  }

  async start() {
    // 1. Load all available services
    const dirs = fs.readdirSync("./services", { "withFileTypes": true })
                   .filter(s => s.isDirectory())
                   .map(s => s.name);

    for (const dir of dirs) {
      if (!fs.existsSync("./services/" + dir + "/gxlg-cluster.json")) {
        continue;
      }
      this.load_service(dir);
    }

    // 2. Set up communication
    this.socket.receive("register_worker", w => this.register_worker(w));
    this.socket.receive("unregister_worker", w => this.unregister_worker(w));
    this.socket.receive(
      "error_service",
      n => this.error_service(this.find_service(n))
   );

    this.panel.receive("query_services", () => this.query_services());
    this.panel.receive(
      "restart_service",
      n => this.restart_service(this.find_service(n))
    );
    this.panel.receive("add_service", s => this.load_service(s));
    this.panel.receive(
      "remove_service",
      n => this.remove_service(this.find_service(n))
    );
    this.panel.receive("query_workers", () => this.query_workers());
    this.panel.receive(
      "identify_worker",
      id => this.find_worker(id).identify()
    );
    this.panel.receive(
      "shutdown_worker",
      id => this.find_worker(id).shutdown()
    );

    this.tunnel.receive("schedule_reload", () => this.schedule_reload());

    // 3. Boot everything up
    await this.tunnel.init();
    await this.socket.start();
    await this.panel.start();

    // schedule initial reload
    this.schedule_reload();
    this.init_resolve();
  }

  // Receiver
  async register_worker(worker) {
    this.workers.add(worker);
    this.schedule_reload();
  }

  // Receiver
  async unregister_worker(worker) {
    this.workers.delete(worker);
    this.schedule_reload();
  }

  // Receiver
  async schedule_reload() {
    this.reload_pipe.add(() => {
      clearTimeout(this.reload_timeout);
      if (this.stopping) return;
      this.reload_timeout = setTimeout(() => this.reload(), RELOAD_WAIT_TIME);
    });
  }

  async reload() {
    console.log("Reloading");

    // pairing algorithm
    const services = this.get_active_services();
    const workers = new Set(this.workers);

    const total_ram = services.values()
      .reduce((acc, s) => acc + s.config.ram, 0);
    const worker_ram = this.config.worker.ram;
    const avg_load = total_ram / workers.size;

    const ram_groups = { };
    for (const worker of workers) {
      ram_groups[worker.id] = 0;
    }

    const pairs = new Set(this.pairs);

    for (const service of services) {
      const ram = service.config.ram;
      const assigned_pair = pairs.values().find(p => p.service == service);
      const assigned_worker = assigned_pair?.worker;
      let best_worker = null;
      let min_move = Infinity;
      let min_devia = Infinity;
      for (const worker of workers) {
        const new_total = ram_groups[worker.id] + ram;
        if (new_total > worker_ram) {
          continue;
        }
        const devia = new_total - avg_load;

        let move;
        if (assigned_worker == worker) {
          move = 0;
        } else if (assigned_worker == null) {
          move = 1;
        } else {
          move = 2;
        }
        if (move < min_move || (move == min_move && devia < min_devia)) {
          min_move = move;
          min_devia = devia;
          best_worker = worker;
        }
      }
      if (assigned_worker != best_worker) {
        if (assigned_worker != null) {
          // stop service on old worker
          await assigned_worker.stop_service(service);
          pairs.delete(assigned_pair);
        }
        if (best_worker != null) {
          // start service on new worker
          await best_worker.start_service(service);
          pairs.add({ "worker": best_worker, service });
        }
      }
      if (best_worker != null) {
        ram_groups[best_worker.id] += ram;
      }
    }
    // stop abandoned services
    const final_pairs = new Set();
    for (const { service, worker } of pairs) {
      if (this.services.has(service)) {
        final_pairs.add({ service, worker });
      } else {
        await worker.stop_service(service);
      }
    }
    this.pairs = final_pairs;
    await this.tunnel.restart(this.pairs);
  }

  get_active_services() {
    return this.services.difference(this.errored_services);
  }

  // Receiver
  load_service(name) {
    this.services.add(new Service(name, this.port_assigner));
    this.schedule_reload();
  }

  // Receiver
  async restart_service(service) {
    const assigned_worker = this.pairs.values()
      .find(p => p.service == service)?.worker;

    if (assigned_worker != null) {
      await assigned_worker.stop_service(service);
      service.reload();
      this.errored_services.delete(service);
      await assigned_worker.start_service(service);
    }

    this.schedule_reload();
  }

  // Receiver
  remove_service(service) {
    service.unregister();
    this.services.delete(service);
    this.errored_services.delete(service);
    this.schedule_reload();
  }

  // Receiver
  error_service(service) {
    service.unregister();
    this.errored_services.add(service);
    this.schedule_reload();
  }

  // Receiver
  query_services() {
    return this.services.values().map(s => {
      const assigned_worker = this.pairs.values()
        .find(p => p.service == s)?.worker;

      let status = 0;
      if (this.errored_services.has(s)) {
        status = 2;
      } else if (assigned_worker != null) {
        status = 1;
      }

      return {
        "record": s.config.record,
        "port": s.port,
        "name": s.name,
        "ram": s.config.ram,
        "worker": assigned_worker?.id,
        "status": status
      };
    }).toArray();
  }

  // Receiver
  async query_workers() {
    const ws = [];
    for (const w of this.workers) {
      const services = this.pairs.values()
        .filter(p => p.worker == w).map(p => p.service).toArray();
      const ram = services.reduce((acc, s) => acc + s.config.ram, 0);
      const names = services.map(s => s.name);
      const temp = await w.temp();

      ws.push({
        "id": w.id,
        "ip": w.ip,
        "ram": ram,
        "services": names,
        "temp": temp
      });
    };
    return ws;
  }

  find_service(name) {
    return this.services.values().find(s => s.name == name);
  }

  find_worker(id) {
    return this.workers.values().find(w => w.id == id);
  }

  async stop() {
    this.reload_pipe.add(() => {
      clearTimeout(this.reload_timeout);
      this.stopping = true;
    });

    await this.init_promise;
    await this.tunnel.stop();
    await this.panel.close();
    await this.socket.stop();
  }
}

module.exports = { Manager };
