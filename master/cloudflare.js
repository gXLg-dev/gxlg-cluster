const axios = require("axios");

const base = "https://api.cloudflare.com/client/v4";

class CloudflareAPI {
  constructor(cloudflare) {
    this.headers = {
      "Content-Type": "application/json",
      "X-Auth-Key": cloudflare.api_key,
      "X-Auth-Email": cloudflare.email
    };

    this.cached_zones = { };
    this.cached_records = { };
  }

  async get_zone(domain) {
    if (domain in this.cached_zones) {
      return this.cached_zones[domain];
    }
    const headers = this.headers;
    const zones = { };
    const rz = await axios.get(`${base}/zones`, { headers });
    for (const entry of rz.data.result) {
      zones[entry.name] = entry.id;
    }
    this.cached_zones = zones;
    if (!(domain in zones)) {
      throw new Error(`The domain "${domain}" does not belong to you!`);
    }
    return zones[domain];
  }

  async get_record(zone, record) {
    if (record in this.cached_records) {
      return this.cached_records[record];
    }
    const headers = this.headers;
    const records = { };
    const rr = await axios.get(
      `${base}/zones/${zone}/dns_records`, { headers }
    );
    for (const entry of rr.data.result) {
      if (entry.type == "CNAME") {
        this.cached_records[entry.name] = entry.id;
      }
    }
    return this.cached_records[record] ?? null;
  }

  async create_record(record, uuid) {
    const domain = record.split(".").slice(-2).join(".");
    const zone = await this.get_zone(domain);
    const recordId = await this.get_record(zone, record);
    const settings = {
      "type": "CNAME",
      "name": record,
      "content": uuid + ".cfargotunnel.com",
      "proxied": true,
      "comment": "Created for gXLg Cluster"
    };
    const headers = this.headers;
    if (recordId == null) {
      await axios.post(
        `${base}/zones/${zone}/dns_records`,
        settings, { headers }
      );
    } else {
      await axios.put(
        `${base}/zones/${zone}/dns_records/${recordId}`,
        settings, { headers }
      );
    }

    // purge cache
    await axios.post(
      `${base}/zones/${zone}/purge_cache`,
      { "hosts": [record] },
      { headers }
    );
  }
}

module.exports = { CloudflareAPI };
