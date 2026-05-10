import started from "electron-squirrel-startup";
import {
  app,
  BrowserWindow,
  Notification,
  dialog,
  ipcMain,
  shell,
} from "electron";
import type { OpenDialogOptions, SaveDialogOptions } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DashboardBackend } from "./dashboardBackend";
import { ChatService } from "./chatService";
import os from "os";
import type {
  BuildQueryOptions,
  DatabaseConnection,
  ProjectSettingsRecord,
  ServiceAction,
  ServiceName,
  BrowsePathOptions,
  DatabaseWorksheetState,
  LogChannel,
  SheetUpdate,
  ApiTesterRequest,
  ApiTesterResponse,
  RecentBuildRecord,
} from "../shared/dashboardTypes";
import type {
  ChatNativeNotification,
  ChatServiceConfig,
  ChatUserProfile,
} from "../shared/chatTypes";

if (started) {
  app.quit();
  process.exit(0);
}

const APP_NAME = "IVS Dashboard";
const APP_USER_MODEL_ID = "com.yaty.ivs-dashboard";
app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

loadEnvironmentFile();

let backend: DashboardBackend | null = null;
let chatService: ChatService | null = null;
let chatConfig: ChatServiceConfig | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const EXIT_AFTER_SHUTDOWN_DELAY_MS = 1000;
const DATABASE_EXPORT_RESULT_CHANNEL = "database:exportResult";
const API_TESTER_REQUEST_CHANNEL = "apiTester:sendRequest";
const CHAT_ENABLED = readBooleanEnvironmentFlag("ENABLE_CHAT", true);
const DEFAULT_CHAT_PORT = Number(
  process.env.IVS_DASHBOARD_CHAT_PORT ?? "43781",
);
// const DEFAULT_CHAT_ROOT =
//   process.env.IVS_DASHBOARD_CHAT_ROOT ??
//   // "L:\\ABS\\JamesYip\\Host\\Helper\\IVS-Dashboard\\chat";
//   String.raw`\\DESKTOP-Q97PLV1\chat`;

const DEFAULT_CHAT_ROOT =
  process.env.IVS_DASHBOARD_CHAT_ROOT ??
  (os.platform() === "win32"
    ? String.raw`\\DESKTOP-Q97PLV1\chat`
    : "/Volumes/chat");
const DEFAULT_CHAT_SERVICE_HOST =
  process.env.IVS_DASHBOARD_CHAT_HOST ??
  uncHostFromPath(DEFAULT_CHAT_ROOT) ??
  "127.0.0.1";
const DEFAULT_CHAT_BIND_HOST =
  process.env.IVS_DASHBOARD_CHAT_BIND_HOST ??
  (isLoopbackHost(DEFAULT_CHAT_SERVICE_HOST)
    ? DEFAULT_CHAT_SERVICE_HOST
    : "0.0.0.0");

function getBackend(): DashboardBackend {
  if (!backend) {
    throw new Error("Dashboard backend has not been initialized.");
  }

  return backend;
}

function registerIpc(): void {
  console.info("[main:ipc] registering IPC handlers");
  ipcMain.handle("dashboard:getFeatureFlags", () =>
    withLoggedErrors("dashboard:getFeatureFlags", () => ({
      chatEnabled: CHAT_ENABLED,
    })),
  );
  ipcMain.handle(
    API_TESTER_REQUEST_CHANNEL,
    (_event, request: ApiTesterRequest) =>
      withLoggedErrors(API_TESTER_REQUEST_CHANNEL, () =>
        sendApiTesterRequest(request),
      ),
  );
  ipcMain.handle("dashboard:getSnapshot", () =>
    withLoggedErrors("dashboard:getSnapshot", () => getBackend().getSnapshot()),
  );
  ipcMain.handle("database:getConnections", () =>
    withLoggedErrors("database:getConnections", () =>
      getBackend().getDatabaseConnections(),
    ),
  );
  ipcMain.handle(
    "database:saveConnection",
    (_event, connection: DatabaseConnection) =>
      withLoggedErrors("database:saveConnection", () =>
        getBackend().saveDatabaseConnection(connection),
      ),
  );
  ipcMain.handle(
    "database:updateConnectionSettings",
    (
      _event,
      connectionId: string,
      updates: Parameters<
        DashboardBackend["updateDatabaseConnectionSettings"]
      >[1],
    ) =>
      withLoggedErrors("database:updateConnectionSettings", () =>
        getBackend().updateDatabaseConnectionSettings(connectionId, updates),
      ),
  );
  ipcMain.handle("database:deleteConnection", (_event, connectionId: string) =>
    withLoggedErrors("database:deleteConnection", () =>
      getBackend().deleteDatabaseConnection(connectionId),
    ),
  );
  ipcMain.handle(
    "database:testConnection",
    (_event, connection: DatabaseConnection) =>
      withLoggedErrors("database:testConnection", () =>
        getBackend().testDatabaseConnection(connection),
      ),
  );
  ipcMain.handle(
    "database:getMetadata",
    (_event, connection: DatabaseConnection) =>
      withLoggedErrors("database:getMetadata", () =>
        getBackend().getDatabaseMetadata(connection),
      ),
  );
  ipcMain.handle("database:getWorksheetState", (_event, connectionId: string) =>
    withLoggedErrors("database:getWorksheetState", () =>
      getBackend().getDatabaseWorksheetState(connectionId),
    ),
  );
  ipcMain.handle(
    "database:saveWorksheetState",
    (_event, state: DatabaseWorksheetState) =>
      withLoggedErrors("database:saveWorksheetState", () =>
        getBackend().saveDatabaseWorksheetState(state),
      ),
  );
  ipcMain.handle(
    "database:deleteWorksheet",
    (_event, connectionId: string, sheetId: string) =>
      withLoggedErrors("database:deleteWorksheet", () =>
        getBackend().deleteDatabaseWorksheet(connectionId, sheetId),
      ),
  );
  ipcMain.handle(
    "database:getExecutionHistory",
    (_event, connectionId?: string) =>
      withLoggedErrors("database:getExecutionHistory", () =>
        getBackend().getDatabaseExecutionHistory(connectionId),
      ),
  );
  ipcMain.handle(
    "database:executeStatements",
    (_event, connection: DatabaseConnection, statements: string[]) =>
      withLoggedErrors("database:executeStatements", () =>
        getBackend().executeDatabaseStatements(connection, statements),
      ),
  );
  ipcMain.handle(
    DATABASE_EXPORT_RESULT_CHANNEL,
    async (event, fileName: string, contentBase64: string) =>
      withLoggedErrors(DATABASE_EXPORT_RESULT_CHANNEL, async () => {
        const suggestedFileName = sanitizeExportFileName(fileName);
        console.info(`[main:ipc] ${DATABASE_EXPORT_RESULT_CHANNEL} invoked`, {
          fileName: suggestedFileName,
          byteLength: Buffer.byteLength(contentBase64, "base64"),
        });

        const window = BrowserWindow.fromWebContents(event.sender);
        const dialogOptions: SaveDialogOptions = {
          title: "Export query results",
          defaultPath: join(app.getPath("documents"), suggestedFileName),
          filters: getDatabaseExportFilters(suggestedFileName),
          properties: ["createDirectory", "showOverwriteConfirmation"],
        };
        const saveResult = window
          ? await dialog.showSaveDialog(window, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions);

        if (saveResult.canceled || !saveResult.filePath) {
          console.info(`[main:ipc] ${DATABASE_EXPORT_RESULT_CHANNEL} canceled`);
          return { success: false, canceled: true } as const;
        }

        const result = getBackend().exportDatabaseResult(
          saveResult.filePath,
          contentBase64,
        );
        console.info(`[main:ipc] ${DATABASE_EXPORT_RESULT_CHANNEL} completed`, {
          path: result.success ? result.path : undefined,
        });
        return result;
      }),
  );
  console.info(`[main:ipc] registered ${DATABASE_EXPORT_RESULT_CHANNEL}`);
  ipcMain.handle("dashboard:getDashboardOverview", () =>
    withLoggedErrors("dashboard:getDashboardOverview", () =>
      getBackend().getDashboardOverview(),
    ),
  );
  ipcMain.handle("dashboard:getProjectState", (_event, projectId: string) =>
    withLoggedErrors("dashboard:getProjectState", () =>
      getBackend().getProjectState(projectId),
    ),
  );
  ipcMain.handle(
    "dashboard:saveProjectSettings",
    (_event, projectId: string, settings: ProjectSettingsRecord) =>
      withLoggedErrors("dashboard:saveProjectSettings", () =>
        getBackend().saveProjectSettings(projectId, settings),
      ),
  );
  ipcMain.handle(
    "dashboard:serviceAction",
    (_event, projectId: string, service: ServiceName, action: ServiceAction) =>
      withLoggedErrors("dashboard:serviceAction", () =>
        getBackend().serviceAction(projectId, service, action),
      ),
  );
  ipcMain.handle(
    "dashboard:runBuild",
    (_event, projectId: string, profileId: string) =>
      withLoggedErrors("dashboard:runBuild", async () => {
        const build = await getBackend().runBuild(projectId, profileId);
        const project = getBackend()
          .getSnapshot()
          .projects.find((item) => item.id === projectId);
        showBuildNotification(
          build,
          project?.name ?? projectId,
          getBackend().getWarDirectory(projectId),
        );
        return build;
      }),
  );
  ipcMain.handle("dashboard:stopBuild", (_event, projectId: string) =>
    withLoggedErrors("dashboard:stopBuild", () =>
      getBackend().stopBuild(projectId),
    ),
  );
  ipcMain.handle(
    "dashboard:getBuilds",
    (_event, projectId: string, options?: BuildQueryOptions) =>
      withLoggedErrors("dashboard:getBuilds", () =>
        getBackend().getBuilds(projectId, options),
      ),
  );
  ipcMain.handle("dashboard:refreshStatus", (_event, projectId: string) =>
    withLoggedErrors("dashboard:refreshStatus", () =>
      getBackend().refreshStatus(projectId),
    ),
  );
  ipcMain.handle("dashboard:getGitStatus", (_event, projectId: string) =>
    withLoggedErrors("dashboard:getGitStatus", () =>
      getBackend().getGitStatus(projectId),
    ),
  );
  ipcMain.handle(
    "dashboard:runGitCommand",
    (_event, projectId: string, args: string) =>
      withLoggedErrors("dashboard:runGitCommand", () =>
        getBackend().runGitCommand(projectId, args),
      ),
  );
  ipcMain.handle("dashboard:getSheets", (_event, projectId: string) =>
    withLoggedErrors("dashboard:getSheets", () =>
      getBackend().getSheets(projectId),
    ),
  );
  ipcMain.handle(
    "dashboard:createSheet",
    (_event, projectId: string, title: string) =>
      withLoggedErrors("dashboard:createSheet", () =>
        getBackend().createSheet(projectId, title),
      ),
  );
  ipcMain.handle(
    "dashboard:updateSheet",
    (_event, projectId: string, sheetId: string, updates: SheetUpdate) =>
      withLoggedErrors("dashboard:updateSheet", () =>
        getBackend().updateSheet(projectId, sheetId, updates),
      ),
  );
  ipcMain.handle(
    "dashboard:deleteSheet",
    (_event, projectId: string, sheetId: string) =>
      withLoggedErrors("dashboard:deleteSheet", () =>
        getBackend().deleteSheet(projectId, sheetId),
      ),
  );
  ipcMain.handle("dashboard:browsePath", (event, options: BrowsePathOptions) =>
    withLoggedErrors("dashboard:browsePath", async () => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const dialogOptions: OpenDialogOptions = {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
        properties: [
          options.kind === "directory" ? "openDirectory" : "openFile",
        ],
      };
      const result = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled) {
        return null;
      }

      return result.filePaths[0] ?? null;
    }),
  );
  ipcMain.handle("dashboard:openPath", (_event, path: string) =>
    withLoggedErrors("dashboard:openPath", () => shell.openPath(path)),
  );
  ipcMain.handle("dashboard:openExternalUrl", (_event, url: string) =>
    withLoggedErrors("dashboard:openExternalUrl", async () => {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only HTTP and HTTPS links can be opened.");
      }
      await shell.openExternal(parsed.toString());
    }),
  );
  ipcMain.handle("chat:getConfig", () =>
    withLoggedErrors("chat:getConfig", () => {
      if (!CHAT_ENABLED) {
        throw new Error("Chat is disabled.");
      }
      if (!chatConfig) {
        throw new Error("Chat has not been initialized.");
      }
      return chatConfig;
    }),
  );
  ipcMain.handle("chat:saveProfile", (_event, profile: ChatUserProfile) =>
    withLoggedErrors("chat:saveProfile", () => {
      if (!CHAT_ENABLED) {
        throw new Error("Chat is disabled.");
      }
      return saveChatProfile(app.getPath("userData"), profile);
    }),
  );
  ipcMain.handle(
    "chat:notifyMessage",
    (_event, notification: ChatNativeNotification) =>
      withLoggedErrors("chat:notifyMessage", () => {
        if (!CHAT_ENABLED) {
          return;
        }
        showChatNotification(notification);
      }),
  );
  ipcMain.handle(
    "dashboard:openLog",
    (_event, projectId: string, channel: LogChannel) =>
      withLoggedErrors("dashboard:openLog", () =>
        shell.openPath(getBackend().getLogFilePath(projectId, channel)),
      ),
  );
  ipcMain.handle("dashboard:deleteProject", (_event, projectId: string) =>
    withLoggedErrors("dashboard:deleteProject", () =>
      getBackend().deleteProject(projectId),
    ),
  );
  ipcMain.handle(
    "dashboard:createProject",
    (_event, name: string, code: string) =>
      withLoggedErrors("dashboard:createProject", () =>
        getBackend().createProject(name, code),
      ),
  );
  ipcMain.handle(
    "dashboard:updateProject",
    (_event, projectId: string, name: string, code: string) =>
      withLoggedErrors("dashboard:updateProject", () =>
        getBackend().updateProject(projectId, name, code),
      ),
  );
  ipcMain.handle(
    "dashboard:validateProjectSettings",
    (
      _event,
      projectId: string,
      name: string,
      code: string,
      settings: ProjectSettingsRecord,
    ) =>
      withLoggedErrors("dashboard:validateProjectSettings", () =>
        getBackend().validateProjectSettings(projectId, name, code, settings),
      ),
  );
  ipcMain.handle(
    "logs:get-latest",
    (_event, projectId: string, channel: LogChannel, limit?: number) =>
      withLoggedErrors("logs:get-latest", () =>
        getBackend().getLogLatest(projectId, channel, limit),
      ),
  );
  ipcMain.handle(
    "logs:get-before",
    (
      _event,
      projectId: string,
      channel: LogChannel,
      beforeSeq: number,
      limit?: number,
    ) =>
      withLoggedErrors("logs:get-before", () =>
        getBackend().getLogBefore(projectId, channel, beforeSeq, limit),
      ),
  );
  ipcMain.handle(
    "logs:get-around",
    (
      _event,
      projectId: string,
      channel: LogChannel,
      seq: number,
      limit?: number,
    ) =>
      withLoggedErrors("logs:get-around", () =>
        getBackend().getLogAround(projectId, channel, seq, limit),
      ),
  );
  ipcMain.handle(
    "logs:search",
    (_event, projectId: string, channel: LogChannel, term: string) =>
      withLoggedErrors("logs:search", () =>
        getBackend().searchLog(projectId, channel, term),
      ),
  );
}

async function withLoggedErrors<T>(
  label: string,
  action: () => T | Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    console.error(`[${label}]`, error);
    throw error;
  }
}

async function sendApiTesterRequest(
  request: ApiTesterRequest,
): Promise<ApiTesterResponse> {
  const method = request.method.trim().toUpperCase();
  if (!method) {
    throw new Error("Request method is required.");
  }

  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS requests are supported.");
  }

  const controller = new AbortController();
  const timeoutMs = Math.min(
    Math.max(request.timeoutMs ?? 60000, 1000),
    300000,
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers();
  Object.entries(request.headers).forEach(([name, value]) => {
    const trimmedName = name.trim();
    if (trimmedName) {
      headers.set(trimmedName, value);
    }
  });
  const canHaveBody = method !== "GET" && method !== "HEAD";
  const requestBody =
    canHaveBody && request.bodyEncoding === "base64" && request.bodyBase64
      ? Buffer.from(request.bodyBase64, "base64")
      : request.body;
  const startedAt = performance.now();

  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: canHaveBody ? requestBody : undefined,
      redirect: "follow",
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      sizeBytes: Buffer.byteLength(body, "utf8"),
      headers: Array.from(response.headers.entries()).map(([name, value]) => ({
        name,
        value,
      })),
      body,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function loadEnvironmentFile(): void {
  const candidates = [
    join(process.cwd(), ".env"),
    join(__dirname, "../../.env"),
  ];
  const loaded = new Set<string>();

  for (const envPath of candidates) {
    if (loaded.has(envPath) || !existsSync(envPath)) {
      continue;
    }
    loaded.add(envPath);

    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = stripEnvironmentQuotes(value);
      }
    }
  }
}

function stripEnvironmentQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function readBooleanEnvironmentFlag(
  name: string,
  defaultValue: boolean,
): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }
  return !["0", "false", "no", "off"].includes(value);
}

function sanitizeExportFileName(fileName: string): string {
  const trimmed = fileName.trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-");
  const compact = trimmed.replace(/\s+/g, " ").replace(/^-+|-+$/g, "");
  return compact || `query-results-${Date.now()}.json`;
}

function getDatabaseExportFilters(
  fileName: string,
): SaveDialogOptions["filters"] {
  const extension = extname(fileName).slice(1).toLowerCase();

  if (extension === "json") {
    return [{ name: "JSON", extensions: ["json"] }];
  }
  if (extension === "csv") {
    return [{ name: "CSV", extensions: ["csv"] }];
  }
  if (extension === "pdf") {
    return [{ name: "PDF", extensions: ["pdf"] }];
  }

  return [{ name: "All Files", extensions: ["*"] }];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function initializeChat(userDataPath: string): ChatServiceConfig {
  const httpUrl = normalizeHttpUrl(
    process.env.IVS_DASHBOARD_CHAT_URL ??
      `http://${formatHostForUrl(DEFAULT_CHAT_SERVICE_HOST)}:${DEFAULT_CHAT_PORT}`,
  );
  const profile = readChatProfile(userDataPath);
  const shouldStartEmbedded =
    process.env.IVS_DASHBOARD_CHAT_SERVICE !== "0" &&
    process.env.IVS_DASHBOARD_CHAT_URL === undefined &&
    isLocalChatHost(DEFAULT_CHAT_SERVICE_HOST);

  if (shouldStartEmbedded) {
    const paths = resolveChatStoragePaths(userDataPath);
    chatService = new ChatService({
      host: DEFAULT_CHAT_BIND_HOST,
      port: DEFAULT_CHAT_PORT,
      databasePath: paths.databasePath,
      uploadsPath: paths.uploadsPath,
      publicHttpUrl: httpUrl,
    });
    if (
      profile.displayName &&
      process.env.IVS_DASHBOARD_CHAT_DEBUG_SEED === "1"
    ) {
      chatService.ensureDebugData(profile);
    }
    void chatService.start().catch((error) => {
      console.error("[chat:start] Chat service unavailable", error);
      chatService = null;
    });
  }

  return {
    httpUrl,
    wsUrl: httpUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:") + "/ws",
    profile,
  };
}

function normalizeHttpUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function uncHostFromPath(path: string): string | null {
  return path.match(/^\\\\([^\\]+)\\/)?.[1] ?? null;
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  );
}

function isLocalChatHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (isLoopbackHost(normalized) || normalized === "0.0.0.0") {
    return true;
  }
  const localName = hostname().toLowerCase();
  return (
    normalized === localName ||
    normalized.split(".")[0] === localName.split(".")[0]
  );
}

function resolveChatStoragePaths(userDataPath: string): {
  databasePath: string;
  uploadsPath: string;
} {
  try {
    mkdirSync(DEFAULT_CHAT_ROOT, { recursive: true });
    return {
      databasePath: join(DEFAULT_CHAT_ROOT, "chat.sqlite"),
      uploadsPath: join(DEFAULT_CHAT_ROOT, "uploads"),
    };
  } catch (error) {
    console.error("[chat:storage] Falling back to local chat storage", error);
    const fallbackRoot = join(userDataPath, "chat");
    mkdirSync(fallbackRoot, { recursive: true });
    return {
      databasePath: join(fallbackRoot, "chat.sqlite"),
      uploadsPath: join(fallbackRoot, "uploads"),
    };
  }
}

function readChatProfile(userDataPath: string): ChatUserProfile {
  const profilePath = join(userDataPath, "chat-profile.json");
  if (existsSync(profilePath)) {
    try {
      const parsed = JSON.parse(
        readFileSync(profilePath, "utf8"),
      ) as ChatUserProfile;
      if (parsed.userId) {
        return {
          userId: parsed.userId,
          displayName: parsed.displayName?.trim() || null,
          machineName: parsed.machineName || hostname(),
        };
      }
    } catch (error) {
      console.error("[chat:profile] Failed to read chat profile", error);
    }
  }

  const profile: ChatUserProfile = {
    userId: randomUUID(),
    displayName: process.env.IVS_DASHBOARD_CHAT_NAME?.trim() || null,
    machineName: hostname(),
  };
  return writeChatProfile(profilePath, profile);
}

function saveChatProfile(
  userDataPath: string,
  profile: ChatUserProfile,
): ChatServiceConfig {
  const displayName = profile.displayName?.trim() || null;
  const nextProfile = writeChatProfile(
    join(userDataPath, "chat-profile.json"),
    {
      userId: profile.userId || chatConfig?.profile.userId || randomUUID(),
      displayName,
      machineName:
        profile.machineName || chatConfig?.profile.machineName || hostname(),
    },
  );
  if (!chatConfig) {
    throw new Error("Chat has not been initialized.");
  }
  chatConfig = { ...chatConfig, profile: nextProfile };
  if (
    displayName &&
    chatService &&
    process.env.IVS_DASHBOARD_CHAT_DEBUG_SEED === "1"
  ) {
    chatService.ensureDebugData(nextProfile);
  }
  return chatConfig;
}

function writeChatProfile(
  profilePath: string,
  profile: ChatUserProfile,
): ChatUserProfile {
  const normalized: ChatUserProfile = {
    userId: profile.userId,
    displayName: profile.displayName?.trim() || null,
    machineName: profile.machineName || hostname(),
  };
  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(
    profilePath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  return normalized;
}

function showChatNotification(notification: ChatNativeNotification): void {
  const window = mainWindow;
  if (!window || window.isDestroyed() || window.isFocused()) {
    return;
  }

  window.flashFrame(true);
  if (!Notification.isSupported()) {
    return;
  }

  const nativeNotification = new Notification({
    title: notification.title,
    body: notification.body,
    silent: false,
  });
  nativeNotification.on("click", () => {
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
    window.flashFrame(false);
    window.webContents.send(
      "chat:open-conversation",
      notification.conversationId,
    );
  });
  nativeNotification.show();
}

function showBuildNotification(
  build: RecentBuildRecord,
  projectName: string,
  warDirectory: string | null,
): void {
  const window = mainWindow;
  if (!window || window.isDestroyed() || window.isFocused()) {
    return;
  }

  window.flashFrame(true);
  if (!Notification.isSupported()) {
    return;
  }

  const nativeNotification = new Notification({
    title: `Build ${build.status}: ${projectName}`,
    body: [
      `Profile: ${build.profile}`,
      `Branch: ${build.branch}`,
      `Commit: ${build.commit}/${build.commitCleanliness}`,
      `Duration: ${build.duration}`,
    ].join("\n"),
    silent: false,
  });
  nativeNotification.on("click", () => {
    void openBuildNotificationTarget(window, warDirectory);
  });
  nativeNotification.show();
}

async function openBuildNotificationTarget(
  window: BrowserWindow,
  warDirectory: string | null,
): Promise<void> {
  window.flashFrame(false);
  if (warDirectory && existsSync(warDirectory)) {
    const result = await shell.openPath(warDirectory);
    if (!result) {
      return;
    }
    console.error(
      `[main:notification] Failed to open ${warDirectory}: ${result}`,
    );
  }

  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 800,
    title: "IVS Dashboard",
    backgroundColor: "#f3f4f6",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    isQuitting = true;

    const be = backend;
    const win = mainWindow;
    if (!be || !win) {
      win?.destroy();
      app.exit(0);
      return;
    }

    const entries = be.getShutdownEntries();
    if (entries.length === 0) {
      be.shutdown();
      chatService?.stop();
      win.destroy();
      app.exit(0);
      return;
    }

    win.webContents.send("dashboard:shutdown-started", entries);

    void be
      .shutdownWithProgress((projectId, service) => {
        win.webContents.send(
          "dashboard:shutdown-service-stopped",
          projectId,
          service,
        );
      })
      .catch((error) => {
        console.error("[main:shutdownWithProgress]", error);
      })
      .then(async () => {
        await delay(EXIT_AFTER_SHUTDOWN_DELAY_MS);
        chatService?.stop();
        win.destroy();
        app.exit(0);
      });
  });

  mainWindow.on("focus", () => {
    mainWindow?.flashFrame(false);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow!.show();
  });
  mainWindow.webContents.once("did-finish-load", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[main:window] Failed to load renderer (${errorCode}) ${validatedURL}: ${errorDescription}`,
      );
      mainWindow?.show();
    },
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[main:window] Renderer process gone", details);
    mainWindow?.show();
  });
  mainWindow.webContents.on("unresponsive", () => {
    console.error("[main:window] Renderer became unresponsive");
    mainWindow?.show();
  });
  mainWindow.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      const prefix = level >= 2 ? "error" : level === 1 ? "warn" : "info";
      console[prefix](
        `[renderer:console] ${sourceId}:${line} ${message}`,
      );
    },
  );

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }

    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
};

app.whenReady().then(() => {
  try {
    const userDataPath = app.getPath("userData");
    if (CHAT_ENABLED) {
      chatConfig = initializeChat(userDataPath);
    }
    backend = new DashboardBackend(userDataPath, app.getAppPath());
    registerIpc();
    createWindow();
    void backend.autoStartServices().catch((error) => {
      console.error("[main:autoStartServices]", error);
    });
  } catch (error) {
    console.error("[main:start]", error);
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", (event) => {
  if (isQuitting) return;

  if (mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    mainWindow.close();
    return;
  }

  backend?.shutdown();
  chatService?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
