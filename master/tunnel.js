const os = require("os");
const fs = require("fs");
const axios = require("axios");
const { spawn } = require("child_process");
const Queue = require("promise-queue");

const { Simplex } = require("./simplex.js");
const { CloudflareAPI } = require("./cloudflare.js");
const { IngressGenerator } = require("./ingress.js");
const raspi = require("../common/raspi.js");

class Tunnel extends Simplex {
  constructor(config, io) {
    super();

    const { cloudflared, cloudflare, panel } = config;

    this.cf = cloudflared ?? ("cloudflared" + (os.platform() == "win32" ? ".exe" : ""));
    this.api = new CloudflareAPI(cloudflare);
    this.panel_record = panel.record;

    this.logger = io.loggerFor("tunnel");

    this.uuid = null;
    this.tunnel_interval = null;
    this.current_tunnel = null;
    this.replace_pipe = new Queue(1, Infinity);
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
    const generator = new IngressGenerator(this.uuid, this.panel_record);
    for (const { worker, service } of pairs) {
      generator.add_service(service, worker);
    }
    generator.generate_ingress();

    // update DNS records for services + panel and handle cache
    this.logger.log("Updating DNS rules...");
    try {
      for (const record of generator.get_dirty_cache_records()) {
        await this.api.create_record(record, this.uuid);
      }
    } catch (err) {
      this.logger.log("Unstable internet connection!");
      this.send("schedule_reload");
      return;
    }
    for (const { worker, service } of pairs) {
      service.confirm_cache_clear();
    }

    // start the tunnel
    this.logger.log("Starting new tunnel...");
    const tunnel = spawn(
      this.cf,
      [
        "tunnel", "--config", ".tunnel/ingress.yml",
        ...(raspi ? [] : ["--protocol", "http2"]), "run"
      ],
      { "detached": true }
    );
    tunnel.should_run = true;
    tunnel.once("exit", () => {
      if (tunnel.should_run) {
        tunnel.should_run = false;
        this.logger.log("Died unexpectedly!");
        this.send("schedule_reload");
      }
    });

    // replace the tunnel
    await this.replace_tunnel(tunnel);
  }

  async stop() {
    await this.replace_tunnel(null);
  }

  async replace_tunnel(new_tunnel) {
    await this.replace_pipe.add(async () => {
      if (new_tunnel == null) {
        this.logger.log("Shutting down tunnel...");
      } else {
        this.logger.log("Replacing old tunnel...");
      }

      clearInterval(this.tunnel_interval);
      this.logger.log("Polling cleared, stopping tunnel...");

      const tunnel = this.current_tunnel;
      if (tunnel != null) {
        tunnel.should_run = false;
        const p = new Promise(r => tunnel.once("exit", r));
        tunnel.kill("SIGINT");
        const force = setTimeout(() => {
          this.logger.log("Force killing...");
          tunnel.kill("SIGKILL");
        }, 5000);
        await p;
        clearTimeout(force);
      }
      this.current_tunnel = new_tunnel;
      if (new_tunnel == null) {
        this.logger.log("Tunnel stopped");
        return;
      }
      this.logger.log("Tunnel stopped and replaced");

      this.logger.log("Setting up polling...");
      let logged_first = false;
      this.tunnel_interval = setInterval(async () => {
        try {
          if (!logged_first) {
            this.logger.log("First polling initiated");
            logged_first = true;
          }
          await axios.get("https://" + this.panel_record);
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
