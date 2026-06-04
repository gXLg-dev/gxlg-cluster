const { spawnSync } = require("child_process");
const state = require("./terminal.js");

module.exports = (req, res) => {
  if (!req.auth) return res.redirect("/");
  const input = req.body.input + "; echo; pwd -P";
  const command = spawnSync("sh", ["-c", input], { "cwd": state.cwd, "encoding": "utf-8", "timeout": 10000 });
  const lines = (command.stdout ?? "").trim().split("\n");
  state.cwd = lines.pop() ?? state.cwd;
  const o = lines.join("\n").trim();
  const e = (command.stderr ?? "").trim();
  state.output = [state.cwd, o, e].join("\n---\n");
  res.redirect("/tools");
};
