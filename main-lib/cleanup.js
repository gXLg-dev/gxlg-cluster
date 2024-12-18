const { kill_all } = require("./tunnels.js");
const { stop } = require("./socket.js");
const { close } = require("./panel.js");

async function cleanup() {
  await stop();
  console.log("stopped socket server");
  await kill_all();
  console.log("killed all tunnels");
  close();
  console.log("closed the panel");
}

module.exports = cleanup;
