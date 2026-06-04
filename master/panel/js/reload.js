const { spawnSync } = require("child_process");

module.exports = (req, res) => {
  if (!req.auth) return res.redirect("/");
  spawnSync("sh", ["-c", "git pull"], { "timeout": 10000 });
  res.redirect("/tools");
  req.api.send("reload");
};
