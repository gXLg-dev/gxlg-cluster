const { restart } = require("../../socket.js");

module.exports = (req, res) => {
  if (!req.auth) return res.redirect("/");
  const name = req.body.name;
  restart(name);
  res.redirect("/services");
};
