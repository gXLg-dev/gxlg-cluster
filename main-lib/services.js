const fs = require("fs");

const dirs = fs.readdirSync("./services", { "withFileTypes": true })
  .filter(s => s.isDirectory())
  .map(s => s.name);

let ports = 18000;
function setup_service(dir) {
  const config = JSON.parse(fs.readFileSync("./services/" + dir + "/gxlg-cluster.json"));
  config.name = dir;
  if (config.record) config.port = ports ++;
  return config;
}

const services = [];
for (const dir of dirs) {
  if (!fs.existsSync("./services/" + dir + "/gxlg-cluster.json")) continue;
  services.push(setup_service(dir));
}

function update_service(dir) {
  const old = services.find(s => s.name == dir);
  const config = JSON.parse(fs.readFileSync("./services/" + dir + "/gxlg-cluster.json"));
  config.name = dir;
  if (config.record && !old.record) {
    config.port = ports ++;
  } else if (old.port) {
    config.port = old.port;
  }
  for (const key in old) {
    if (!Object.keys(config).includes(key)) delete old[key];
  }
  for (const key in config) {
    old[key] = config[key];
  }
}

function remove_service(dir) {
  const old = services.findIndex(s => s.name == dir);
  services.splice(old, 1);
  const path = "./services/" + dir + "/gxlg-cluster.json";
  fs.renameSync(path, path + ".disabled");
}

module.exports = { setup_service, services, update_service, remove_service };
