const os = require("os");
const fs = require("fs");
const axios = require("axios");
const { spawn } = require("child_process");

const { Simplex } = require("./simplex.js");
const { CloudflareAPI } = require("./cloudflare.js");
const { IngressGenerator } = require("./ingress.js");
const { createLock, synchro } = require("./synchro.js");
const raspi = require("../common/raspi.js");

class TunnelInstance {
  constructor(cf, logger, reloadCallback) {
    this.logger = logger;
    this.reloadCallback = reloadCallback;

    const process = spawn(
      cf,
      [
        "tunnel", "--config", ".tunnel/ingress.yml",
        ...(raspi ? [] : ["--protocol", "http2"]), "run"
      ],
      { "detached": true }
    );
    this.process = process;

    this.shouldRun = true;
    this.running = true;
    this.lock = createLock();
    this.process.once("exit", async () => await this.handleStop());
    this.process.once("error", async () => await this.handleStop());
  }

  async handleStop() {
    await synchro(this.lock)(() => {
      if (!this.shouldRun) return;
      if (!this.running) return;
      this.running = false;
      this.logger.log("Died unexpectedly!");
      this.reloadCallback();
    });
  }

  async stop() {
    await synchro(this.lock)(async () => {
      this.shouldRun = false;
      if (!this.running) return;
      const p = new Promise((res, rej) => {
        this.process.once("exit", res);
        this.process.once("error", rej);
      });
      this.process.kill("SIGINT");
      const force = setTimeout(() => {
        this.logger.log("Force killing...");
        this.process.kill("SIGKILL");
      }, 5000);
      try {
        await p;
      } finally {
        clearTimeout(force);
      }
    });
  }
}

class Tunnel extends Simplex {
  constructor(config, io) {
    super();

    const { cloudflared, cloudflare, panel } = config;

    this.cf = cloudflared ?? ("cloudflared" + (os.platform() == "win32" ? ".exe" : ""));
    this.api = new CloudflareAPI(cloudflare);
    this.panelRecord = panel.record;

    this.logger = io.loggerFor("tunnel");

    this.uuid = null;
    this.tunnelInterval = null;
    this.currentTunnel = null;
    this.replaceLock = createLock();
  }

  async init() {
    if (!fs.existsSync(".tunnel")) {
      fs.mkdirSync(".tunnel");
    }
    if (!fs.existsSync(".tunnel/tunnel.json")) {
      const name = "gxlg-cluster-" + Date.now().toString(36);
      const out = spawnSync(
        this.cf,
        ["tunnel", "create", "--cred-file=.tunnel/tunnel.json", name]
      );
      if (out.status != 0) {
        console.error(out.stderr.toString());
        throw new Error("Could not create the tunnel, please check if you are logged in!");
      } else {
        this.logger.log(out.stdout.toString());
      }
    }
    this.uuid = JSON.parse(fs.readFileSync(".tunnel/tunnel.json")).TunnelID;
  }

  async restart(pairs) {
    // generate new ingres
    const generator = new IngressGenerator(this.uuid, this.panelRecord);
    for (const { worker, service } of pairs) {
      generator.addService(service, worker);
    }
    generator.generateIngress();

    // update DNS records for services + panel and handle cache
    this.logger.log("Updating DNS rules...");
    try {
      for (const record of generator.getDirtyCacheRecords()) {
        await this.api.createRecord(record, this.uuid);
      }
    } catch (err) {
      this.logger.log("Unstable internet connection!");
      this.send("schedule_reload");
      return;
    }
    for (const { worker, service } of pairs) {
      service.confirmCacheClear();
    }

    // start the tunnel
    this.logger.log("Starting new tunnel...");
    const tunnel = new TunnelInstance(
      this.cf,
      this.logger,
      () => this.send("schedule_reload")
    );

    // replace the tunnel
    await this.replaceTunnel(tunnel);
  }

  async stop() {
    await this.replaceTunnel(null);
  }

  async replaceTunnel(newTunnel) {
    await synchro(this.replaceLock)(async () => {
      if (newTunnel == null) {
        this.logger.log("Shutting down tunnel...");
      } else {
        this.logger.log("Replacing old tunnel...");
      }

      clearInterval(this.tunnelInterval);
      this.logger.log("Polling cleared, stopping tunnel...");

      const tunnel = this.currentTunnel;
      if (tunnel != null) {
        await tunnel.stop();
      }
      this.currentTunnel = newTunnel;
      if (newTunnel == null) {
        this.logger.log("Tunnel stopped");
        return;
      }
      this.logger.log("Tunnel stopped and replaced, new PID: " + newTunnel.process.pid);

      this.logger.log("Setting up polling...");
      let loggedFirst = false;
      this.tunnelInterval = setInterval(async () => {
        try {
          if (!loggedFirst) {
            this.logger.log("First polling initiated");
            loggedFirst = true;
          }
          await axios.get("https://" + this.panelRecord);
        } catch (e) {
          // if "frozen" aka Cloudflare can't reach the tunnel
          if (e.status == 530) {
            this.logger.log("Frozen!");
            this.send("schedule_reload");
          }
        }
      }, 60000);

    });
  }
}

module.exports = { Tunnel };
