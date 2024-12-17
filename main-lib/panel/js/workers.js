const { workers } = require("../../socket.js");

module.exports = (req, res) => {
  return Object.keys(workers).map(w => {
    const services = workers[w].services.map(s => s.name).join(", ");
    const ram = workers[w].services.reduce((acc, s) => acc + s.ram, 0);
    const ip = workers[w].ip;
    return { services, ram, ip, "id": w };
  });
};

