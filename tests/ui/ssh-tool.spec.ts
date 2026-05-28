import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import path from "node:path";

const electronPath = require("electron") as string;
const appRoot = path.resolve(__dirname, "../..");

const sshHost = process.env.IVS_SSH_TEST_HOST ?? "127.0.0.1";
const sshPort = process.env.IVS_SSH_TEST_PORT ?? "2222";
const sshUsername = process.env.IVS_SSH_TEST_USERNAME ?? "guest";
const sshPassword = process.env.IVS_SSH_TEST_PASSWORD;

test.describe("SSH Tool", () => {
  let electronApp: ElectronApplication;
  let page: Page;

  test.skip(
    !sshPassword,
    "Set IVS_SSH_TEST_PASSWORD to run the SSH integration test.",
  );

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

  test("connects and runs a command without leaking shell markers", async () => {
    test.slow();

    const terminal = page.getByTestId("ssh-terminal");
    await page.getByRole("button", { name: "Connect SSH" }).click();
    await expect(page.locator(".ssh-status")).toContainText("Connected", {
      timeout: 45000,
    });
    await expect(terminal).toContainText(
      `Connected to ${sshUsername}@${sshHost}:${sshPort}.`,
    );
    await expect(
      directoryPanel(page, `Remote: ${sshUsername}@${sshHost}`).getByLabel(
        `Remote: ${sshUsername}@${sshHost} path`,
      ),
    ).not.toHaveValue("");

    await page.getByLabel("SSH command").fill("ls");
    await page.getByRole("button", { name: "Run" }).click();

    await expect(terminal).toContainText(/logs|notes\.txt|project/, {
      timeout: 45000,
    });
    await expect(terminal).not.toContainText("__IVS_");
    await expect(terminal).not.toContainText("Unable to exec");
  });

  test("keeps prompt visible after clear and toggles the command panel", async () => {
    test.slow();

    const terminal = page.getByTestId("ssh-terminal");
    const screen = page.getByTestId("ssh-tool-screen");

    await page.getByRole("button", { name: "Connect SSH" }).click();
    await expect(page.locator(".ssh-status")).toContainText("Connected", {
      timeout: 45000,
    });
    await expect(page.getByRole("button", { name: "Disconnect SSH" })).toBeVisible();

    await page.getByLabel("SSH command").fill("clear");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(terminal).toContainText(`${sshUsername}@${sshHost} >`);
    await expect(terminal).not.toHaveText("");

    await page.getByRole("button", { name: "Collapse command panel" }).click();
    await expect(screen).toHaveClass(/ssh-command-panel-collapsed/);
    await expect(page.getByRole("button", { name: "Expand command panel" })).toBeVisible();
    await expect.poll(() => getCollapsedDirectoryLayout(page)).toEqual({
      columns: 2,
      balanced: true,
    });

    await page.getByRole("button", { name: "Expand command panel" }).click();
    await expect(screen).not.toHaveClass(/ssh-command-panel-collapsed/);
    await expect(page.getByLabel("SSH command")).toBeVisible();

    await page.getByRole("button", { name: "Disconnect SSH" }).click();
    await expect(page.locator(".ssh-status")).toContainText("Disconnected");
    await expect(page.getByRole("button", { name: "Connect SSH" })).toBeVisible();
  });
});

async function openSshTool(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "SSH" })).toBeVisible();
  await page.getByRole("button", { name: "SSH" }).click();
  await expect(page.getByLabel("SSH command")).toBeVisible();
}

function directoryPanel(page: Page, title: string) {
  return page.locator(".ssh-directory-panel").filter({
    has: page.getByRole("heading", { name: title }),
  });
}

async function getCollapsedDirectoryLayout(
  page: Page,
): Promise<{ columns: number; balanced: boolean }> {
  return page.locator(".ssh-directory-panel").evaluateAll((panels) => {
    if (panels.length !== 2) {
      return { columns: panels.length, balanced: false };
    }

    const [left, right] = panels.map((panel) =>
      panel.getBoundingClientRect(),
    );
    const sideBySide = Math.abs(left.top - right.top) < 4 && right.left > left.right;
    const widthDelta = Math.abs(left.width - right.width);

    return {
      columns: sideBySide ? 2 : 1,
      balanced: sideBySide && widthDelta <= 8,
    };
  });
}
