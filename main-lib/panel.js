const { nulls } = require("nulls");
const nturnstile = require("nulls-turnstile");

const { check } = require("./panel/js/auth.js");
const { panel, turnstile } = require("../common-lib/config.js");

const ts = nturnstile({ ...turnstile });


let server;
(async () => {
  server = await nulls({
    "plugins": [ts],
    "nulls": "main-lib/panel/html",
    "uploads": false,
    "static": "main-lib/panel/static",
    "forceHttps": true,
    "hook": (req, res) => {
      const token = req.cookies["token.cluster"];
      req.auth = check(token);
    },
    "domain": panel.record
  });
})();

function close() {
  server.close();
}

module.exports = { close };
