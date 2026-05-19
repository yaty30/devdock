import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: "test-results",
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
