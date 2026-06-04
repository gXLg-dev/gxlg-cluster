const state = require("./terminal.js");

module.exports = (req, res) => {
  return state.output;
};
