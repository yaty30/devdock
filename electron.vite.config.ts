import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const appVersion = JSON.parse(
  readFileSync(resolve("package.json"), "utf8"),
).version;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: "build/main" },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: "build/preload" },
  },
  renderer: {
    root: resolve("src/renderer"),
    base: "./",
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    build: { outDir: resolve("build/renderer") },
  },
});
