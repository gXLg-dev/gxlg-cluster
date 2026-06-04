class PortAssigner {
  constructor(min, max) {
    this.min = min;
    this.max = max;
    this.frame = min;
    this.poolsize = 16;
    this.pool = new Set();
  }

  fill_pool() {
    if (this.frame == this.max) {
      throw new Error("PortAssigner ran out of free ports!");
    }
    const poolsize = this.poolsize;
    const frame_end = Math.min(this.frame + poolsize, this.max);
    for (let port = this.frame; port < frame_end; port++) {
      this.pool.add(port);
    }
    this.frame = frame_end;
    this.poolsize = poolsize * 2;
  }

  assign_port() {
    if (this.pool.size == 0) fill_pool();

    const port = this.pool.values().reduce((acc, v) => Math.min(acc, v), Infinity);
    this.pool.delete(port);
    return port;
  }

  release_port(port) {
    this.pool.add(port);
  }
}

module.exports = { PortAssigner };
