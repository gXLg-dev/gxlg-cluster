const { services } = require("../../services.js");
const { services_map, service_status } = require("../../socket.js");

module.exports = (req, res) => {
  return services.map(s => {
    const status = service_status[s.name];
    const worker = services_map[s.name] ?? "Not assigned";
    return { ...s, status, worker };
  });
};
