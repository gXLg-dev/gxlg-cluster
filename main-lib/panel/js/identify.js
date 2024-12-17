const { identify_worker } = require("../../socket.js");

module.exports = (req, res) => {
  if (!req.auth) return res.redirect("/");
  const id = req.body.id;
  identify_worker(id);
  res.redirect("/");
};
