const { kill } = require("./tunnels.js");
const { stop } = require("./socket.js");
const { close } = require("./panel.js");

async function cleanup() {
  await stop();
  console.log("stopped socket server");
  await kill();
  console.log("killed the tunnel");
  close();
  console.log("closed the panel");
}

module.exports = cleanup;
