(async () => {

  const cleanup = require("./main-lib/cleanup.js");
  process.on("SIGINT", async () => {
    await cleanup();
  });

})();
