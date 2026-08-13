const fs = require("fs");

class IngressGenerator {
  constructor(uuid, panelRecord) {
    this.ingress = [
      "tunnel: " + uuid,
      "credentials-file: .tunnel/tunnel.json",
      "",
      "ingress:"
    ];
    this.panelRecord = panelRecord;
    this.records = [panelRecord];
  }

  addService(service, worker) {
    const { name, port, config, cacheCleared } = service;
    const { record, protocol } = config;
    if (!record) return;
    const { ip } = worker;
    const prot = protocol ?? "http";
    this.ingress.push(
      "  - hostname: " + record,
      "    service: " + prot + "://" + ip + ":" + port
    );
    if (!cacheCleared) {
      this.records.push(record);
    }
  }

  generateIngress() {
    this.ingress.push(
      "  - hostname: " + this.panelRecord,
      "    service: http://127.0.0.1:8080",
      "  - service: http_status:404"
    );
    fs.writeFileSync(".tunnel/ingress.yml", this.ingress.join("\n"));
  }

  getDirtyCacheRecords() {
    return this.records;
  }
}

module.exports = { IngressGenerator };
