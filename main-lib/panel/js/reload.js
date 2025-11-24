const { spawnSync } = require("child_process");
const { reload } = require("../../panel.js");

module.exports = (req, res) => {
  if (!req.auth) return res.redirect("/");
  spawnSync("sh", ["-c", "git pull"], { "timeout": 10000 });
  res.redirect("/tools");
  reload();
};
