const { spawnSync } = require("child_process");
const state = require("./terminal.js");

module.exports = (req, res) => {
  if (!req.auth) return res.redirect("/");
  const input = req.body.input + "; echo; pwd -P";
  const command = spawnSync("sh", ["-c", input], { "cwd": state.cwd });
  const lines = command.stdout.toString().trim().split("\n");
  state.cwd = lines.pop();
  const o = lines.join("\n").trim();
  const e = command.stderr.toString().trim();
  state.output = [state.cwd, o, e].join("\n---\n");
  res.redirect("/tools");
};
