const { set_cookie } = require("./auth.js");

module.exports = async (req, res) => {
  if (!(await req.verifyHuman("login"))) return res.redirect("/");
  const password = req.body.password;
  set_cookie(res, password);
  res.redirect("/");
};
