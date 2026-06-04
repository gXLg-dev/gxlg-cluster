const fs = require("fs");

const adj = fs.readFileSync("worker/name/adjectives.txt", "utf-8").trim().split("\n");
const nou = fs.readFileSync("worker/name/nouns.txt", "utf-8").trim().split("\n");

const a = adj[parseInt(Math.random() * adj.length)];
const n = nou[parseInt(Math.random() * nou.length)];
const name = a + " " + n;

module.exports = name;
