const os = require("os");
const fs = require("fs");
const axios = require("axios");
const { spawnSync, spawn } = require("child_process");

module.exports = { switch_tunnels, kill_all };

const { cloudflare, cloudflared, panel } = require("../common-lib/config.js");
const cf = cloudflared ?? ("cloudflared" + (os.platform() == "win32" ? ".exe" : ""));

if (!fs.existsSync(".tunnel")) {
  fs.mkdirSync(".tunnel");
}
if (!fs.existsSync(".tunnel/tunnel1.json")) {
  const name = "gxlg-cluster-1-" + Date.now().toString(36);
  const out = spawnSync(
    cf,
    ["tunnel", "create", "--cred-file=.tunnel/tunnel1.json", name]
  );
  if (out.status != 0) {
    console.error(
      "Could not create the first tunnel,",
      "please check if you are logged in!"
    );
    console.error(out.stderr.toString());
    process.exit(1);
  } else {
    console.log(out.stdout.toString());
  }
}
const uuid1 = JSON.parse(fs.readFileSync(".tunnel/tunnel1.json")).TunnelID;

if (!fs.existsSync(".tunnel/tunnel2.json")) {
  const name = "gxlg-cluster-2-" + Date.now().toString(36);
  const out = spawnSync(
    cf,
    ["tunnel", "create", "--cred-file=.tunnel/tunnel2.json", name]
  );
  if (out.status != 0) {
    console.error(
      "Could not create the second tunnel,",
      "please check if you are logged in!"
    );
    console.error(out.stderr.toString());
    process.exit(1);
  } else {
    console.log(out.stdout.toString());
  }
}
const uuid2 = JSON.parse(fs.readFileSync(".tunnel/tunnel2.json")).TunnelID;
const tunnels = [uuid1, uuid2];

if (!fs.existsSync(".tunnel/tunnelp.json")) {
  const name = "gxlg-cluster-panel-" + Date.now().toString(36);
  const out = spawnSync(
    cf,
    ["tunnel", "create", "--cred-file=.tunnel/tunnelp.json", name]
  );
  if (out.status != 0) {
    console.error(
      "Could not create the panel tunnel,",
      "please check if you are logged in!"
    );
    console.error(out.stderr.toString());
    process.exit(1);
  } else {
    console.log(out.stdout.toString());
  }
}
const uuidp = JSON.parse(fs.readFileSync(".tunnel/tunnelp.json")).TunnelID;
let panelt;
function setup_panel() {
  const ingress = [
    "tunnel: " + uuidp,
    "credentials-file: .tunnel/tunnelp.json",
    "",
    "ingress:",
    "  - hostname: " + panel.record,
    "    service: http://127.0.0.1:8080",
    "  - service: http_status:404"
  ];
  fs.writeFileSync(".tunnel/ingressp.yml", ingress.join("\n"));
  panelt = spawn(cf, [
    "tunnel",
    "--config", ".tunnel/ingressp.yml",
    "run"
  ]);
  createRecord(uuidp, panel.record);
}

async function kill_panel() {
  const p = new Promise(r => panelt.once("exit", r));
  panelt.kill("SIGINT");
  await p;
}


let currently_active = -1;
let running = null;

const { services } = require("./services.js");
const { workers, services_map } = require("./socket.js");
async function switch_tunnels() {
  currently_active = (currently_active + 1) % 2;
  const current_uuid = tunnels[currently_active];

  // generate new ingres
  const ingress = [
    "tunnel: " + current_uuid,
    "credentials-file: .tunnel/tunnel" + (currently_active + 1) + ".json",
    "",
    "ingress:"
  ];
  const records = [];
  for (const { name, record, port } of services) {
    if (!record) continue;
    const worker = services_map[name];
    if (!worker) continue;
    const { ip } = workers[worker];
    ingress.push(
      "  - hostname: " + record,
      "    service: http://" + ip + ":" + port
    );
    records.push(record);
  }
  ingress.push("  - service: http_status:404");
  fs.writeFileSync(".tunnel/ingress.yml", ingress.join("\n"));

  // start the second tunnel
  const other = spawn(cf, [
    "tunnel",
    "--config", ".tunnel/ingress.yml",
    "run"
  ]);

  // update dns rules
  for (const record of records) {
    await createRecord(current_uuid, record);
  }

  // stop last tunnel and switch
  await kill();
  running = other;
}

async function kill() {
  if (running != null) {
    const p = new Promise(r => running.once("exit", r));
    running.kill("SIGINT");
    await p;
    running = null;
  }
}

const base = "https://api.cloudflare.com/client/v4/";
const headers = {
  "Content-Type": "application/json",
  "X-Auth-Key": cloudflare.api_key,
  "X-Auth-Email": cloudflare.email
};

async function createRecord(uuid, record) {
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
}

async function kill_all() {
  await kill();
  await kill_panel();
}

setup_panel();
