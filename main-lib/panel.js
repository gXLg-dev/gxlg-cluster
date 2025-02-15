const { nulls } = require("nulls");
const { check } = require("./panel/js/auth.js");

let server;
(async () => {
  server = await nulls({
    "nulls": "main-lib/panel/html",
    "uploads": false,
    "static": "main-lib/panel/static",
    "forceHttps": true,
    "hook": (req, res) => {
      const token = req.cookies["token.cluster"];
      req.auth = check(token);
    }
  });
})();

function close() {
  server.close();
}

module.exports = { close };
