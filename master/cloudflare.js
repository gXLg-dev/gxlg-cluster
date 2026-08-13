const axios = require("axios");

const base = "https://api.cloudflare.com/client/v4";

class CloudflareAPI {
  constructor(cloudflare) {
    this.headers = {
      "Content-Type": "application/json",
      "X-Auth-Key": cloudflare.apiKey,
      "X-Auth-Email": cloudflare.email
    };

    this.cachedZones = { };
    this.cachedRecords = { };
  }

  async getZone(domain) {
    if (domain in this.cachedZones) {
      return this.cachedZones[domain];
    }
    const headers = this.headers;
    const zones = { };
    const rz = await axios.get(`${base}/zones`, { headers });
    for (const entry of rz.data.result) {
      zones[entry.name] = entry.id;
    }
    this.cachedZones = zones;
    if (!(domain in zones)) {
      throw new Error(`The domain "${domain}" does not belong to you!`);
    }
    return zones[domain];
  }

  async getRecord(zone, record) {
    if (record in this.cachedRecords) {
      return this.cachedRecords[record];
    }
    const headers = this.headers;
    const records = { };
    const rr = await axios.get(
      `${base}/zones/${zone}/dns_records`, { headers }
    );
    for (const entry of rr.data.result) {
      if (entry.type == "CNAME") {
        this.cachedRecords[entry.name] = entry.id;
      }
    }
    return this.cachedRecords[record] ?? null;
  }

  async createRecord(record, uuid) {
    const domain = record.split(".").slice(-2).join(".");
    const zone = await this.getZone(domain);
    const recordId = await this.getRecord(zone, record);
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
