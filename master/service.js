const fs = require("fs");

class Service {
  constructor(directory, port_assigner) {
    this.name = directory;
    this.port_assigner = port_assigner;

    this.port = null;
    this.config = null;

    this.cache_cleared = false;
    this.reload();
  }

  reload() {
    this.config = JSON.parse(fs.readFileSync("./services/" + this.name + "/gxlg-cluster.json"));
    if (this.config.record) {
      if (!this.port) {
        this.port = this.port_assigner.assign_port();
      }
      this.cache_cleared = false;
    } else {
      if (this.port) {
        this.port_assigner.release_port(this.port);
      }
      this.port = null;
    }
  }

  confirm_cache_clear() {
    this.cache_cleared = true;
  }

  unregister() {
    if (this.port) {
      this.port_assigner.release_port(this.port);
      this.port = null;
    }
  }
}

module.exports = { Service };
