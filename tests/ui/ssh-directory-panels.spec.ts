import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import path from "node:path";

const electronPath = require("electron") as string;
const appRoot = path.resolve(__dirname, "../..");

test.describe("SSH directory panels", () => {
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
    await seedSshDirectoryState(page);
    await page.reload();
    await openSshTool(page);
  });

  test.afterEach(async () => {
    await electronApp?.close();
  });

  test("renders compact tree-view local and remote directory panels", async () => {
    const localPanel = directoryPanel(page, "Local Directory");
    const remotePanel = directoryPanel(
      page,
      "Remote: admin@promaxgb10-64b5",
    );

    await expect(localPanel).toBeVisible();
    await expect(remotePanel).toBeVisible();
    await expect(page.getByTestId("ssh-terminal")).toBeVisible();
    await expect(page.getByText("Drop here to upload")).toHaveCount(0);
    await expect(page.getByText("Drop here to download")).toHaveCount(0);

    await expectActionSet(localPanel, "Local Directory");
    await expectActionSet(remotePanel, "Remote Directory");
    await expectNavOrder(localPanel, [
      "Local Directory back",
      "Local Directory forward",
      "Local Directory parent directory",
      "Local Directory home",
    ]);
    await expectNavOrder(remotePanel, [
      "Remote Directory back",
      "Remote Directory forward",
      "Remote Directory parent directory",
      "Remote Directory home",
    ]);

    await expect(localPanel.getByLabel("Local Directory path")).toHaveValue(
      "D:/Projects/ivs-dashboard",
    );
    await expect(
      remotePanel.getByLabel("Remote: admin@promaxgb10-64b5 path"),
    ).toHaveValue("/var/www/app");

    await expectTreeContent(localPanel, [
      "Name",
      "Size",
      "Modified",
      "src",
      "components",
      "pages",
      "assets",
      ".env.local",
      "package.json",
      "2 KB",
      "5 KB",
      "Today 08:16",
      "Yesterday 17:31",
    ]);
    await expectTreeContent(remotePanel, [
      "app",
      "Http",
      "Models",
      "Providers",
      "logs",
      ".env",
      "README.md",
      "1 KB",
      "3 KB",
      "May 27 09:58",
      "May 26 15:22",
    ]);

    await expect(localPanel.locator(".ssh-file-tree-head")).not.toContainText(
      "Actions",
    );
    await expect(remotePanel.locator(".ssh-file-tree-head")).not.toContainText(
      "Actions",
    );
    await expect(localPanel.locator(".ssh-row-action-button")).toHaveCount(6);
    await expect(remotePanel.locator(".ssh-row-action-button")).toHaveCount(7);
    await expect(localPanel.locator(".ssh-file-row-depth-1")).toHaveCount(3);
    await expect(remotePanel.locator(".ssh-file-row-depth-1")).toHaveCount(3);
  });

  test("keeps directory path controls editable and navigable", async () => {
    const localPanel = directoryPanel(page, "Local Directory");
    const remotePanel = directoryPanel(
      page,
      "Remote: admin@promaxgb10-64b5",
    );

    await localPanel.getByLabel("Local Directory path").fill("D:/Projects");
    await expect(localPanel.getByLabel("Local Directory path")).toHaveValue(
      "D:/Projects",
    );
    await localPanel.getByRole("button", {
      name: "Local Directory home",
    }).click();
    await expect(localPanel.getByLabel("Local Directory path")).toHaveValue(
      "D:/Projects/ivs-dashboard",
    );

    await remotePanel
      .getByRole("button", { name: "Remote Directory parent directory" })
      .click();
    await expect(
      remotePanel.getByLabel("Remote: admin@promaxgb10-64b5 path"),
    ).toHaveValue("/var/www");
    await remotePanel
      .getByRole("button", { name: "Remote Directory home" })
      .click();
    await expect(
      remotePanel.getByLabel("Remote: admin@promaxgb10-64b5 path"),
    ).toHaveValue("/var/www/app");
  });
});

async function seedSshDirectoryState(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.setItem("ivs-dashboard-theme", "dark");
    window.localStorage.setItem("ivs-dashboard-accent", "pink");
    window.localStorage.setItem(
      "ivs-ssh-tool-servers",
      JSON.stringify([
        {
          id: "directory-preview-ssh",
          name: "Promax Preview",
          address: "promaxgb10-64b5:22",
          username: "admin",
          password: "password",
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

async function expectActionSet(panel: ReturnType<typeof directoryPanel>, label: string) {
  await expect(panel.getByRole("button", { name: `${label} upload` })).toBeVisible();
  await expect(panel.getByRole("button", { name: `${label} download` })).toBeVisible();
  await expect(panel.getByRole("button", { name: `${label} new folder` })).toBeVisible();
  await expect(panel.getByRole("button", { name: `${label} refresh` })).toBeVisible();
  await expect(panel.getByRole("button", { name: `${label} more options` })).toBeVisible();
  await expect(panel.locator(".ssh-directory-action-button")).toHaveCount(5);
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
