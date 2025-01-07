const { kill_clean } = require("./tunnels.js");
const { stop } = require("./socket.js");
const { close } = require("./panel.js");

async function cleanup() {
  await stop();
  console.log("stopped socket server");
  await kill_clean();
  console.log("killed the tunnel");
  close();
  console.log("closed the panel");
}

module.exports = cleanup;
