import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'build/main' }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'build/preload' }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    build: { outDir: resolve('build/renderer') }
  }
});
