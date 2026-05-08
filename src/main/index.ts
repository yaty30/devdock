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

let backend: DashboardBackend | null = null;
let chatService: ChatService | null = null;
let chatConfig: ChatServiceConfig | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const EXIT_AFTER_SHUTDOWN_DELAY_MS = 1000;
const DATABASE_EXPORT_RESULT_CHANNEL = "database:exportResult";
const DEFAULT_CHAT_HOST = process.env.IVS_DASHBOARD_CHAT_HOST ?? "127.0.0.1";
const DEFAULT_CHAT_PORT = Number(
  process.env.IVS_DASHBOARD_CHAT_PORT ?? "43781",
);
const DEFAULT_CHAT_ROOT =
  process.env.IVS_DASHBOARD_CHAT_ROOT ??
  "L:\\ABS\\JamesYip\\Host\\Helper\\IVS-Dashboard\\chat";

function getBackend(): DashboardBackend {
  if (!backend) {
    throw new Error("Dashboard backend has not been initialized.");
  }

  return backend;
}

function registerIpc(): void {
  console.info("[main:ipc] registering IPC handlers");
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
      withLoggedErrors("dashboard:runBuild", () =>
        getBackend().runBuild(projectId, profileId),
      ),
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
      if (!chatConfig) {
        throw new Error("Chat has not been initialized.");
      }
      return chatConfig;
    }),
  );
  ipcMain.handle("chat:saveProfile", (_event, profile: ChatUserProfile) =>
    withLoggedErrors("chat:saveProfile", () =>
      saveChatProfile(app.getPath("userData"), profile),
    ),
  );
  ipcMain.handle(
    "chat:notifyMessage",
    (_event, notification: ChatNativeNotification) =>
      withLoggedErrors("chat:notifyMessage", () => {
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
      `http://${DEFAULT_CHAT_HOST}:${DEFAULT_CHAT_PORT}`,
  );
  const profile = readChatProfile(userDataPath);
  const shouldStartEmbedded =
    process.env.IVS_DASHBOARD_CHAT_SERVICE !== "0" &&
    process.env.IVS_DASHBOARD_CHAT_URL === undefined;

  if (shouldStartEmbedded) {
    const paths = resolveChatStoragePaths(userDataPath);
    chatService = new ChatService({
      host: DEFAULT_CHAT_HOST,
      port: DEFAULT_CHAT_PORT,
      databasePath: paths.databasePath,
      uploadsPath: paths.uploadsPath,
      publicHttpUrl: httpUrl,
    });
    if (
      profile.displayName &&
      process.env.IVS_DASHBOARD_CHAT_DEBUG_SEED !== "0"
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
  if (displayName && chatService) {
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
    chatConfig = initializeChat(userDataPath);
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
