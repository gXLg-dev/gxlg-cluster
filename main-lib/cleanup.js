const { kill_all } = require("./tunnels.js");
const { stop } = require("./socket.js");
const { close } = require("./panel.js");

async function cleanup() {
  await stop();
  await kill_all();
  close();
}

module.exports = cleanup;
