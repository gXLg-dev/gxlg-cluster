module.exports = async (req, res) => {
  if (!req.auth) return res.redirect("/");
  const name = req.body.name;
  await req.api.send("add_service", name);
  res.redirect("/services");
};
