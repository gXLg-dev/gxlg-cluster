const { Manager } = require("./manager.js");
const { SyncedIOFactory } = require("../common/logging.js");

const config = require("../common/config.js");

(async () => {

  const manager = new Manager(config, new SyncedIOFactory());

  process.on("SIGINT", async () => {
    process.stdout.write("\r");
    await manager.stop();
  });

  await manager.start();

})();
