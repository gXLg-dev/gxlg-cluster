const Queue = require("promise-queue");

class Simplex {
  constructor() {
    this.pipe = new Queue(1, Infinity);
    this.receivers = { };
  }

  receive(event, func) {
    if (event in this.receivers) {
      throw new Error(`The simplex already has a receiver for the event "${event}"`);
    }
    this.receivers[event] = func;
  }

  redirect(event, simplex) {
    this.receive(
      event,
      async (...args) => await simplex.send(event, ...args)
    );
  }

  async send(event, ...args) {
    if (!(event in this.receivers)) {
      throw new Error(`The simplex doesn't have a receiver for the event "${event}"`);
    }
    return this.pipe.add(async () => this.receivers[event](...args))
  }
}

module.exports = { Simplex };
