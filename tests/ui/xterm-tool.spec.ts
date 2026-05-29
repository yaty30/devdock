import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import path from "node:path";

const electronPath = require("electron") as string;
const appRoot = path.resolve(__dirname, "../..");

test.describe("SSH xterm CLI", () => {
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
    await openSshTool(page);
  });

  test.afterEach(async () => {
    try {
      await electronApp?.close();
    } catch {
      // ignore
    }
  });

  test("xterm IPC bridge spawns a node-pty session and echoes input back", async () => {
    // Drive the bridged IPC directly. xterm.js renders to canvas, so DOM
    // assertions cannot read terminal output — exercising the preload API
    // proves the full main<->renderer round-trip works.
    const result = await page.evaluate(async () => {
      const api = (
        window as unknown as {
          ivsDashboard: {
            xtermCreateSession: (req?: {
              cols?: number;
              rows?: number;
            }) => Promise<{
              ok: boolean;
              sessionId: string | null;
              shell?: string;
              error?: string;
            }>;
            xtermInput: (
              id: string,
              data: string,
            ) => Promise<{ ok: boolean; error?: string }>;
            xtermKillSession: (
              id: string,
            ) => Promise<{ ok: boolean; error?: string }>;
            onXtermData: (
              listener: (event: { sessionId: string; data: string }) => void,
            ) => () => void;
          };
        }
      ).ivsDashboard;

      const created = await api.xtermCreateSession({ cols: 100, rows: 30 });
      if (!created.ok || !created.sessionId) {
        return {
          ok: false,
          shell: created.shell ?? "",
          tail: `create failed: ${created.error ?? "unknown"}`,
        };
      }
      const id = created.sessionId;

      const chunks: string[] = [];
      const off = api.onXtermData((event) => {
        if (event.sessionId === id) {
          chunks.push(event.data);
        }
      });

      const wait = (ms: number): Promise<void> =>
        new Promise((resolve) => setTimeout(resolve, ms));
      const collect = async (
        marker: string,
        timeoutMs: number,
      ): Promise<boolean> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (chunks.join("").includes(marker)) {
            return true;
          }
          await wait(150);
        }
        return false;
      };

      // Give the shell a moment to print its prompt before sending input.
      await wait(800);

      await api.xtermInput(id, "echo ivs-xterm-marker-OK\r");

      const seen = await collect("ivs-xterm-marker-OK", 15000);

      off();
      await api.xtermKillSession(id);

      return {
        ok: seen,
        shell: created.shell ?? "",
        tail: chunks.join("").slice(-400),
      };
    });

    expect(
      result.ok,
      `marker not seen in PTY output. shell=${result.shell} tail=${result.tail}`,
    ).toBe(true);
    expect(result.shell.length).toBeGreaterThan(0);
  });

  test("SSH tab uses xterm CLI and the temporary Xterm tab is removed", async () => {
    await expect(page.getByRole("tab", { name: "SSH" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Monitor" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Xterm" })).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "CLI" })).toBeVisible();
    await expect(page.getByTestId("xterm-terminal-host")).toBeVisible();
    await expect(page.getByTestId("ssh-terminal")).toHaveCount(0);

    await page
      .getByRole("button", { name: "Collapse command panel" })
      .click({ force: true });
    await expect(page.getByTestId("xterm-terminal-host")).toBeHidden();
    await page
      .getByRole("button", { name: "Expand command panel" })
      .click({ force: true });
    await expect(page.getByTestId("xterm-terminal-host")).toBeVisible();

    await page.getByRole("tab", { name: "Monitor" }).click();
    await expect(page.getByText("Directory Action Log")).toBeVisible();
    await expect(page.getByTestId("xterm-terminal-host")).toBeHidden();
  });
});

async function openSshTool(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "SSH" })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "SSH" }).click();
  await expect(page.getByRole("tab", { name: "Monitor" })).toBeVisible();
  await dismissAnyModal(page);
}

async function dismissAnyModal(page: Page): Promise<void> {
  // The SSH tool may auto-open the connection settings modal when no
  // password is configured. Close it so it doesn't intercept tab clicks.
  const backdrop = page.locator(".modal-backdrop");
  for (let i = 0; i < 20; i += 1) {
    if ((await backdrop.count()) === 0) {
      return;
    }
    const cancel = backdrop.getByRole("button", { name: /^Cancel$/ }).first();
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click({ force: true }).catch(() => undefined);
    } else {
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(150);
  }
}
