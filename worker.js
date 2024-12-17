const { io } = require("socket.io-client");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");
const rpio = require("rpio");

const { main, worker } = require("./common-lib/config.js");

const socket = io("ws://" + main.ip + ":" + main.port);

const services = {};
let blink = true;
let identify = false;
(async () => {
  rpio.open(37, rpio.OUTPUT, rpio.LOW);
  while (blink) {
    let ram = 0;
    for (const service in services) {
      const { open, config } = services[service];
      if (open) ram += config.ram;
    }
    const sleep = 1000 * (1 - ram / worker.ram);
    await new Promise(r => setTimeout(r, sleep))
    rpio.write(37, rpio.HIGH);
    if (identify) {
      await new Promise(r => setTimeout(r, 4000))
      identify = false;
    } else {
      await new Promise(r => setTimeout(r, 100))
    }
    rpio.write(37, rpio.LOW);
  }
  rpio.close(37);
  console.log("end");
})();

socket.on("identify", () => {
  identify = true;
});

socket.on("start", (service, port) => start(service, port));
socket.on("stop", async service => {
  socket.emit("status", service, 2);
  await stop(service);
  socket.emit("stopped-" + service);
});

async function start(service, port) {
  const cwd = "services/" + service;
  const config = JSON.parse(fs.readFileSync(cwd + "/gxlg-cluster.json"));

  socket.emit("status", service, 1);
  if (config.dependencies) {
    const i = spawnSync("sh", ["-c", [worker.install, ...config.dependencies].join(" ")]);
    if (i.status != 0) {
      socket.emit("status", service, 3);
      return;
    }
  }
  if (config.setup) {
    for (const s of config.setup) {
      const i = spawnSync("sh", ["-c", s]);
      if (i.status != 0) {
        socket.emit("status", service, 3);
        return;
      }
    }
  }

  let start = config.start;
  if (port) start = start.replaceAll("{port}", port);
  console.log("Starting", service);
  const proc = spawn("sh", ["-c", start], { cwd });
  proc.on("exit", code => {
    if (code != 0 && code != null) socket.emit("status", service, 3);
    if (service in services) services[service].open = false;
  });
  proc.on("error", e => {
    console.error(e);
    socket.emit("status", service, 3);
  });
  proc.stderr.pipe(process.stderr);

  const spid = proc.pid;
  const sppd = spawnSync("ps", ["--ppid", spid, "-o", "pid:1="]);
  const pid = sppd.stdout.toString().trim();

  services[service] = { config, proc, pid, "open": true };
  socket.emit("status", service, 4);
}

async function stop(service) {
  console.log("stopping", service);
  const { config, proc, pid, open } = services[service];
  if (open) {
    const p = new Promise(r => proc.once("exit", r));

    let stop = config.stop;
    if (!stop) stop = "kill -INT {pid}";
    stop = stop.replaceAll("{pid}", pid);
    spawnSync("sh", ["-c", stop]);

    await p;
    services[service].open = false;
  }
  delete services[service];
}

async function stop_all() {
  for (const service in services) {
    await stop(service);
  }
}

async function exit() {
  await stop_all();
  socket.close();
  blink = false;
}

socket.on("disconnect", async () => {
  await stop_all();
});

socket.on("shutdown", async () => {
  await exit();
});

process.on("SIGINT", async () => {
  await exit();
});

