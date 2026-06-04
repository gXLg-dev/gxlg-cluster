module.exports = async (req, res) => {
  if (!(await req.verifyHuman("login"))) return res.redirect("/");
  const password = req.body.password;
  req.auth_api.set_cookie(res, password);
  res.redirect("/");
};
