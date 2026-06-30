const os = require("os");
const fs = require("fs");
const axios = require("axios");
const { spawn } = require("child_process");

const { Simplex } = require("./simplex.js");
const raspi = require("../common/raspi.js");

const base = "https://api.cloudflare.com/client/v4/";

class Tunnel extends Simplex {
  constructor(config, io) {
    super();

    const { cloudflare, cloudflared, panel } = config;

    this.cf = cloudflared ?? ("cloudflared" + (os.platform() == "win32" ? ".exe" : ""));
    this.headers = {
      "Content-Type": "application/json",
      "X-Auth-Key": cloudflare.api_key,
      "X-Auth-Email": cloudflare.email
    };
    this.panel_record = panel.record;

    this.logger = io.loggerFor("tunnel");

    this.uuid = null;
    this.tunnel_interval = null;
    this.current_tunnel = null;
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
    const ingress = [
      "tunnel: " + this.uuid,
      "credentials-file: .tunnel/tunnel.json",
      "",
      "ingress:"
    ];
    const records = [];
    for (const { worker, service } of pairs) {
      const { name, port, config } = service;
      const { record, protocol } = config;
      if (!record) continue;
      const { ip } = worker;
      const prot = protocol ?? "http";
      ingress.push(
        "  - hostname: " + record,
        "    service: " + prot + "://" + ip + ":" + port
      );
      records.push(record);
    }
    ingress.push(
      "  - hostname: " + this.panel_record,
      "    service: http://127.0.0.1:8080",
      "  - service: http_status:404"
    );
    records.push(this.panel_record);
    fs.writeFileSync(".tunnel/ingress.yml", ingress.join("\n"));

    // start the tunnel
    this.logger.log("Starting...");
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
        this.current_tunnel = null;
        this.logger.log("Died unexpectedly!");
        this.send("schedule_reload");
      }
    });

    // update dns rules
    for (const record of records) {
      await this.create_record(record);
    }

    // stop old tunnel (also stop polling) and switch
    this.logger.log("Stopping old tunnel...");
    await this.stop();
    this.current_tunnel = tunnel;

    // restart polling again
    this.logger.log("Setting up polling...");
    let logged_first = false;
    this.tunnel_interval = setInterval(async () => {
      try {
        if (!logged_first) {
          this.logger.log("Polling initiated (first)");
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

  }

  async create_record(record) {
    const headers = this.headers;
    const domain = record.split(".").slice(-2).join(".");
    const zones = { };
    const rz = await axios.get(base + "zones", { headers });
    for (const entry of rz.data.result) {
      zones[entry.name] = entry.id;
    }
    if (!(domain in zones)) {
      throw new Error(`The domain "${domain}" does not belong to you!`);
    }
    const zone = zones[domain];
    const records = { };
    const rr = await axios.get(base + "zones/" + zone + "/dns_records", { headers });
    for (const entry of rr.data.result) {
      if (entry.type == "CNAME") records[entry.name] = entry.id;
    }

    const settings = {
      "type": "CNAME",
      "name": record,
      "content": this.uuid + ".cfargotunnel.com",
      "proxied": true,
      "comment": "Created for gXLg Cluster"
    };
    if (!(record in records)) {
      await axios.post(
        base + "zones/" + zone + "/dns_records",
        settings,
        { headers }
      );
    } else {
      await axios.put(
        base + "zones/" + zone + "/dns_records/" + records[record],
        settings,
        { headers }
      );
    }

    // purge cache
    await axios.post(
      base + "zones/" + zone + "/purge_cache",
      { "hosts": [record] },
      { headers }
    );
  }

  async stop() {
    this.logger.log("Polling cleared");
    clearInterval(this.tunnel_interval);
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
      this.current_tunnel = null;
    }
    this.logger.log("Tunnel stopped");
  }
}

module.exports = { Tunnel };
