const fs = require("fs");

const info = fs.readFileSync("/proc/cpuinfo", "utf8");

module.exports = info.includes("Raspberry Pi");
