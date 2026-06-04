module.exports = async (req, res) => {
  if (!req.auth) return res.redirect("/");
  const name = req.body.name;
  await req.api.send("restart_service", name);
  res.redirect("/services");
};
