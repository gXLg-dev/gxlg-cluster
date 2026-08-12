const Queue = require("promise-queue");

async function createLock() {
  return new Queue(1, Infinity);
}

async function synchro(lock) {
  return callback => {
    return lock.add(() => callback());
  };
}

module.exports = { createLock, synchro };
