const { shutdown_worker } = require("../../socket.js");

module.exports = (req, res) => {
  if (!req.auth) return res.redirect("/");
  const id = req.body.id;
  shutdown_worker(id);
  res.redirect("/");
};
