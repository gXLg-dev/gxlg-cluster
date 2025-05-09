const os = require("os");
const fs = require("fs");
const axios = require("axios");
const { spawnSync, spawn } = require("child_process");
const raspi = require("../common-lib/raspi.js");

module.exports = { restart_tunnel, kill };

const { cloudflare, cloudflared, panel } = require("../common-lib/config.js");
const cf = cloudflared ?? ("cloudflared" + (os.platform() == "win32" ? ".exe" : ""));

if (!fs.existsSync(".tunnel")) {
  fs.mkdirSync(".tunnel");
}
if (!fs.existsSync(".tunnel/tunnel.json")) {
  const name = "gxlg-cluster-" + Date.now().toString(36);
  const out = spawnSync(
    cf,
    ["tunnel", "create", "--cred-file=.tunnel/tunnel.json", name]
  );
  if (out.status != 0) {
    console.error(
      "Could not create the tunnel,",
      "please check if you are logged in!"
    );
    console.error(out.stderr.toString());
    process.exit(1);
  } else {
    console.log(out.stdout.toString());
  }
}
const uuid = JSON.parse(fs.readFileSync(".tunnel/tunnel.json")).TunnelID;

let running = null;
const { services } = require("./services.js");
const { workers, services_map, schedule_restart } = require("./socket.js");
let polling = null;
async function restart_tunnel() {
  // generate new ingres
  const ingress = [
    "tunnel: " + uuid,
    "credentials-file: .tunnel/tunnel.json",
    "",
    "ingress:"
  ];
  const records = [];
  for (const { name, record, port, protocol } of services) {
    if (!record) continue;
    const worker = services_map[name];
    if (!worker) continue;
    const { ip } = workers[worker];
    const prot = protocol ?? "http";
    ingress.push(
      "  - hostname: " + record,
      "    service: " + prot + "://" + ip + ":" + port
    );
    records.push(record);
  }
  ingress.push(
    "  - hostname: " + panel.record,
    "    service: http://127.0.0.1:8080",
    "  - service: http_status:404"
  );
  records.push(panel.record);
  fs.writeFileSync(".tunnel/ingress.yml", ingress.join("\n"));

  // start the tunnel
  console.log("> run tunnel");
  const tunnel = spawn(
    cf,
    [
      "tunnel", "--config", ".tunnel/ingress.yml",
      ...(raspi ? [] : ["--protocol", "http2"]), "run"
    ],
    { "detached": true }
  );
  tunnel.should_run = true;
  tunnel.once("exit", () => {
    if (tunnel.should_run) {
      running = null;
      console.log("! tunnel died unexpectedly");
      schedule_restart();
    }
  });

  // update dns rules
  for (const record of records) {
    await create_record(uuid, record);
  }

  // stop last tunnel and switch
  console.log("> kill old");
  await kill();
  running = tunnel;

  // stop polling and restart again later
  console.log("> setup polling");
  setTimeout(() => {
    polling = setInterval(async () => {
      try {
        await axios.get("https://" + panel.record);
      } catch (e) {
        // if "frozen" aka Cloudflare can't reach the tunnel
        if (e.status == 530) {
          console.log("! tunnel is frozen");
          schedule_restart();
        }
      }
    }, 60000);
  }, 10000);
}

async function kill() {
  clearInterval(polling);
  if (running != null) {
    running.should_run = false;
    const p = new Promise(r => running.once("exit", r));
    running.kill("SIGINT");
    const force = setTimeout(() => {
      console.log("Force killing tunnel");
      running.kill("SIGKILL");
    }, 5000);
    await p;
    clearTimeout(force);
    running = null;
  }
}

const base = "https://api.cloudflare.com/client/v4/";
const headers = {
  "Content-Type": "application/json",
  "X-Auth-Key": cloudflare.api_key,
  "X-Auth-Email": cloudflare.email
};

async function create_record(uuid, record) {
  const domain = record.split(".").slice(-2).join(".");
  const zones = {};
  const rz = await axios.get(base + "zones", { headers });
  for (const entry of rz.data.result) {
    zones[entry.name] = entry.id;
  }
  if (!(domain in zones)) {
    console.error(
      "The domain '" + domain + "' does not belong to you!"
    );
    process.exit(1);
  }
  const zone = zones[domain];
  const records = {};
  const rr = await axios.get(base + "zones/" + zone + "/dns_records", { headers });
  for (const entry of rr.data.result) {
    if (entry.type == "CNAME") records[entry.name] = entry.id;
  }

  const settings = {
    "type": "CNAME",
    "name": record,
    "content": uuid + ".cfargotunnel.com",
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

schedule_restart();
