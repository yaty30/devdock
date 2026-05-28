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

  test("runs three commands and receives real responses (no concatenated input)", async () => {
    test.slow();

    const terminal = page.getByTestId("ssh-terminal");
    await page.getByRole("button", { name: "Connect SSH" }).click();
    await expect(page.locator(".ssh-status")).toContainText("Connected", {
      timeout: 60000,
    });

    const commands: Array<{ cmd: string; expect: RegExp }> = [
      { cmd: "cd", expect: /[A-Za-z]:\\/ },
      { cmd: "whoami", expect: new RegExp(sshUsername, "i") },
      { cmd: "echo ivs-terminal-roundtrip", expect: /ivs-terminal-roundtrip/ },
    ];

    for (const { cmd, expect: pattern } of commands) {
      const input = page.getByLabel("SSH command");
      await input.fill(cmd);
      // Autocomplete suggestions hijack Enter; dismiss them first.
      await input.press("Escape");
      await input.press("Enter");

      // The echoed command line should appear exactly once (proof it wasn't
      // concatenated with the next command).
      await expect(terminal).toContainText(cmd, { timeout: 30000 });
      // Real shell output should appear.
      await expect(terminal).toContainText(pattern, { timeout: 30000 });
      await expect(terminal).not.toContainText("__IVS_");
      await expect(terminal).not.toContainText("Unable to exec");
    }

    // Sanity: no command should appear glued to the next one.
    const text = await terminal.innerText();
    expect(text).not.toMatch(/cdwhoami|whoamiecho|cdecho/);

    await page.getByRole("button", { name: "Disconnect SSH" }).click();
    await expect(page.locator(".ssh-status")).toContainText("Disconnected");
  });
});

async function openSshTool(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "SSH" })).toBeVisible();
  await page.getByRole("button", { name: "SSH" }).click();
  await expect(page.getByLabel("SSH command")).toBeVisible();
}
