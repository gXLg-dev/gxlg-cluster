const fs = require("fs");

class Service {
  constructor(directory, portAssigner) {
    this.name = directory;
    this.portAssigner = portAssigner;

    this.port = null;
    this.config = null;

    this.cacheCleared = false;
    this.reload();
  }

  reload() {
    this.config = JSON.parse(fs.readFileSync("./services/" + this.name + "/gxlg-cluster.json"));
    if (this.config.record) {
      if (!this.port) {
        this.port = this.portAssigner.assignPort();
      }
      this.cacheCleared = false;
    } else {
      if (this.port) {
        this.portAssigner.releasePort(this.port);
      }
      this.port = null;
    }
  }

  confirmCacheClear() {
    this.cacheCleared = true;
  }

  unregister() {
    if (this.port) {
      this.portAssigner.releasePort(this.port);
      this.port = null;
    }
  }
}

module.exports = { Service };
