module.exports = async (req, res) => {
  if (!req.auth) return res.redirect("/");
  const id = req.body.id;
  await req.api.send("shutdown_worker", id);
  res.redirect("/");
};
