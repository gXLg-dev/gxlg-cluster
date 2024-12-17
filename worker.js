const { io } = require("socket.io-client");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");
//const rpio = require("rpio");

const { main, worker } = require("./common-lib/config.js");

const socket = io("ws://" + main.ip + ":" + main.port);

const services = {};
let blink = true;
let identify = false;
(async () => {
  //rpio.open(37, rpio.OUTPUT, rpio.LOW);
  while (blink) {
    let ram = 0;
    for (const service in services) {
      const { open, config } = services[service];
      if (open) ram += config.ram;
    }
    const sleep = 1000 * (1 - ram / worker.ram);
    await new Promise(r => setTimeout(r, sleep));
    //rpio.msleep(sleep);
    //rpio.write(37, rpio.HIGH);
    if (identify) {
      console.log("identify");
      //rpio.msleep(4000);
      identify = false;
    } else {
      console.log("blink");
      //rpio.msleep(100);
    }
    //rpio.write(37, rpio.LOW);
  }
  //rpio.close(37);
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
  //const proc = spawn("firejail", ["--rlimit-as=" + config.ram + "m", "--", "sh", "-c", start], { cwd });
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
  await new Promise(r => setTimeout(r, 1000));

  // acquire PID of child process (child of firejail -> child of shell)
  const fpid = proc.pid;
  //const fps = spawnSync("ps", ["--ppid", fpid, "-o", "pid:1="]);
  //const spid = fps.stdout.toString().trim();
  //const sps = spawnSync("ps", ["--ppid", spid, "-o", "pid:1="]);
  //const pid = sps.stdout.toString().trim();
  const pid = fpid;

  services[service] = { config, proc, pid, "open": true };
  socket.emit("status", service, 4);
}

async function stop(service) {
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

socket.on("disconnect", async () => {
  for (const service in services) {
    await stop(service);
  }
});

socket.on("shutdown", () => {
  socket.close();
  blink = false;
});

process.on("SIGINT", () => {
  socket.close();
  blink = false;
});

