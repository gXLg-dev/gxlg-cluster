const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const LOGIN_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

class Auth {
  constructor(config) {
    const { panel } = config;
    this.secret = panel.secret;
    this.password = panel.password;
  }

  check(token) {
    if (token == null) return false;
    try {
      const d = jwt.verify(token, this.secret);
      return bcrypt.compareSync(d.password, this.password);
    } catch {
      return false;
    }
  }

  set_cookie(res, password) {
    const token = jwt.sign({ password }, this.secret, {
      "expiresIn": LOGIN_DURATION.toString()
    });
    const options = {
      "httpOnly": true,
      "sameSite": true,
      "secure": true,
      "maxAge": LOGIN_DURATION
    };
    res.cookie("token.cluster", token, options);
  }
}

module.exports = { Auth };
