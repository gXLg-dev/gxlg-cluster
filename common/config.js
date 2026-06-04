const fs = require("fs");

let config;
try {
  config = JSON.parse(fs.readFileSync("config.json"));
} catch {
  throw new Error("Could not read config data, please make sure to create a valid 'config.json' file!");
}

const required = [
  "cloudflare.api_key",
  "cloudflare.email",

  "master.ip",
  "master.port",

  "worker.ram",
  "worker.install",

  "panel.record",
  "panel.password",
  "panel.secret",

  "turnstile.site",
  "turnstile.secret"
];

for (const name of required) {
  let c = config;
  for (const path of name.split(".")) {
    if (!(path in c)) {
      console.error("The config field '" + name + "' is required!");
      process.exit(1);
    }
    c = c[path];
  }
}

module.exports = config;
