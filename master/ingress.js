const fs = require("fs");

class IngressGenerator {
  constructor(uuid, panel_record) {
    this.ingress = [
      "tunnel: " + this.uuid,
      "credentials-file: .tunnel/tunnel.json",
      "",
      "ingress:"
    ];
    this.panel_record = panel_record;
    this.records = [panel_record];
  }

  add_service(service) {
    const { name, port, config, cache_cleared } = service;
    const { record, protocol } = config;
    if (!record) return;
    const { ip } = worker;
    const prot = protocol ?? "http";
    this.ingress.push(
      "  - hostname: " + record,
      "    service: " + prot + "://" + ip + ":" + port
    );
    if (!cache_cleared) {
      this.records.push(record);
    }
  }

  generate_ingress() {
    this.ingress.push(
      "  - hostname: " + this.panel_record,
      "    service: http://127.0.0.1:8080",
      "  - service: http_status:404"
    );
    fs.writeFileSync(".tunnel/ingress.yml", this.ingress.join("\n"));
  }

  get_dirty_cache_records() {
    return this.records;
  }
}

module.exports = { IngressGenerator };
