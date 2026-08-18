const fs = require("fs");

const { Socket } = require("./socket.js");
const { Panel } = require("./panel");
const { Service } = require("./service.js");
const { Tunnel } = require("./tunnel.js");
const { Worker } = require("./worker.js");
const { PortAssigner } = require("./ports.js");
const { createLock, synchro } = require("./synchro.js");

const RELOAD_WAIT_TIME = 10000;
const PORT_MIN = 18000;
const PORT_MAX = 18500;

class Manager {
  constructor(config, io) {
    this.config = config;
    this.logger = io.loggerFor("manager");

    this.socket = new Socket(config, io);
    this.panel = new Panel(config, io);
    this.tunnel = new Tunnel(config, io);

    this.portAssigner = new PortAssigner(PORT_MIN, PORT_MAX);
    this.workers = new Set();
    this.services = new Set();
    this.erroredServices = new Set();
    this.pairs = new Set();

    this.reloadTimeout = null;
    this.stopping = false;
    this.reloadLock = createLock();
    this.scheduleLock = createLock();

    this.initPromise = new Promise(res => {
      this.initResolve = res;
    });
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
      await this.loadService(dir);
    }

    // 2. Set up communication
    this.socket.receive("register_worker", w => this.registerWorker(w));
    this.socket.receive("unregister_worker", w => this.unregisterWorker(w));
    this.socket.receive(
      "error_service",
      n => this.errorService(this.findService(n))
   );

    this.panel.receive("query_services", () => this.queryServices());
    this.panel.receive("query_status", () => this.queryStatus());
    this.panel.receive(
      "restart_service",
      n => this.restartService(this.findService(n))
    );
    this.panel.receive("add_service", s => this.loadService(s));
    this.panel.receive(
      "remove_service",
      n => this.removeService(this.findService(n))
    );
    this.panel.receive("query_workers", () => this.queryWorkers());
    this.panel.receive(
      "identify_worker",
      id => this.findWorker(id).identify()
    );
    this.panel.receive(
      "shutdown_worker",
      id => this.findWorker(id).shutdown()
    );

    this.tunnel.receive("schedule_reload", () => this.scheduleReload());

    // 3. Boot everything up
    await this.tunnel.init();
    await this.socket.start();
    await this.panel.start();

    // schedule initial reload
    this.scheduleReload();
    this.initResolve();
  }

  // Receiver
  async registerWorker(worker) {
    await synchro(this.reloadLock)(async () => {
      this.workers.add(worker);
      this.scheduleReload();
    });
  }

  // Receiver
  async unregisterWorker(worker) {
    await synchro(this.reloadLock)(async () => {
      this.workers.delete(worker);
      this.scheduleReload();
    });
  }

  // Receiver
  async scheduleReload() {
    await synchro(this.scheduleLock)(async () => {
      await this.logger.log("Scheduling reload...");
      clearTimeout(this.reloadTimeout);
      if (this.stopping) return;
      this.reloadTimeout = setTimeout(() => this.reload(), RELOAD_WAIT_TIME);
    });
  }

  async reload() {
    await synchro(this.reloadLock)(async () => {
      await this.logger.log("Reloading...");

      // pairing algorithm
      const services = this.getActiveServices();
      const workers = new Set(this.workers);

      const totalRam = services.values()
        .reduce((acc, s) => acc + s.config.ram, 0);
      const workerRam = this.config.worker.ram;
      const avgLoad = totalRam / workers.size;

      const ramGroups = { };
      for (const worker of workers) {
        ramGroups[worker.id] = 0;
      }

      const pairs = new Set(this.pairs);

      for (const service of services) {
        const ram = service.config.ram;
        const assignedPair = pairs.values().find(p => p.service == service);
        const assignedWorker = assignedPair?.worker;
        let bestWorker = null;
        let minMove = Infinity;
        let minDevia = Infinity;
        for (const worker of workers) {
          const newTotal = ramGroups[worker.id] + ram;
          if (newTotal > workerRam) {
            continue;
          }
          const devia = newTotal - avgLoad;

          let move;
          if (assignedWorker == worker) {
            move = 0;
          } else if (assignedWorker == null) {
            move = 1;
          } else {
            move = 2;
          }
          if (move < minMove || (move == minMove && devia < minDevia)) {
            minMove = move;
            minDevia = devia;
            bestWorker = worker;
          }
        }
        if (assignedWorker != bestWorker) {
          if (assignedWorker != null) {
            // stop service on old worker
            await this.logger.log("Stopping", service.name, "on", assignedWorker.id, "...");
            await assignedWorker.stopService(service);
            await this.logger.log(service.name, "stopped");
            pairs.delete(assignedPair);
          }
          if (bestWorker != null) {
            // start service on new worker
            await this.logger.log("Starting", service.name, "on", bestWorker.id, "...");
            await bestWorker.startService(service);
            await this.logger.log(service.name, "started");
            pairs.add({ "worker": bestWorker, service });
          }
        }
        if (bestWorker != null) {
          ramGroups[bestWorker.id] += ram;
        }
      }
      // stop abandoned services
      const finalPairs = new Set();
      for (const { service, worker } of pairs) {
        if (services.has(service)) {
          finalPairs.add({ service, worker });
        } else {
          await worker.stopService(service);
        }
      }
      this.pairs = finalPairs;
      await this.tunnel.restart(this.pairs);

      await this.logger.log("Reloading complete!");
    });
  }

  getActiveServices() {
    return this.services.difference(this.erroredServices);
  }

  // Receiver
  async loadService(name) {
    await synchro(this.reloadLock)(async () => {
      this.services.add(new Service(name, this.portAssigner));
      this.scheduleReload();
    });
  }

  // Receiver
  async restartService(service) {
    await synchro(this.reloadLock)(async () => {
      const assignedWorker = this.pairs.values()
        .find(p => p.service == service)?.worker;

      if (assignedWorker != null) {
        await assignedWorker.stopService(service);
        service.reload();
        await assignedWorker.startService(service);
      } else {
        service.reload();
      }
      this.erroredServices.delete(service);
      this.scheduleReload();
    });
  }

  // Receiver
  async removeService(service) {
    await synchro(this.reloadLock)(async () => {
      service.unregister();
      this.services.delete(service);
      this.erroredServices.delete(service);
      this.scheduleReload();
    });
  }

  // Receiver
  async errorService(service) {
    await synchro(this.reloadLock)(async () => {
      await this.logger.log("Error in service", service.name);
      service.unregister();
      this.erroredServices.add(service);
      this.scheduleReload();
    });
  }

  // Receiver
  queryServices() {
    return this.services.values().map(s => {
      const assignedWorker = this.pairs.values()
        .find(p => p.service == s)?.worker;

      let status = 0;
      if (this.erroredServices.has(s)) {
        status = 2;
      } else if (assignedWorker != null) {
        status = 1;
      }

      return {
        "record": s.config.record,
        "port": s.port,
        "name": s.name,
        "ram": s.config.ram,
        "worker": assignedWorker?.id,
        "status": status
      };
    }).toArray();
  }

  // Receiver
  queryStatus() {
    const active = this.services.difference(this.erroredServices).size;
    const errors = this.erroredServices.size;
    const workers = this.workers.size;
    return { active, errors, workers };
  }

  // Receiver
  async queryWorkers() {
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

  findService(name) {
    return this.services.values().find(s => s.name == name);
  }

  findWorker(id) {
    return this.workers.values().find(w => w.id == id);
  }

  async stop() {
    await this.logger.log("Shutting down...");

    await synchro(this.scheduleLock)(() => {
      clearTimeout(this.reloadTimeout);
      this.stopping = true;
    });

    await this.initPromise;
    await this.tunnel.stop();
    await this.panel.close();
    await this.socket.stop();
  }
}

module.exports = { Manager };
