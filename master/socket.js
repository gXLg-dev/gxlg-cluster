const { Server } = require("socket.io");

const { Worker } = require("./worker.js");
const { Simplex } = require("./simplex.js");

const SYNC_TIME = 60000;

class Socket extends Simplex {
  constructor(config) {
    super();

    const { master, worker } = config;

    this.server = new Server(master.port, {
      "cors": { "origin": "*" }
    });

    this.sync_interval = null;
  }

  async start() {
    this.server.on("connection", async socket => {
      let id;
      try {
        id = await socket.timeout(5000).emitWithAck("whoareyou");
      } catch (e) {
        socket.disconnect(true);
        return;
      }
      console.log("Connected:", id);
      const ip = socket.handshake.address;
      const worker = new Worker(id, ip, socket);
      socket.on("disconnect", () => {
        console.log("Disconnected:", id);
        this.send("unregister_worker", worker);
      });
      socket.on(
        "error_service",
        sn => this.send("error_service", sn)
      );

      await this.send("register_worker", worker);
    });

    this.sync_interval = setInterval(
      () => this.server.emit("sync", Date.now()),
      SYNC_TIME
    );
  }

  async stop() {
    clearInterval(this.sync_interval);
    await new Promise(r => this.server.close(r));
  }

}

module.exports = { Socket };
