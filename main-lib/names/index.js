const fs = require("fs");

const adj = fs.readFileSync("main-lib/names/adjectives.txt", "utf-8").trim().split("\n");
const nou = fs.readFileSync("main-lib/names/nouns.txt", "utf-8").trim().split("\n");

module.exports = () => {
  const a = adj[parseInt(Math.random() * adj.length)];
  const n = nou[parseInt(Math.random() * nou.length)];
  return a + " " + n;
};
