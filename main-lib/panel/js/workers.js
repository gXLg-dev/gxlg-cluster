const { workers } = require("../../socket.js");

module.exports = async (req, res) => {
  const w = [];
  for (const w in workers) {
    const services = workers[w].services.map(s => s.name).join(", ");
    const ram = workers[w].services.reduce((acc, s) => acc + s.ram, 0);
    const ip = workers[w].ip;

    const s = workers[w].socket;
    const p = new Promise(r => s.once("temp", r));
    s.emit("temp");
    const temp = await p;

    w.push({ services, ram, ip, temp, "id": w });
  }
  return w;
};

