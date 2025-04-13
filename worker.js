const { io } = require("socket.io-client");
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");

const raspi = require("./common-lib/raspi.js");
const rpio = raspi ? require("rpio") : null;

const { main, worker } = require("./common-lib/config.js");
const name = require("./worker-lib/name");

const socket = io("ws://" + main.ip + ":" + main.port);

const services = {};

let ts = Date.now();
const tstart = Date.now();

socket.on("sync", t => {
  ts = t;
});

let blink = true;
let identify = false;
if (raspi) {
  (async () => {
    rpio.open(37, rpio.OUTPUT, rpio.LOW);
    while (blink) {
      let ram = 0;
      for (const service in services) {
        const { open, config } = await services[service];
        if (open) ram += config.ram;
      }

      const tacts = Math.max(1, Math.ceil(16 * ram / worker.ram));
      const pass = (Date.now() - tstart) % 4000;
      const sleep = (ts % 4000 - pass + 4000) % 4000;
      await new Promise(r => setTimeout(r, sleep))

      if (identify) {
        rpio.write(37, rpio.HIGH);
        await new Promise(r => setTimeout(r, 4000))
        rpio.write(37, rpio.LOW);
      } else {
        const st = Date.now();
        for (let i = 0; i < tacts; i++) {
          const d = Date.now();
          rpio.write(37, rpio.HIGH);
          await new Promise(r => setTimeout(r, st + i * 250 - d + 100));
          rpio.write(37, rpio.LOW);
          await new Promise(r => setTimeout(r, st + i * 250 - d + 150));
        }
      }
    }
    console.log("end");
  })();
}

socket.on("whoareyou", () => {
  socket.emit("iam", name);
});

socket.on("temp", () => {
  socket.emit("temp", raspi ? (
    spawnSync("vcgencmd", ["measure_temp"]).stdout.toString().split("=")[1].trim()
  ) : "N/A");
});

socket.on("identify", () => {
  identify = true;
});

socket.on("start", (service, port) => start(service, port));
socket.on("stop", async service => {
  console.log("> stop", service);
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
  const pipe = fs.createWriteStream("./worker-logs/" + service + ".txt");

  const proc = spawn("sh", ["-c", start], { cwd });
  proc.on("close", () => pipe.end());
  proc.on("exit", async code => {
    if (service in services) {
      const s = await services[service];
      if (code != 0 && code != null && s.open) {
        socket.emit("status", service, 3);
      }
      s.open = false;
    }
  });
  proc.on("error", e => {
    console.error("Error from", service, e);
    socket.emit("status", service, 3);
  });
  proc.stdout.on("data", d => pipe.write("Log: " + d));
  proc.stderr.on("data", d => pipe.write("Err: " + d));

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
  socket.emit("status", service, 2);
  const s = await services[service];
  const { config, proc, pid, open } = s;
  if (open) {
    let stop = config.stop;
    if (!stop) stop = "kill -INT {pid}";
    stop = stop.replaceAll("{pid}", pid);
    const p = new Promise(r => proc.once("exit", r));
    s.open = false;
    spawnSync("sh", ["-c", stop]);
    const kill = setTimeout(() => {
      console.log("Force killing", service);
      proc.kill("SIGKILL");
    }, 5000);
    await p;
    clearTimeout(kill);
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
  if (raspi) {
    rpio.write(37, rpio.LOW);
    rpio.close(37);
  }
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

