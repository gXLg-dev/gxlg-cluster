const Queue = require("promise-queue");

const MAX_ID_LEN = 8;
const MAX_WIDTH = 50;

const PAD_MID = " ".repeat(17 + MAX_ID_LEN + 3) + " | ";
const PAD_END = " ".repeat(17 + MAX_ID_LEN + 3) + " \\ ";

class SyncedIOFactory {
  constructor() {
    this.pipe = new Queue(1, Infinity);
  }

  loggerFor(id) {
    return new SyncedLogger(id, this.pipe);
  }
}

class SyncedLogger {
  constructor(id, pipe) {
    this.id = id.slice(0, MAX_ID_LEN).padEnd(MAX_ID_LEN, " ");
    this.pipe = pipe;
  }

  async log(...args) {
    if (args.length == 0) {
      return;
    }
    const prefix = (new Date()).toISOString()
      .slice(2, 19).replace("T", " ") + " | " + this.id + " | ";
    const adjusted = [];
    const lines = args.join(" ").split("\n");
    for (let line of lines) {
      while (line.length > MAX_WIDTH) {
        adjusted.push(line.slice(0, MAX_WIDTH));
        line = line.slice(MAX_WIDTH);
      }
      adjusted.push(line);
    }
    let text = prefix + adjusted[0] + "\n";
    for (const line of adjusted.slice(1, -1)) {
      text += PAD_MID + line + "\n";
    }
    if (adjusted.length > 1) {
      text += PAD_END + adjusted.slice(-1)[0] + "\n";
    }
    await this.pipe.add(() => {
      process.stdout.write(text);
    });
  }
}

module.exports = { SyncedIOFactory, SyncedLogger };
