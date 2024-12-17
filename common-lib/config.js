const fs = require("fs");

try {
  const config = JSON.parse(
    fs.readFileSync("config.json")
  );

  const required = [
    "cloudflare.api_key",
    "cloudflare.email",

    "main.ip",
    "main.port",

    "worker.ram",
    "worker.install",

    "panel.record",
    "panel.password",
    "panel.secret"
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

} catch {
  console.error("Could not read config data, please make sure to create a valid 'config.json' file!");
  process.exit(1);
}
