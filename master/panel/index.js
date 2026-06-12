const { nulls } = require("nulls");
const nturnstile = require("nulls-turnstile");

const { check } = require("./js/auth.js");
const { Simplex } = require("../simplex.js");
const { Auth } = require("./js/auth.js");

class Panel extends Simplex {
  constructor(config, io) {
    super();

    const { panel, turnstile } = config;
    this.panel_record = panel.record;
    this.ts_plugin = nturnstile({ ...turnstile });
    this.auth = new Auth(config);

    this.logger = io.loggerFor("panel");

    this.api = new Simplex();

    this.server = null;
  }

  async start() {
    this.api.redirect("query_services", this);
    this.api.redirect("restart_service", this);
    this.api.redirect("add_service", this);
    this.api.redirect("remove_service", this);
    this.api.redirect("query_workers", this);
    this.api.redirect("identify_worker", this);
    this.api.redirect("shutdown_worker", this);

    this.api.receive("reload", () => this.reload());

    await this.reload();
  }

  async reload() {
    this.close();
    this.server = await nulls({
      "plugins": [this.ts_plugin],
      "nulls": "master/panel/html",
      "uploads": false,
      "static": "master/panel/static",
      "forceHttps": true,
      "hook": (req, res) => {
        const token = req.cookies["token.cluster"];
        req.auth = this.auth.check(token);
        req.auth_api = this.auth;
        req.api = this.api;
      },
      "ready": () => this.logger.log("Panel up!"),
      "domain": this.panel_record,
      "proxies": 1,
      "redirects": { "/landing": () => "/" }
    });
  }

  close() {
    if (this.server != null) {
      this.server.close();
      this.logger.log("Panel closed");
    }
  }
}

module.exports = { Panel };
