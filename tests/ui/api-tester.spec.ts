import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import path from "node:path";

const electronPath = require("electron") as string;
const appRoot = path.resolve(__dirname, "../..");
const httpbinAnything = "https://httpbin.org/anything";

test.describe("API Tester", () => {
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    electronApp = await electron.launch({
      executablePath: electronPath,
      args: [appRoot],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
        IVS_DASHBOARD_TEST: "1",
      },
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() => {
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith("ivs-dashboard-api-tester"))
        .forEach((key) => window.localStorage.removeItem(key));
    });
    await page.reload();
    await openApiTester(page);
  });

  test.afterEach(async () => {
    await electronApp.close();
  });

  test("sends every supported HTTP method against a public echo API", async () => {
    test.slow();

    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      await selectMethod(page, method);
      await page.getByTestId("api-request-url").fill(httpbinAnything);

      if (!["GET", "HEAD"].includes(method)) {
        await requestBuilderTab(page, "Body").click();
        await page.getByLabel("Raw body content type").fill("application/json");
        await page
          .getByTestId("api-request-body")
          .fill(JSON.stringify({ method, source: "ivs-dashboard" }));
      }

      await sendAndWaitForHistory(page);
      await expect(page.getByTestId("api-response-status")).toContainText("200");

      if (!["HEAD", "OPTIONS"].includes(method)) {
        await page.getByRole("tab", { name: "Pretty" }).click();
        await expect(page.locator(".api-code-editor")).toContainText(`\"method\": \"${method}\"`);
      }
    }

    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.locator(".api-history-table tbody tr")).toHaveCount(7);
  });

  test("covers params, headers, auth, cookies, saved requests, response tabs, and history re-run", async () => {
    test.slow();

    await selectMethod(page, "GET");
    await page.getByTestId("api-request-url").fill("https://httpbin.org/cookies");

    await page.getByRole("button", { name: "Cookie settings" }).click();
    await page.getByRole("button", { name: "Add cookie" }).click();
    await page.getByLabel("Cookie name").fill("ivs_session");
    await page.getByLabel("Cookie value").fill("cookie-test");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await sendAndWaitForHistory(page);
    await expect(page.locator(".api-code-editor")).toContainText("ivs_session");

    await page.getByTestId("api-request-url").fill(httpbinAnything);
    await requestBuilderTab(page, "Params").click();
    await page.getByRole("button", { name: "Add Row" }).click();
    await page.getByLabel("Key").fill("search");
    await page.getByLabel("Value").fill("dashboard");

    await requestBuilderTab(page, "Headers").click();
    await page.getByRole("button", { name: "Add Row" }).click();
    await page.getByLabel("Header").last().fill("X-IVS-Test");
    await page.getByLabel("Value").last().fill("header-test");

    await requestBuilderTab(page, "Auth").click();
    await page.getByLabel("Bearer token").fill("secret-token");

    await sendAndWaitForHistory(page);
    await expect(page.locator(".api-code-editor")).toContainText("dashboard");
    await expect(page.locator(".api-code-editor")).toContainText("X-Ivs-Test");

    await responseTab(page, "Headers").click();
    await expect(page.locator(".api-response-table")).toContainText("content-type");
    await responseTab(page, "Cookies").click();
    await expect(page.locator(".api-response-table")).toContainText(/No cookies returned|set-cookie|cookie/i);
    await responseTab(page, "Raw").click();
    await expect(page.locator(".api-code-editor")).toContainText("header-test");

    await page.getByTestId("api-save-as-button").click();
    await page.getByLabel("File Name").fill("api-tester-ui-request");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.getByRole("button", { name: /Open saved API requests/ }).click();
    await expect(page.locator(".api-saved-requests-table")).toContainText("api-tester-ui-request");
    await page.getByRole("button", { name: "Open request" }).click();
    await expect(page.getByTestId("api-request-url")).toHaveValue(httpbinAnything);

    await page.getByRole("tab", { name: "History" }).click();
    await page.locator(".api-history-table tbody tr").first().click();
    await expect(page.locator(".api-history-detail-panel")).toContainText("Request");
    await page.getByRole("button", { name: /Re-run API test/ }).first().click();
    await expect.poll(() => apiHistoryCount(page), { timeout: 60000 }).toBeGreaterThan(2);
  });

  test("sends multipart form data including a file", async () => {
    test.slow();

    await selectMethod(page, "POST");
    await page.getByTestId("api-request-url").fill("https://httpbin.org/post");
    await requestBuilderTab(page, "Body").click();
    await page.getByTestId("api-body-form-data-tab").click();
    await page.getByLabel("Field").fill("upload");

    const fileChooser = page.waitForEvent("filechooser");
    await page.getByLabel("Upload file").click();
    await (await fileChooser).setFiles({
      name: "api-tester-sample.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello from api tester"),
    });

    await sendAndWaitForHistory(page);
    await expect(page.getByTestId("api-response-status")).toContainText("200");
    await expect(page.locator(".api-code-editor")).toContainText("hello from api tester");
    await expect(page.locator(".api-code-editor")).toContainText("files");
  });
});

async function openApiTester(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "API Tester" })).toBeVisible();
  await page.getByRole("button", { name: "API Tester" }).click();
  await expect(page.getByTestId("api-request-url")).toBeVisible();
}

async function selectMethod(page: Page, method: string): Promise<void> {
  const methodSelect = page.getByLabel("HTTP method");
  await methodSelect.click();
  await page.getByRole("option", { name: method }).click();
}

function requestBuilderTab(page: Page, name: string) {
  return page
    .getByLabel("Request builder", { exact: true })
    .getByRole("tab", { name });
}

function responseTab(page: Page, name: string) {
  return page.getByLabel("Response view").getByRole("tab", { name });
}

async function sendAndWaitForHistory(page: Page): Promise<void> {
  const before = await apiHistoryCount(page);
  await page.getByTestId("api-send-button").click();
  await expect.poll(() => apiHistoryCount(page), { timeout: 60000 }).toBe(before + 1);
}

async function apiHistoryCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith("ivs-dashboard-api-tester-history-metadata:"))
      .reduce((count, key) => {
        try {
          const rows = JSON.parse(window.localStorage.getItem(key) ?? "[]");
          return count + (Array.isArray(rows) ? rows.length : 0);
        } catch {
          return count;
        }
      }, 0),
  );
}
