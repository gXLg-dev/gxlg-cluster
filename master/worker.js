class Worker {
  constructor(id, ip, socket) {
    this.id = id;
    this.ip = ip;
    this.socket = socket;
  }

  async start_service(service) {
    if (this.socket.connected) {
      await this.socket.emitWithAck("start_service", service.name, service.port);
    }
  }

  async stop_service(service) {
    if (this.socket.connected) {
      await this.socket.emitWithAck("stop_service", service.name);
    }
  }

  identify() {
    if (this.socket.connected) {
      this.socket.emit("identify");
    }
  }

  async temp() {
    if (this.socket.connected) {
      try {
        return await this.socket.timeout(2000).emitWithAck("temp");
      } catch (e) { }
    }
    return "N/A";
  }

  async shutdown() {
    if (this.socket.connected) {
      this.socket.emit("shutdown");
    }
  }
}

module.exports = { Worker };
