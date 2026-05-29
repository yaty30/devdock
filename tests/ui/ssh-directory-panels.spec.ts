import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

const electronPath = require("electron") as string;
const appRoot = path.resolve(__dirname, "../..");
const expectedHomePath = getExpectedHomePath();

test.describe("SSH directory panels", () => {
  let electronApp: ElectronApplication;
  let page: Page;
  let tempRoot: string;

  test.beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ivs-ssh-dir-"));
    await mkdtemp(path.join(tempRoot, "alpha-"));
    await writeFile(path.join(tempRoot, "sample.txt"), "sample", "utf8");
    await writeFile(path.join(tempRoot, "second.txt"), "second", "utf8");

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
    await seedSshDirectoryState(page);
    await page.reload();
    await openSshTool(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("renders flat local and remote directory panels", async () => {
    const localPanel = directoryPanel(page, "Local Directory");
    const remotePanel = directoryPanel(
      page,
      "Remote: admin@promaxgb10-64b5",
    );

    await expect(localPanel).toBeVisible();
    await expect(remotePanel).toBeVisible();
    await expect(page.getByTestId("xterm-terminal-host")).toBeVisible();
    await expect(page.getByText("Drop here to upload")).toHaveCount(0);
    await expect(page.getByText("Drop here to download")).toHaveCount(0);

    await expectActionSet(localPanel, "Local Directory");
    await expectActionSet(remotePanel, "Remote Directory");
    await expectNavOrder(localPanel, [
      "Local Directory back",
      "Local Directory forward",
      "Local Directory home",
      "Local Directory refresh",
    ]);
    await expectNavOrder(remotePanel, [
      "Remote Directory back",
      "Remote Directory forward",
      "Remote Directory home",
      "Remote Directory refresh",
    ]);
    await expect(
      localPanel.getByRole("button", { name: "Local Directory parent directory" }),
    ).toHaveCount(0);
    await expect(localPanel.locator(".ssh-tree-chevron")).toHaveCount(0);
    await expect(remotePanel.locator(".ssh-tree-chevron")).toHaveCount(0);

    await expect(localPanel.getByLabel("Local Directory path")).toHaveValue(
      expectedHomePath,
    );
    await expect(
      remotePanel.getByLabel("Remote: admin@promaxgb10-64b5 path"),
    ).toHaveValue("");

    await expectTreeContent(localPanel, [
      "Name",
      "Size",
      "Modified",
    ]);
    await expectTreeContent(remotePanel, ["Name", "Size", "Modified"]);

    await expect(localPanel.locator(".ssh-file-tree-head")).not.toContainText(
      "Actions",
    );
    await expect(remotePanel.locator(".ssh-file-tree-head")).not.toContainText(
      "Actions",
    );
    await expect(localPanel.locator(".ssh-row-action-button").first()).toBeVisible();
    await expect(remotePanel.locator(".ssh-row-action-button")).toHaveCount(0);
  });

  test("renders xterm CLI with the directory panels", async () => {
    await expect(page.getByRole("heading", { name: "CLI" })).toBeVisible();
    await expect(page.getByTestId("xterm-terminal-host")).toBeVisible();
    await expect(page.getByLabel("SSH command")).toHaveCount(0);
    await expect(page.getByRole("listbox")).toHaveCount(0);

    const screen = page.getByTestId("ssh-tool-screen");
    await page.getByRole("button", { name: "Collapse command panel" }).click();
    await expect(screen).toHaveClass(/ssh-command-panel-collapsed/);
    await page.getByRole("button", { name: "Expand command panel" }).click();
    await expect(screen).not.toHaveClass(/ssh-command-panel-collapsed/);
  });

  test("manages SSH connections in the redesigned settings modal", async () => {
    await page.getByRole("button", { name: "SSH settings" }).click();

    const dialog = page.getByRole("dialog", { name: "SSH Settings" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".ssh-settings-layout")).toBeVisible();
    await expect(dialog.locator(".ssh-settings-table")).toHaveCount(0);
    await expect(settingsCard(dialog, "Local Dev")).toHaveClass(/selected/);
    await expect(dialog.getByText("promaxgb10-64b5 · admin")).toBeVisible();
    await expect(dialog.getByText("Staging API")).toBeVisible();
    await expect(dialog.getByText("Production")).toBeVisible();
    await expect(dialog.locator(".ssh-settings-status-badge")).toContainText("Disconnected");

    await settingsCard(dialog, "Staging API").click();
    await expect(dialog.getByLabel("Remote Name")).toHaveValue("Staging API");
    await expect(dialog.getByLabel("Address")).toHaveValue("10.0.1.18");
    await expect(dialog.getByLabel("Username")).toHaveValue("deploy");
    await expect(dialog.getByLabel("MACs")).toHaveValue("");
    await expect(dialog.getByLabel("Ciphers")).toHaveValue("");
    await expect(dialog.getByLabel("Retry attempts")).toBeDisabled();
    await expect(
      dialog.getByText("Retry settings are disabled while auto-reconnect is off."),
    ).toBeVisible();

    await dialog.getByText("Enable auto-reconnect").click();
    await expect(dialog.getByLabel("Retry attempts")).toBeEnabled();
    await dialog.getByLabel("Retry attempts").fill("5");
    await dialog.getByLabel("Retry delay in milliseconds").fill("4500");
    await dialog.getByLabel("MACs").fill("hmac-sha2-256 hmac-sha2-512");
    await dialog.getByLabel("Ciphers").fill("aes128-ctr");

    await dialog.getByRole("button", { name: "Add connection" }).last().click();
    await expect(dialog.getByLabel("Remote Name")).toHaveValue("");
    await dialog.getByLabel("Remote Name").fill("QA Jumpbox");
    await dialog.getByLabel("Address").fill("qa-jump-01");
    await dialog.getByLabel("Username").fill("qauser");
    await dialog.locator('input[aria-label="Password"]').fill("secret");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    await expectStoredSshServer(page, "QA Jumpbox");
    await expectStoredSshAlgorithms(page, "Staging API", {
      macs: "hmac-sha2-256,hmac-sha2-512",
      ciphers: "aes128-ctr",
    });

    await page.getByRole("button", { name: "SSH settings" }).click();
    const reopenedDialog = page.getByRole("dialog", { name: "SSH Settings" });
    await settingsCard(reopenedDialog, "QA Jumpbox").click();
    await reopenedDialog.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(reopenedDialog.getByText("QA Jumpbox")).toHaveCount(0);
    await reopenedDialog.getByRole("button", { name: "Save" }).click();

    await expectStoredSshServer(page, "QA Jumpbox", false);
  });

  test("navigates flat folders and manages local items", async () => {
    const localPanel = directoryPanel(page, "Local Directory");
    const remotePanel = directoryPanel(
      page,
      "Remote: admin@promaxgb10-64b5",
    );

    await expect(localPanel.getByLabel("Local Directory path")).toHaveValue(
      expectedHomePath,
    );
    await localPanel.getByLabel("Local Directory path").fill(tempRoot);
    await localPanel.getByLabel("Local Directory path").press("Enter");
    await expect(localPanel.getByLabel("Local Directory path")).toHaveValue(
      tempRoot,
    );

    const generatedFolder = localPanel.locator(".ssh-file-row").filter({
      hasText: /alpha-/,
    });
    await generatedFolder.click();
    await expect(localPanel.getByLabel("Local Directory path")).toHaveValue(
      /alpha-/,
    );

    await localPanel.getByRole("button", { name: "Local Directory back" }).click();
    await expect(localPanel.getByLabel("Local Directory path")).toHaveValue(tempRoot);

    await localPanel.getByRole("button", { name: "Local Directory new folder" }).click();
    await page.getByRole("dialog", { name: "New Folder" }).getByLabel("Folder name").fill("created");
    await page.getByRole("dialog", { name: "New Folder" }).getByRole("button", { name: "Create" }).click();
    await expect(localPanel.locator(".ssh-file-row").filter({ hasText: "created" })).toBeVisible();

    await localPanel
      .locator(".ssh-file-row")
      .filter({ hasText: "created" })
      .getByRole("button", { name: "created actions" })
      .click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByRole("dialog", { name: "Rename" }).getByLabel("New name").fill("renamed");
    await page.getByRole("dialog", { name: "Rename" }).getByRole("button", { name: "Rename" }).click();
    await expect(localPanel.locator(".ssh-file-row").filter({ hasText: "renamed" })).toBeVisible();
    await expect(localPanel.locator(".ssh-file-row").filter({ hasText: "created" })).toHaveCount(0);

    await localPanel
      .locator(".ssh-file-row")
      .filter({ hasText: "renamed" })
      .getByRole("button", { name: "renamed actions" })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(localPanel.locator(".ssh-file-row").filter({ hasText: "renamed" })).toHaveCount(0);

    await localPanel.locator(".ssh-file-row").filter({ hasText: "sample.txt" }).click();
    await expect(localPanel.locator(".ssh-file-row.selected").filter({ hasText: "sample.txt" })).toBeVisible();
    await closePreviewIfOpen(page);

    await localPanel.getByRole("button", {
      name: "Local Directory home",
    }).click();
    await expect(localPanel.getByLabel("Local Directory path")).toHaveValue(
      expectedHomePath,
    );

    await expect(
      remotePanel.getByLabel("Remote: admin@promaxgb10-64b5 path"),
    ).toHaveValue("");
  });

  test("uses single-select by default and Ctrl-click for multi-select", async () => {
    const localPanel = directoryPanel(page, "Local Directory");

    await localPanel.getByLabel("Local Directory path").fill(tempRoot);
    await localPanel.getByLabel("Local Directory path").press("Enter");

    const sampleRow = localPanel.locator(".ssh-file-row").filter({ hasText: "sample.txt" });
    const secondRow = localPanel.locator(".ssh-file-row").filter({ hasText: "second.txt" });

    await sampleRow.click();
    await closePreviewIfOpen(page);
    await expect(localPanel.locator(".ssh-file-row.selected")).toHaveCount(1);
    await expect(sampleRow).toHaveClass(/selected/);

    await secondRow.click();
    await closePreviewIfOpen(page);
    await expect(localPanel.locator(".ssh-file-row.selected")).toHaveCount(1);
    await expect(secondRow).toHaveClass(/selected/);
    await expect(sampleRow).not.toHaveClass(/selected/);

    await sampleRow.click({ modifiers: ["Control"] });
    await closePreviewIfOpen(page);
    await expect(localPanel.locator(".ssh-file-row.selected")).toHaveCount(2);

    await secondRow.click({ modifiers: ["Control"] });
    await closePreviewIfOpen(page);
    await expect(localPanel.locator(".ssh-file-row.selected")).toHaveCount(1);
    await expect(sampleRow).toHaveClass(/selected/);
    await expect(secondRow).not.toHaveClass(/selected/);
  });

  test("dismisses row action menu on Escape and scroll", async () => {
    const localPanel = directoryPanel(page, "Local Directory");

    await localPanel.getByLabel("Local Directory path").fill(tempRoot);
    await localPanel.getByLabel("Local Directory path").press("Enter");

    await localPanel
      .locator(".ssh-file-row")
      .filter({ hasText: "sample.txt" })
      .getByRole("button", { name: "sample.txt actions" })
      .click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);

    await localPanel
      .locator(".ssh-file-row")
      .filter({ hasText: "sample.txt" })
      .getByRole("button", { name: "sample.txt actions" })
      .click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.evaluate(() => document.dispatchEvent(new Event("scroll")));
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("stacks Monitor tables full width", async () => {
    await page.getByRole("tab", { name: "Monitor" }).click();

    const directoryPanelBox = await page
      .locator(".ssh-monitor-panel")
      .filter({ has: page.getByRole("heading", { name: "Directory Action Log" }) })
      .boundingBox();
    const terminalPanelBox = await page
      .locator(".ssh-monitor-panel")
      .filter({ has: page.getByRole("heading", { name: "Terminal Command Log" }) })
      .boundingBox();

    expect(directoryPanelBox).not.toBeNull();
    expect(terminalPanelBox).not.toBeNull();
    expect(directoryPanelBox!.y).toBeLessThan(terminalPanelBox!.y);
    expect(Math.abs(directoryPanelBox!.x - terminalPanelBox!.x)).toBeLessThan(2);
    expect(Math.abs(directoryPanelBox!.width - terminalPanelBox!.width)).toBeLessThan(2);
    await expect(page.locator(".directory-action-log-table thead")).toContainText("Location");
    await expect(page.locator(".terminal-command-log-table thead")).toContainText("Location");
    await expect(page.getByText("No directory actions yet.")).toBeVisible();
    await expect(page.getByText("No terminal commands yet.")).toBeVisible();
  });
});

function getExpectedHomePath(): string {
  const windowsHome = `${process.env.HOMEDRIVE ?? ""}${process.env.HOMEPATH ?? ""}`.trim();
  return windowsHome || os.homedir();
}

async function seedSshDirectoryState(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.setItem("ivs-dashboard-theme", "dark");
    window.localStorage.setItem("ivs-dashboard-accent", "pink");
    window.localStorage.setItem(
      "ivs-ssh-tool-servers",
      JSON.stringify([
        {
          id: "directory-preview-ssh",
          name: "Local Dev",
          address: "promaxgb10-64b5:22",
          username: "admin",
          password: "password",
          macs: "",
          ciphers: "",
          autoLogin: false,
          autoReconnect: false,
          maxReconnectAttempts: 3,
          reconnectDelayMs: 3000,
        },
        {
          id: "staging-api-ssh",
          name: "Staging API",
          address: "10.0.1.18",
          username: "deploy",
          password: "password",
          macs: "",
          ciphers: "",
          autoLogin: false,
          autoReconnect: false,
          maxReconnectAttempts: 3,
          reconnectDelayMs: 3000,
        },
        {
          id: "production-ssh",
          name: "Production",
          address: "prod-app-01",
          username: "root",
          password: "password",
          macs: "",
          ciphers: "",
          autoLogin: false,
          autoReconnect: false,
          maxReconnectAttempts: 3,
          reconnectDelayMs: 3000,
        },
      ]),
    );
    window.localStorage.setItem(
      "ivs-ssh-tool-selected-server",
      "directory-preview-ssh",
    );
  });
}

async function expectStoredSshServer(
  page: Page,
  name: string,
  expected = true,
): Promise<void> {
  await expect
    .poll(async () => {
      return page.evaluate((serverName) => {
        const stored = window.localStorage.getItem("ivs-ssh-tool-servers");
        if (!stored) {
          return false;
        }
        const servers = JSON.parse(stored) as Array<{ name?: string }>;
        return servers.some((server) => server.name === serverName);
      }, name);
    })
    .toBe(expected);
}

async function expectStoredSshAlgorithms(
  page: Page,
  name: string,
  expected: { macs: string; ciphers: string },
): Promise<void> {
  await expect
    .poll(async () => {
      return page.evaluate((payload) => {
        const stored = window.localStorage.getItem("ivs-ssh-tool-servers");
        if (!stored) {
          return null;
        }
        const servers = JSON.parse(stored) as Array<{
          name?: string;
          macs?: string;
          ciphers?: string;
        }>;
        const server = servers.find((candidate) => candidate.name === payload.name);
        return server ? { macs: server.macs ?? "", ciphers: server.ciphers ?? "" } : null;
      }, { name });
    })
    .toEqual(expected);
}

async function openSshTool(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "SSH" })).toBeVisible();
  await page.getByRole("button", { name: "SSH" }).click();
  await expect(page.getByTestId("xterm-terminal-host")).toBeVisible();
}

async function closePreviewIfOpen(page: Page): Promise<void> {
  const closeButton = page.getByRole("button", { name: "Close preview" });
  await closeButton.waitFor({ state: "visible", timeout: 3000 }).catch(() => undefined);
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    await expect(closeButton).toHaveCount(0);
  }
}

function directoryPanel(page: Page, title: string) {
  return page.locator(".ssh-directory-panel").filter({
    has: page.getByRole("heading", { name: title }),
  });
}

async function expectActionSet(panel: ReturnType<typeof directoryPanel>, label: string) {
  const actions = panel.getByLabel(`${label} actions`);
  await expect(actions.getByRole("button", { name: `${label} new folder` })).toBeVisible();
  await expect(actions.getByRole("button", { name: `${label} refresh` })).toBeVisible();
  await expect(actions.locator(".ssh-directory-action-button")).toHaveCount(2);
}

function settingsCard(dialog: ReturnType<Page["getByRole"]>, name: string) {
  return dialog.locator(".ssh-settings-connection-card").filter({ hasText: name });
}

async function expectNavOrder(
  panel: ReturnType<typeof directoryPanel>,
  labels: string[],
): Promise<void> {
  await expect
    .poll(() =>
      panel.locator(".ssh-path-nav-button").evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")),
      ),
    )
    .toEqual(labels);
}

async function expectTreeContent(
  panel: ReturnType<typeof directoryPanel>,
  values: string[],
): Promise<void> {
  for (const value of values) {
    await expect(panel.locator(".ssh-file-tree")).toContainText(value);
  }
}
