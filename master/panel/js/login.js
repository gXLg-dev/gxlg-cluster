module.exports = async (req, res) => {
  if (!(await req.verifyHuman("login"))) return res.redirect("/");
  const password = req.body.password;
  req.authApi.setCookie(res, password);
  res.redirect("/");
};
