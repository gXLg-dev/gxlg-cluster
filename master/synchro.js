const Queue = require("promise-queue");

function createLock() {
  return new Queue(1, Infinity);
}

function synchro(lock) {
  return callback => {
    return lock.add(() => callback());
  };
}

module.exports = { createLock, synchro };
