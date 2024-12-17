const { set_cookie } = require("./auth.js");

module.exports = (req, res) => {
  const password = req.body.password;
  set_cookie(res, password);
  res.redirect("/");
};
