const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { panel } = require("../../../common-lib/config.js");

const LOGIN_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

function set_cookie(res, password) {
  const hash = bcrypt.hashSync(password);
  const token = jwt.sign({ hash }, panel.secret, {
    "expiresIn": LOGIN_DURATION.toString()
  });
  const options = {
    "httpOnly": true,
    "sameSite": true,
    "secure": true,
    "maxAge": LOGIN_DURATION
  };
  res.cookie("token", token, options);
}

function check(token) {
  if (token == null) return false;
  try {
    const d = jwt.verify(token, panel.secret);
    return bcrypt.compareSync(panel.password, d.hash);
  } catch {
    return false;
  }
}

module.exports = { check, set_cookie };
