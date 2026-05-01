const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const shellCommand = isWindows ? process.env.ComSpec || "cmd.exe" : "sh";
const shellArgs = isWindows ? ["/c"] : ["-c"];

const children = [
  spawn(npmCommand, ["--prefix", "frontend", "run", "dev"], {
    cwd: root,
    stdio: "inherit",
  }),
  spawn(
    shellCommand,
    [...shellArgs, isWindows ? "wildfly\\bin\\start-rvdiap.bat" : "sh wildfly/bin/start-rvdiap.sh"],
    {
      cwd: root,
      stdio: "inherit",
    },
  ),
];

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}

for (const child of children) {
  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      shutdown(code || 1);
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
