class PortAssigner {
  constructor(min, max) {
    this.min = min;
    this.max = max;
    this.frame = min;
    this.poolsize = 16;
    this.pool = new Set();
  }

  fillPool() {
    if (this.frame == this.max) {
      throw new Error("PortAssigner ran out of free ports!");
    }
    const poolsize = this.poolsize;
    const frameEnd = Math.min(this.frame + poolsize, this.max);
    for (let port = this.frame; port < frameEnd; port++) {
      this.pool.add(port);
    }
    this.frame = frameEnd;
    this.poolsize = poolsize * 2;
  }

  assignPort() {
    if (this.pool.size == 0) this.fillPool();

    const port = this.pool.values().reduce((acc, v) => Math.min(acc, v), Infinity);
    this.pool.delete(port);
    return port;
  }

  releasePort(port) {
    this.pool.add(port);
  }
}

module.exports = { PortAssigner };
