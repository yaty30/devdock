const { spawn } = require("node:child_process");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const command =
  process.platform === "win32" ? "electron-forge.cmd" : "electron-forge";
const child = spawn(command, ["start"], {
  stdio: "inherit",
  shell: true,
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }

  process.exit(code ?? 0);
});
