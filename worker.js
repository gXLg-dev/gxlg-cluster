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
      const { open, config } = await services[service];
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
  console.log("end");
})();

socket.on("identify", () => {
  identify = true;
});

socket.on("start", (service, port) => start(service, port));
socket.on("stop", async service => {
  console.log("> stop", service);
  socket.emit("status", service, 2);
  if (service in services) await stop(service);
  else socket.emit("status", service, 0);
  delete services[service];
});

async function start(service, port) {
  const cwd = "services/" + service;
  const config = JSON.parse(fs.readFileSync(cwd + "/gxlg-cluster.json"));

  socket.emit("status", service, 1);
  if (config.dependencies) {
    const i = spawn("sh", ["-c", [worker.install, ...config.dependencies].join(" ")]);
    const j = await new Promise(r => i.once("exit", c => r(c)));
    if (j != 0) {
      socket.emit("status", service, 3);
      return;
    }
  }
  if (config.setup) {
    for (const s of config.setup) {
      const i = spawn("sh", ["-c", s]);
      const j = await new Promise(r => i.once("exit", c => r(c)));
      if (j != 0) {
        socket.emit("status", service, 3);
        return;
      }
    }
  }

  let start = config.start;
  if (port) start = start.replaceAll("{port}", port);
  console.log("Starting", service);
  const proc = spawn("sh", ["-c", start], { cwd });
  proc.on("exit", async code => {
    if (code != 0 && code != null) {
      socket.emit("status", service, 3);
    }
    if (service in services) {
      const s = await services[service];
      s.open = false;
    }
  });
  proc.on("error", e => {
    console.error("Error from", service, e);
    socket.emit("status", service, 3);
  });
  proc.stdout.on("data", d => {
    process.stdout.write(service + " |v| " + d.toString());
  });
  proc.stderr.on("data", d => {
    process.stdout.write(service + " |x| " + d.toString());
  });

  services[service] = new Promise(res => {
    const spid = proc.pid;
    const sppd = spawnSync("ps", ["--ppid", spid, "-o", "pid:1="]);
    const pid = sppd.stdout.toString().trim() || proc.pid;

    res({ config, proc, pid, "open": true });
  });
  socket.emit("status", service, 4);
}

async function stop(service) {
  console.log("Stopping", service);
  const s = await services[service];
  const { config, proc, pid, open } = s;
  if (open) {
    let stop = config.stop;
    if (!stop) stop = "kill -INT {pid}";
    stop = stop.replaceAll("{pid}", pid);
    const p = new Promise(r => proc.once("exit", r));
    spawnSync("sh", ["-c", stop]);
    spawnSync("wait", [pid]);
    await p;
    s.open = false;
    console.log("Killed", service, "(" + pid + ")");
  }
  socket.emit("status", service, 0);
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
  rpio.write(37, rpio.LOW);
  rpio.close(37);
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

