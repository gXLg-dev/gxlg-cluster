const { add_service } = require("../../socket.js");

module.exports = (req, res) => {
  if (!req.auth) return res.redirect("/");
  const name = req.body.name;
  add_service(name);
  res.redirect("/services");
};
