const { spawn } = require('node:child_process');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const command = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite';
const child = spawn(command, ['dev'], {
  stdio: 'inherit',
  shell: true,
  env
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }

  process.exit(code ?? 0);
});
