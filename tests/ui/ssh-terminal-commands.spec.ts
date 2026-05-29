import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import path from "node:path";

const electronPath = require("electron") as string;
const appRoot = path.resolve(__dirname, "../..");

// Connection details supplied by the user.
const sshHost = process.env.IVS_SSH_TEST_HOST ?? "192.168.50.107";
const sshPort = process.env.IVS_SSH_TEST_PORT ?? "3333";
const sshUsername = process.env.IVS_SSH_TEST_USERNAME ?? "root";
const sshPassword = process.env.IVS_SSH_TEST_PASSWORD ?? "root";

test.describe("SSH terminal command round-trips", () => {
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    const launchEnv = { ...process.env };
    delete launchEnv.ELECTRON_RUN_AS_NODE;

    electronApp = await electron.launch({
      executablePath: electronPath,
      args: [appRoot],
      env: {
        ...launchEnv,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        IVS_DASHBOARD_TEST: "1",
      },
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(
      ({ host, port, username, password }) => {
        window.localStorage.setItem(
          "ivs-ssh-tool-servers",
          JSON.stringify([
            {
              id: "playwright-ssh",
              name: "Playwright SSH",
              address: `${host}:${port}`,
              port: Number(port),
              username,
              password,
              autoLogin: false,
              autoReconnect: false,
              maxReconnectAttempts: 3,
              reconnectDelayMs: 3000,
            },
          ]),
        );
        window.localStorage.setItem(
          "ivs-ssh-tool-selected-server",
          "playwright-ssh",
        );
      },
      {
        host: sshHost,
        port: sshPort,
        username: sshUsername,
        password: sshPassword,
      },
    );
    await page.reload();
    await openSshTool(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
  });

  test("connects with the xterm-backed SSH CLI", async () => {
    test.slow();

    const terminal = page.getByTestId("xterm-terminal-host");
    await page.getByRole("button", { name: "Connect SSH" }).click();
    await expect(page.locator(".ssh-status")).toContainText("Connected", {
      timeout: 60000,
    });
    await expect(terminal).toBeVisible();
    await expect(page.locator(".ssh-cli-panel .xterm-status")).toContainText(
      "SSH:",
      { timeout: 30000 },
    );
    await expect(page.getByLabel("SSH command")).toHaveCount(0);

    await terminal.click();
    await page.keyboard.type("echo ivs-terminal-roundtrip");
    await page.keyboard.press("Enter");

    await page.getByRole("button", { name: "Disconnect SSH" }).click();
    await expect(page.locator(".ssh-status")).toContainText("Disconnected");
  });
});

async function openSshTool(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "SSH" })).toBeVisible();
  await page.getByRole("button", { name: "SSH" }).click();
  await expect(page.getByTestId("xterm-terminal-host")).toBeVisible();
}
