import started from "electron-squirrel-startup";
import {
  app,
  BrowserWindow,
  Notification,
  dialog,
  ipcMain,
  shell,
} from "electron";
import type {
  NotificationConstructorOptions,
  OpenDialogOptions,
  SaveDialogOptions,
} from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  mkdir as mkdirAsync,
  readFile,
  readdir,
  rename as renameAsync,
  rm,
  stat,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
import { dirname, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DashboardBackend } from "./dashboardBackend";
import { ChatService } from "./chatService";
import os from "os";
import { APP_FEATURE_FLAGS } from "../shared/appFeatures";
import type {
  BuildQueryOptions,
  ApiFetchQueryOptions,
  DatabaseConnection,
  DatabaseObjectCollectionName,
  ProjectSettingsRecord,
  ProjectEnvScope,
  ProjectEnvVariable,
  ServiceAction,
  ServiceName,
  BrowsePathOptions,
  DatabaseWorksheetState,
  LogChannel,
  SheetUpdate,
  ApiTesterRequest,
  ApiTesterFormDataPart,
  ApiTesterResponse,
  ApiTesterResponseHeader,
  BackendType,
  PythonServerType,
  RecentBuildRecord,
  DirectoryEntry,
  FilePreviewResult,
  DirectoryListResult,
  SshConnectRequest,
} from "../shared/dashboardTypes";
import type { SshService } from "./sshService";
import type { XtermCreateRequest, XtermService } from "./xtermService";
import type {
  ChatNativeNotification,
  ChatServiceConfig,
  ChatUserProfile,
} from "../shared/chatTypes";

if (started) {
  app.quit();
  process.exit(0);
}

const APP_NAME = "DevDock";
const WINDOWS_APP_USER_MODEL_ID = "com.squirrel.devdock.DevDock";
const LEGACY_APP_NAME = "IVS Dashboard";
const DATA_MIGRATION_ENV_FLAG = "DEVDOCK_DATA_MIGRATION_COMPLETED";
const IS_MACOS = process.platform === "darwin";
app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
}
loadEnvironmentFile();

let backend: DashboardBackend | null = null;
let chatService: ChatService | null = null;
let chatConfig: ChatServiceConfig | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let sshService: SshService | null = null;
let xtermService: XtermService | null = null;
const EXIT_AFTER_SHUTDOWN_DELAY_MS = 1000;
const DATABASE_EXPORT_RESULT_CHANNEL = "database:exportResult";
const API_TESTER_REQUEST_CHANNEL = "apiTester:sendRequest";
const API_TESTER_SAVED_GET_CHANNEL = "apiTester:getSavedRequests";
const API_TESTER_SAVED_SAVE_CHANNEL = "apiTester:saveSavedRequest";
const API_TESTER_SAVED_DELETE_CHANNEL = "apiTester:deleteSavedRequest";
const CHAT_ENABLED = readBooleanEnvironmentFlag("ENABLE_CHAT", false);
const DEBUG_ENABLED = readBooleanEnvironmentFlag("DEBUG", false);
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
const FILE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const FILE_PREVIEW_SAMPLE_BYTES = 4096;
const DEFAULT_CHAT_BIND_HOST =
  process.env.IVS_DASHBOARD_CHAT_BIND_HOST ??
  (isLoopbackHost(DEFAULT_CHAT_SERVICE_HOST)
    ? DEFAULT_CHAT_SERVICE_HOST
    : "0.0.0.0");
const BUILD_NOTIFICATION_ARGUMENT_PREFIX = "ivs-dashboard-build-notification";
const BUILD_NOTIFICATION_ACTION_OPEN_WAR = "open-war";
const BUILD_NOTIFICATION_TARGET_TTL_MS = 24 * 60 * 60 * 1000;
const buildNotificationTargets = new Map<
  string,
  { warDirectory: string | null; createdAt: number }
>();

function getBackend(): DashboardBackend {
  if (!backend) {
    throw new Error("Dashboard backend has not been initialized.");
  }

  return backend;
}

function getSshService(): SshService {
  if (!sshService) {
    throw new Error("SSH feature is disabled.");
  }

  return sshService;
}

function getXtermService(): XtermService {
  if (!xtermService) {
    throw new Error("SSH terminal feature is disabled.");
  }

  return xtermService;
}

function registerIpc(): void {
  console.info("[main:ipc] registering IPC handlers");
  ipcMain.handle("dashboard:getFeatureFlags", () =>
    withLoggedErrors("dashboard:getFeatureFlags", () => ({
      chatEnabled: CHAT_ENABLED,
      debugEnabled: DEBUG_ENABLED,
      features: APP_FEATURE_FLAGS,
    })),
  );
  ipcMain.handle("dashboard:showDebugBuildNotification", () =>
    withLoggedErrors("dashboard:showDebugBuildNotification", () => {
      if (!DEBUG_ENABLED) {
        throw new Error("Debug mode is disabled.");
      }
      showDebugBuildNotification();
    }),
  );
  ipcMain.handle("window:isMaximized", (event) =>
    withLoggedErrors(
      "window:isMaximized",
      () => isWindowMaximized(BrowserWindow.fromWebContents(event.sender)),
    ),
  );
  ipcMain.handle("window:minimize", (event) =>
    withLoggedErrors("window:minimize", () => {
      BrowserWindow.fromWebContents(event.sender)?.minimize();
    }),
  );
  ipcMain.handle("window:toggleMaximize", (event) =>
    withLoggedErrors("window:toggleMaximize", () => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        return;
      }

      if (process.platform === "darwin") {
        window.setFullScreen(!window.isFullScreen());
        return;
      }

      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }),
  );
  ipcMain.handle("window:close", (event) =>
    withLoggedErrors("window:close", () => {
      BrowserWindow.fromWebContents(event.sender)?.close();
    }),
  );
  // SSH is experimental and intentionally disabled by default; keep its IPC
  // handlers and terminal session services dormant until the feature returns.
  if (APP_FEATURE_FLAGS.ssh) {
    ipcMain.handle("ssh:connect", (_event, request: SshConnectRequest) =>
      withLoggedErrors("ssh:connect", () => getSshService().connect(request)),
    );
    ipcMain.handle("ssh:disconnect", (_event, sessionId: string) =>
      withLoggedErrors("ssh:disconnect", () =>
        getSshService().disconnect(sessionId),
      ),
    );
    ipcMain.handle("ssh:exec", (_event, sessionId: string, command: string) =>
      withLoggedErrors("ssh:exec", () =>
        getSshService().exec(sessionId, command),
      ),
    );
    ipcMain.handle("ssh:write", (_event, sessionId: string, data: string) =>
      withLoggedErrors("ssh:write", () =>
        getSshService().write(sessionId, data),
      ),
    );
  }
  ipcMain.handle("fs:listLocalDirectory", (_event, path?: string | null) =>
    withLoggedErrors("fs:listLocalDirectory", () => listLocalDirectory(path)),
  );
  ipcMain.handle(
    "fs:createDirectory",
    (_event, parentPath: string, name: string) =>
      withLoggedErrors("fs:createDirectory", () =>
        createLocalDirectory(parentPath, name),
      ),
  );
  ipcMain.handle("fs:renamePath", (_event, path: string, newName: string) =>
    withLoggedErrors("fs:renamePath", () => renameLocalPath(path, newName)),
  );
  ipcMain.handle("fs:deletePath", (_event, path: string) =>
    withLoggedErrors("fs:deletePath", () => deleteLocalPath(path)),
  );
  ipcMain.handle("fs:previewFile", (_event, path: string) =>
    withLoggedErrors("fs:previewFile", () => previewLocalFile(path)),
  );
  if (APP_FEATURE_FLAGS.ssh) {
    ipcMain.handle(
      "ssh:listDirectory",
      (_event, sessionId: string, path?: string | null) =>
        withLoggedErrors("ssh:listDirectory", () =>
          getSshService().listDirectory(sessionId, path),
        ),
    );
    ipcMain.handle(
      "ssh:createDirectory",
      (_event, sessionId: string, parentPath: string, name: string) =>
        withLoggedErrors("ssh:createDirectory", () =>
          getSshService().createDirectory(sessionId, parentPath, name),
        ),
    );
    ipcMain.handle(
      "ssh:renamePath",
      (_event, sessionId: string, path: string, newName: string) =>
        withLoggedErrors("ssh:renamePath", () =>
          getSshService().renamePath(sessionId, path, newName),
        ),
    );
    ipcMain.handle(
      "ssh:deletePath",
      (_event, sessionId: string, path: string, type: "file" | "folder") =>
        withLoggedErrors("ssh:deletePath", () =>
          getSshService().deletePath(sessionId, path, type),
        ),
    );
    ipcMain.handle(
      "ssh:uploadFile",
      (_event, sessionId: string, localPath: string, remoteDirectory: string) =>
        withLoggedErrors("ssh:uploadFile", () =>
          getSshService().uploadFile(sessionId, localPath, remoteDirectory),
        ),
    );
    ipcMain.handle(
      "ssh:downloadFile",
      (_event, sessionId: string, remotePath: string, localDirectory: string) =>
        withLoggedErrors("ssh:downloadFile", () =>
          getSshService().downloadFile(sessionId, remotePath, localDirectory),
        ),
    );
    ipcMain.handle(
      "ssh:previewFile",
      (_event, sessionId: string, remotePath: string) =>
        withLoggedErrors("ssh:previewFile", () =>
          getSshService().previewFile(sessionId, remotePath),
        ),
    );
    ipcMain.handle(
      "xterm:createSession",
      (_event, request: XtermCreateRequest | undefined) =>
        withLoggedErrors("xterm:createSession", () =>
          getXtermService().createSession(request ?? {}),
        ),
    );
    ipcMain.handle(
      "xterm:input",
      (_event, sessionId: string, data: string) =>
        withLoggedErrors("xterm:input", () =>
          getXtermService().write(sessionId, data),
        ),
    );
    ipcMain.handle(
      "xterm:resize",
      (_event, sessionId: string, cols: number, rows: number) =>
        withLoggedErrors("xterm:resize", () =>
          getXtermService().resize(sessionId, cols, rows),
        ),
    );
    ipcMain.handle("xterm:killSession", (_event, sessionId: string) =>
      withLoggedErrors("xterm:killSession", () =>
        getXtermService().kill(sessionId),
      ),
    );
  }
  ipcMain.handle(
    API_TESTER_REQUEST_CHANNEL,
    (_event, request: ApiTesterRequest) =>
      withLoggedErrors(API_TESTER_REQUEST_CHANNEL, () =>
        sendApiTesterRequest(request),
      ),
  );
  ipcMain.handle(API_TESTER_SAVED_GET_CHANNEL, (_event, scopeId: string) =>
    withLoggedErrors(API_TESTER_SAVED_GET_CHANNEL, () =>
      getBackend().getApiTesterSavedRequests(scopeId),
    ),
  );
  ipcMain.handle(
    API_TESTER_SAVED_SAVE_CHANNEL,
    (
      _event,
      request: {
        id?: string;
        scopeId: string;
        name: string;
        method: string;
        url: string;
        requestJson: string;
      },
    ) =>
      withLoggedErrors(API_TESTER_SAVED_SAVE_CHANNEL, () =>
        getBackend().saveApiTesterSavedRequest(request),
      ),
  );
  ipcMain.handle(API_TESTER_SAVED_DELETE_CHANNEL, (_event, id: string) =>
    withLoggedErrors(API_TESTER_SAVED_DELETE_CHANNEL, () =>
      getBackend().deleteApiTesterSavedRequest(id),
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
  ipcMain.handle(
    "database:getObjectNames",
    (
      _event,
      connection: DatabaseConnection,
      collection: DatabaseObjectCollectionName,
    ) =>
      withLoggedErrors("database:getObjectNames", () =>
        getBackend().getDatabaseObjectNames(connection, collection),
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
  ipcMain.handle("dashboard:getProjectEnvFiles", (_event, projectId: string) =>
    withLoggedErrors("dashboard:getProjectEnvFiles", () =>
      getBackend().getProjectEnvFiles(projectId),
    ),
  );
  ipcMain.handle(
    "dashboard:saveProjectEnvFile",
    (
      _event,
      projectId: string,
      scope: ProjectEnvScope,
      filePath: string,
      variables: ProjectEnvVariable[],
    ) =>
      withLoggedErrors("dashboard:saveProjectEnvFile", () =>
        getBackend().saveProjectEnvFile(projectId, scope, filePath, variables),
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
  ipcMain.handle(
    "dashboard:getApiFetches",
    (_event, projectId: string, options?: ApiFetchQueryOptions) =>
      withLoggedErrors("dashboard:getApiFetches", () =>
        getBackend().getApiFetches(projectId, options),
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
    (
      _event,
      name: string,
      code: string,
      backendType: BackendType,
      pythonServerType?: PythonServerType,
    ) =>
      withLoggedErrors("dashboard:createProject", () =>
        getBackend().createProject(name, code, backendType, pythonServerType),
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

async function listLocalDirectory(
  requestedPath?: string | null,
): Promise<DirectoryListResult> {
  const targetPath = requestedPath?.trim() || getLocalHomePath();
  try {
    const entries = await readdir(targetPath, { withFileTypes: true });
    const items: DirectoryEntry[] = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .map(async (entry) => {
          const fullPath = join(targetPath, entry.name);
          const stats = await stat(fullPath);
          return {
            name: entry.name,
            path: fullPath,
            type: entry.isDirectory() ? "folder" : "file",
            size: entry.isDirectory() ? null : stats.size,
            modifiedMs: stats.mtimeMs,
          };
        }),
    );

    return {
      ok: true,
      path: targetPath,
      items: sortDirectoryItems(items),
    };
  } catch (error) {
    return {
      ok: false,
      path: targetPath,
      items: [],
      error: error instanceof Error ? error.message : "Unable to list directory.",
    };
  }
}

async function createLocalDirectory(
  parentPath: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const safeName = sanitizeDirectoryActionName(name);
  if (!safeName) {
    return { ok: false, error: "Folder name is required." };
  }

  try {
    await mkdirAsync(join(parentPath, safeName));
    return { ok: true };
  } catch (error) {
    return formatDirectoryActionError(error, "Unable to create folder.");
  }
}

async function renameLocalPath(
  path: string,
  newName: string,
): Promise<{ ok: boolean; error?: string }> {
  const safeName = sanitizeDirectoryActionName(newName);
  if (!safeName) {
    return { ok: false, error: "New name is required." };
  }

  try {
    await renameAsync(path, join(dirname(path), safeName));
    return { ok: true };
  } catch (error) {
    return formatDirectoryActionError(error, "Unable to rename item.");
  }
}

async function deleteLocalPath(path: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await rm(path, { recursive: true, force: false });
    return { ok: true };
  } catch (error) {
    return formatDirectoryActionError(error, "Unable to delete item.");
  }
}

async function previewLocalFile(path: string): Promise<FilePreviewResult> {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const initialMetadata = getPreviewMetadata(fileName);

  try {
    const stats = await stat(path);
    if (stats.size > FILE_PREVIEW_MAX_BYTES) {
      return {
        ok: false,
        kind: initialMetadata.kind,
        fileName,
        mimeType: initialMetadata.mimeType,
        error: "Preview is limited to files 5 MB or smaller.",
      };
    }
    const buffer = await readFile(path);
    const metadata = resolvePreviewMetadata(fileName, initialMetadata, buffer);
    if (metadata.kind === "unsupported") {
      return { ok: true, fileName, ...metadata };
    }
    return formatPreviewBuffer(fileName, metadata, buffer);
  } catch (error) {
    return {
      ok: false,
      kind: initialMetadata.kind,
      fileName,
      mimeType: initialMetadata.mimeType,
      error: error instanceof Error ? error.message : "Unable to preview file.",
    };
  }
}

function getLocalHomePath(): string {
  const homeDrive = process.env.HOMEDRIVE ?? "";
  const homePath = process.env.HOMEPATH ?? "";
  const windowsHome = `${homeDrive}${homePath}`.trim();
  return windowsHome || os.homedir();
}

function sanitizeDirectoryActionName(name: string): string {
  const trimmed = name.trim();
  return trimmed === "." || trimmed === ".." || /[\\/]/.test(trimmed)
    ? ""
    : trimmed;
}

function formatDirectoryActionError(
  error: unknown,
  fallback: string,
): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : fallback,
  };
}

function getPreviewMetadata(
  fileName: string,
): { kind: FilePreviewResult["kind"]; mimeType: string } {
  const extension = extname(fileName).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(extension)) {
    return { kind: "image", mimeType: getImageMimeType(extension) };
  }
  if (extension === ".pdf") {
    return { kind: "pdf", mimeType: "application/pdf" };
  }
  if (extension === ".json") {
    return { kind: "json", mimeType: "application/json" };
  }
  if ([".xml", ".xsd", ".xsl"].includes(extension)) {
    return { kind: "xml", mimeType: "application/xml" };
  }
  if ([".txt", ".log", ".md", ".csv", ".ini", ".env", ".yaml", ".yml"].includes(extension)) {
    return { kind: "text", mimeType: "text/plain" };
  }
  const mimeType = getKnownMimeType(extension);
  if (isPreviewableTextMimeType(mimeType)) {
    return { kind: "text", mimeType };
  }
  return { kind: "unsupported", mimeType };
}

function resolvePreviewMetadata(
  fileName: string,
  metadata: { kind: FilePreviewResult["kind"]; mimeType: string },
  buffer: Buffer,
): { kind: FilePreviewResult["kind"]; mimeType: string } {
  if (metadata.kind !== "unsupported" || isKnownPreviewExtension(fileName)) {
    return metadata;
  }
  if (isPreviewableTextMimeType(metadata.mimeType) || looksLikeText(buffer)) {
    return {
      kind: "text",
      mimeType: metadata.mimeType === "application/octet-stream" ? "text/plain" : metadata.mimeType,
    };
  }
  return metadata;
}

function isKnownPreviewExtension(fileName: string): boolean {
  return [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
    ".pdf",
    ".json",
    ".xml",
    ".xsd",
    ".xsl",
    ".txt",
    ".log",
    ".md",
    ".csv",
    ".ini",
    ".env",
    ".yaml",
    ".yml",
  ].includes(extname(fileName).toLowerCase());
}

function getKnownMimeType(extension: string): string {
  switch (extension) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return "application/javascript";
    case ".ts":
    case ".tsx":
      return "application/typescript";
    case ".css":
      return "text/css";
    case ".html":
    case ".htm":
      return "text/html";
    case ".sql":
      return "application/sql";
    case ".toml":
      return "application/toml";
    case ".properties":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function isPreviewableTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/") || [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/typescript",
    "application/x-yaml",
    "application/yaml",
    "application/toml",
    "application/sql",
    "application/x-sh",
    "application/x-shellscript",
  ].includes(mimeType);
}

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, FILE_PREVIEW_SAMPLE_BYTES);
  if (sample.length === 0) {
    return true;
  }
  if (sample.includes(0)) {
    return looksLikeUtf16Text(sample);
  }
  const decoded = sample.toString("utf8");
  if (decoded.includes("\uFFFD")) {
    return false;
  }
  return !containsBinaryControlCharacters(decoded);
}

function looksLikeUtf16Text(sample: Buffer): boolean {
  if (sample.length < 4) {
    return false;
  }
  const evenNulls = countNullBytes(sample, 0);
  const oddNulls = countNullBytes(sample, 1);
  const pairs = Math.floor(sample.length / 2);
  if (evenNulls / pairs < 0.3 && oddNulls / pairs < 0.3) {
    return false;
  }
  const decoded = evenNulls > oddNulls
    ? swapUtf16ByteOrder(sample).toString("utf16le")
    : sample.toString("utf16le");
  return !decoded.includes("\uFFFD") && !containsBinaryControlCharacters(decoded);
}

function swapUtf16ByteOrder(sample: Buffer): Buffer {
  const swapped = Buffer.from(sample);
  for (let index = 0; index + 1 < swapped.length; index += 2) {
    const first = swapped[index];
    swapped[index] = swapped[index + 1];
    swapped[index + 1] = first;
  }
  return swapped;
}

function countNullBytes(sample: Buffer, offset: number): number {
  let count = 0;
  for (let index = offset; index < sample.length; index += 2) {
    if (sample[index] === 0) {
      count += 1;
    }
  }
  return count;
}

function containsBinaryControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13 && code !== 12) {
      return true;
    }
  }
  return false;
}

function getImageMimeType(extension: string): string {
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

function formatPreviewBuffer(
  fileName: string,
  metadata: { kind: FilePreviewResult["kind"]; mimeType: string },
  buffer: Buffer,
): FilePreviewResult {
  if (metadata.kind === "image" || metadata.kind === "pdf") {
    return {
      ok: true,
      kind: metadata.kind,
      fileName,
      mimeType: metadata.mimeType,
      content: buffer.toString("base64"),
      encoding: "base64",
    };
  }

  return {
    ok: true,
    kind: metadata.kind,
    fileName,
    mimeType: metadata.mimeType,
    content: buffer.toString("utf8"),
    encoding: "utf8",
  };
}

function sortDirectoryItems<T extends { name: string; type: "file" | "folder" }>(
  items: T[],
): T[] {
  return [...items].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "folder" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
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
  const requestBody = createApiTesterRequestBody(request, canHaveBody);
  if (canHaveBody && request.bodyFormData?.length) {
    headers.delete("Content-Type");
  }
  const startedAt = performance.now();

  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: canHaveBody ? requestBody : undefined,
      redirect: "follow",
      signal: controller.signal,
    });
    const responseHeaders = Array.from(response.headers.entries()).map(
      ([name, value]) => ({
        name,
        value,
      }),
    );
    const responseBytes = Buffer.from(await response.arrayBuffer());
    const binary = isBinaryApiTesterResponse(responseHeaders);
    const body = binary ? "" : responseBytes.toString("utf8");
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      sizeBytes: responseBytes.byteLength,
      headers: responseHeaders,
      body,
      bodyBase64: binary ? responseBytes.toString("base64") : undefined,
      bodyEncoding: binary ? "base64" : "utf8",
      binary,
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

function createApiTesterRequestBody(
  request: ApiTesterRequest,
  canHaveBody: boolean,
): string | ArrayBuffer | FormData | undefined {
  if (!canHaveBody) {
    return undefined;
  }

  if (request.bodyFormData?.length) {
    return createApiTesterFormData(request.bodyFormData);
  }

  if (request.bodyEncoding === "base64" && request.bodyBase64) {
    return bufferToArrayBuffer(Buffer.from(request.bodyBase64, "base64"));
  }

  return request.body;
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function createApiTesterFormData(parts: ApiTesterFormDataPart[]): FormData {
  const formData = new FormData();

  parts.forEach((part) => {
    const name = part.name.trim();
    if (!name) {
      return;
    }

    if (part.fileBase64 && part.fileName) {
      const fileBytes = Buffer.from(part.fileBase64, "base64");
      formData.append(
        name,
        new Blob([new Uint8Array(fileBytes)], {
          type: part.fileType || "application/octet-stream",
        }),
        part.fileName,
      );
      return;
    }

    formData.append(name, part.value ?? "");
  });

  return formData;
}

function isBinaryApiTesterResponse(
  headers: ApiTesterResponseHeader[],
): boolean {
  const contentType = headers
    .find((header) => header.name.toLowerCase() === "content-type")
    ?.value.toLowerCase();
  if (!contentType) {
    return false;
  }

  return !/^(text\/)|json|xml|javascript|x-www-form-urlencoded|graphql/.test(
    contentType,
  );
}

function loadEnvironmentFile(): void {
  const candidates = [
    join(process.cwd(), ".env"),
    join(process.resourcesPath, ".env"),
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
  options: { showWhenFocused?: boolean; throwOnSkip?: boolean } = {},
): boolean {
  const window = mainWindow;
  if (!window || window.isDestroyed()) {
    const message =
      "Build toast skipped because the main window is unavailable.";
    if (options.throwOnSkip) {
      throw new Error(message);
    }
    console.warn(`[main:notification] ${message}`);
    return false;
  }
  if (window.isFocused() && !options.showWhenFocused) {
    console.info(
      `[main:notification] Build toast skipped while app is focused for ${projectName}`,
    );
    return false;
  }

  if (!options.showWhenFocused) {
    window.flashFrame(true);
  }
  if (!Notification.isSupported()) {
    const message = "Desktop notifications are not supported on this system.";
    if (options.throwOnSkip) {
      throw new Error(message);
    }
    console.warn(`[main:notification] ${message}`);
    return false;
  }

  const notificationToken = randomUUID();
  rememberBuildNotificationTarget(notificationToken, warDirectory);
  const fallbackOptions = createBuildNotificationFallbackOptions(
    build,
    projectName,
  );
  const buildNotificationOptions = createBuildNotificationOptions(
    build,
    projectName,
    notificationToken,
    warDirectory,
  );
  const iconOptions = createBuildNotificationIconOptions();

  let fallbackTriggered = false;
  const showFallback = (reason: string): void => {
    if (fallbackTriggered) {
      return;
    }
    fallbackTriggered = true;
    console.warn(
      `[main:notification] Build toast falling back to default options: ${reason}`,
    );
    try {
      const fallbackNotification = new Notification(fallbackOptions);
      fallbackNotification.on("show", () =>
        console.info("[main:notification] Build fallback toast shown"),
      );
      fallbackNotification.on("failed", (_event, error) =>
        console.error(
          `[main:notification] Build fallback toast failed: ${error}`,
        ),
      );
      fallbackNotification.on("click", () => {
        void openBuildNotificationTarget(window, warDirectory);
      });
      fallbackNotification.show();
    } catch (error) {
      console.error(
        `[main:notification] Failed to show fallback toast: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  let nativeNotification: Notification;
  try {
    nativeNotification = new Notification({
      ...buildNotificationOptions,
      ...iconOptions,
    });
  } catch (error) {
    showFallback(
      `constructor threw: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return true;
  }

  let shown = false;
  const showTimeout = setTimeout(() => {
    if (!shown) {
      showFallback("native toast did not fire 'show' within 1500ms");
    }
  }, 1500);

  nativeNotification.on("show", () => {
    shown = true;
    clearTimeout(showTimeout);
    console.info(
      `[main:notification] Build toast shown (${build.status}) for ${projectName}`,
    );
  });
  nativeNotification.on("failed", (_event, error) => {
    clearTimeout(showTimeout);
    showFallback(`native toast failed: ${error}`);
  });
  nativeNotification.on("close", () => {
    clearTimeout(showTimeout);
  });
  nativeNotification.on("click", () => {
    void openBuildNotificationTargetByToken(notificationToken);
  });
  nativeNotification.on("action", () => {
    void openBuildNotificationTargetByToken(notificationToken);
  });

  try {
    nativeNotification.show();
  } catch (error) {
    clearTimeout(showTimeout);
    showFallback(
      `show() threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return true;
}

function showDebugBuildNotification(): void {
  const completedAt = new Date();
  const startedAt = new Date(completedAt.getTime() - 169000);
  const shown = showBuildNotification(
    {
      id: `debug-build-${completedAt.getTime()}`,
      branch: "release/full-launch-10.1",
      commit: "9804a3fdib",
      commitCleanliness: "clean",
      profile: "NF Local",
      status: "Success",
      duration: "2m 49s",
      completed: "Just now",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      outcomeType: "build-only",
    },
    "Project IAP",
    app.getPath("documents"),
    { showWhenFocused: true, throwOnSkip: true },
  );
  if (!shown) {
    throw new Error("Debug notification was not shown.");
  }
}

function createBuildNotificationOptions(
  build: RecentBuildRecord,
  projectName: string,
  notificationToken: string,
  warDirectory: string | null,
): NotificationConstructorOptions {
  const fallbackOptions = createBuildNotificationFallbackOptions(
    build,
    projectName,
  );
  if (process.platform !== "win32") {
    return fallbackOptions;
  }

  return {
    ...fallbackOptions,
    toastXml: createBuildNotificationToastXml(
      build,
      projectName,
      notificationToken,
      warDirectory,
    ),
  };
}

function createBuildNotificationToastXml(
  build: RecentBuildRecord,
  projectName: string,
  notificationToken: string,
  warDirectory: string | null,
): string {
  const title = `🚀 ${projectName} Build ${build.status}`;
  const lines = [
    // `🦘 Profile: ${build.profile}`,
    // `🌳 Branch: ${build.branch}`,
    // `🔖 Commit: @${build.commit}/${build.commitCleanliness}`,
    `🤝🏻 Profile:  ${build.profile}`,
    `🕑 Duration: ${build.duration}`,
    `🔖 Commit: @${build.commit}/${build.commitCleanliness}`,
  ];
  const launchArgument = createBuildNotificationArgument(
    notificationToken,
    undefined,
    warDirectory,
  );
  const openWarArgument = createBuildNotificationArgument(
    notificationToken,
    BUILD_NOTIFICATION_ACTION_OPEN_WAR,
    warDirectory,
  );

  return `
<toast launch="${escapeXmlAttribute(launchArgument)}">
  <visual>
    <binding template="ToastGeneric">
      <text>${escapeXmlText(title)}</text>
      ${lines.map((line) => `<text>${escapeXmlText(line)}</text>`).join("\n      ")}
    </binding>
  </visual>
</toast>`.trim();
}

// <actions>
//   <action content="Open WAR folder" arguments="${escapeXmlAttribute(openWarArgument)}" activationType="foreground" />
// </actions>

function createBuildNotificationFallbackOptions(
  build: RecentBuildRecord,
  projectName: string,
): NotificationConstructorOptions {
  const statusLabel = `🚀 Build ${build.status} 🕑 ~ ${build.duration}`;
  const detailLines = [
    `🦘 Profile: ${build.profile}`,
    `🌳 Branch: ${build.branch}`,
    `🔖 Commit: @${build.commit}/${build.commitCleanliness}`,
  ];

  return {
    title: `${statusLabel}: ${projectName}`,
    body: detailLines.join("\n"),
    silent: false,
  };
}

function createBuildNotificationIconOptions(): NotificationConstructorOptions {
  const iconPath = resolveNotificationIconPath();
  return iconPath ? { icon: iconPath } : {};
}

function createBuildNotificationArgument(
  notificationToken: string,
  action?: string,
  warDirectory?: string | null,
): string {
  const parameters = new URLSearchParams({
    source: BUILD_NOTIFICATION_ARGUMENT_PREFIX,
    token: notificationToken,
  });
  if (action) {
    parameters.set("action", action);
  }
  if (warDirectory) {
    parameters.set("warDirectory", encodeBase64Url(warDirectory));
  }
  return parameters.toString();
}

type BuildNotificationActivation = {
  token: string;
  action: string | null;
  warDirectory: string | null;
};

function parseBuildNotificationActivation(
  argumentsText: string,
): BuildNotificationActivation | null {
  const parameters = new URLSearchParams(argumentsText);
  if (parameters.get("source") === BUILD_NOTIFICATION_ARGUMENT_PREFIX) {
    const token = parameters.get("token");
    if (!token) {
      return null;
    }
    const encodedDirectory = parameters.get("warDirectory");
    return {
      token,
      action: parameters.get("action"),
      warDirectory: encodedDirectory ? decodeBase64Url(encodedDirectory) : null,
    };
  }

  const parts = argumentsText.split(":");
  if (parts[0] !== BUILD_NOTIFICATION_ARGUMENT_PREFIX) {
    return null;
  }
  if (parts.length === 2) {
    return parts[1]
      ? { token: parts[1], action: null, warDirectory: null }
      : null;
  }
  if (parts.length === 3 && parts[1] === BUILD_NOTIFICATION_ACTION_OPEN_WAR) {
    return parts[2]
      ? {
          token: parts[2],
          action: BUILD_NOTIFICATION_ACTION_OPEN_WAR,
          warDirectory: null,
        }
      : null;
  }
  return null;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string | null {
  try {
    const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
    return Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
  } catch (error) {
    console.error("[main:notification] Failed to decode toast path", error);
    return null;
  }
}

function rememberBuildNotificationTarget(
  notificationToken: string,
  warDirectory: string | null,
): void {
  pruneBuildNotificationTargets();
  buildNotificationTargets.set(notificationToken, {
    warDirectory,
    createdAt: Date.now(),
  });
}

function pruneBuildNotificationTargets(): void {
  const cutoff = Date.now() - BUILD_NOTIFICATION_TARGET_TTL_MS;
  for (const [token, target] of buildNotificationTargets) {
    if (target.createdAt < cutoff) {
      buildNotificationTargets.delete(token);
    }
  }
}

function registerNotificationActivationHandler(): void {
  if (process.platform !== "win32") {
    return;
  }

  const notificationApi = Notification as typeof Notification & {
    handleActivation?: (
      callback: (details: { arguments?: string }) => void,
    ) => void;
  };
  notificationApi.handleActivation?.((details) => {
    const argumentsText = details.arguments;
    if (!argumentsText) {
      return;
    }
    const activation = parseBuildNotificationActivation(argumentsText);
    if (activation) {
      console.info("[main:notification] Build toast activated", {
        action: activation.action,
        hasEmbeddedDirectory: Boolean(activation.warDirectory),
      });
      void openBuildNotificationTargetByToken(
        activation.token,
        activation.warDirectory,
      );
    }
  });
}

async function openBuildNotificationTargetByToken(
  notificationToken: string,
  fallbackWarDirectory: string | null = null,
): Promise<void> {
  const target = buildNotificationTargets.get(notificationToken);
  await openBuildNotificationTarget(
    mainWindow,
    fallbackWarDirectory ?? target?.warDirectory ?? null,
  );
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

function isWindowMaximized(window: BrowserWindow | null): boolean {
  if (!window) {
    return false;
  }

  return process.platform === "darwin"
    ? window.isFullScreen()
    : window.isMaximized();
}

function resolveAppIconPath(): string | undefined {
  const iconFileName =
    process.platform === "darwin"
      ? "icon.icns"
      : process.platform === "win32"
        ? "icon.ico"
        : "icon.png";
  const candidates = [
    join(process.resourcesPath, iconFileName),
    join(app.getAppPath(), "src", "renderer", "src", "assets", iconFileName),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function resolveNotificationIconPath(): string | null {
  const iconFileName = process.platform === "win32" ? "icon.ico" : "icon.png";
  const candidates = [
    join(process.resourcesPath, iconFileName),
    join(app.getAppPath(), "src", "renderer", "src", "assets", iconFileName),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    return candidate;
  }

  return null;
}

async function openBuildNotificationTarget(
  window: BrowserWindow | null,
  warDirectory: string | null,
): Promise<void> {
  window?.flashFrame(false);
  console.info("[main:notification] Opening build notification target", {
    warDirectory,
    exists: warDirectory ? existsSync(warDirectory) : false,
  });
  if (warDirectory && existsSync(warDirectory)) {
    const result = await shell.openPath(warDirectory);
    if (!result) {
      console.info(`[main:notification] Opened ${warDirectory}`);
      return;
    }
    console.error(
      `[main:notification] Failed to open ${warDirectory}: ${result}`,
    );
  }

  if (!window || window.isDestroyed()) {
    return;
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
    frame: false,
    titleBarStyle: IS_MACOS ? "hiddenInset" : undefined,
    trafficLightPosition: IS_MACOS ? { x: 22, y: 18 } : undefined,
    title: "DevDock",
    icon: resolveAppIconPath(),
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

  const emitMaximizedState = (): void => {
    mainWindow?.webContents.send(
      "window:maximized-changed",
      isWindowMaximized(mainWindow),
    );
  };

  mainWindow.on("maximize", emitMaximizedState);
  mainWindow.on("unmaximize", emitMaximizedState);
  mainWindow.on("enter-full-screen", emitMaximizedState);
  mainWindow.on("leave-full-screen", emitMaximizedState);

  if (APP_FEATURE_FLAGS.ssh) {
    sshService?.setShellDataSink((sessionId, data) => {
      const win = mainWindow;
      if (!win || win.isDestroyed()) {
        return;
      }
      win.webContents.send("ssh:shell-data", { sessionId, data });
    });

    xtermService?.setDataSink((sessionId, data) => {
      const win = mainWindow;
      if (!win || win.isDestroyed()) {
        return;
      }
      win.webContents.send("xterm:data", { sessionId, data });
    });
    xtermService?.setExitSink((sessionId, exit) => {
      const win = mainWindow;
      if (!win || win.isDestroyed()) {
        return;
      }
      win.webContents.send("xterm:exit", { sessionId, ...exit });
    });
  }

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

    win.webContents.send("dashboard:app-exit");

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
    mainWindow?.maximize();
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
      console[prefix](`[renderer:console] ${sourceId}:${line} ${message}`);
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

app.whenReady().then(async () => {
  try {
    migrateLegacyUserDataIfNeeded();
    const userDataPath = app.getPath("userData");
    if (CHAT_ENABLED) {
      chatConfig = initializeChat(userDataPath);
    }
    if (APP_FEATURE_FLAGS.ssh) {
      const [{ SshService }, { XtermService }] = await Promise.all([
        import("./sshService"),
        import("./xtermService"),
      ]);
      sshService = new SshService();
      xtermService = new XtermService();
    }
    backend = new DashboardBackend(userDataPath, app.getAppPath());
    registerNotificationActivationHandler();
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
  sshService?.disconnectAll();
  xtermService?.killAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function migrateLegacyUserDataIfNeeded(): void {
  if (
    process.platform !== "win32" ||
    readBooleanEnvironmentFlag(DATA_MIGRATION_ENV_FLAG, false)
  ) {
    return;
  }

  const appDataPath = app.getPath("appData");
  const legacyUserDataPath = join(appDataPath, LEGACY_APP_NAME);
  const currentUserDataPath = join(appDataPath, APP_NAME);

  if (!existsSync(legacyUserDataPath)) {
    return;
  }

  try {
    if (existsSync(currentUserDataPath)) {
      const backupPath = nextAvailableUserDataBackupPath(currentUserDataPath);
      renameSync(currentUserDataPath, backupPath);
      console.info(
        `[main:migrateUserData] Existing ${APP_NAME} data moved to ${backupPath}.`,
      );
    }

    renameSync(legacyUserDataPath, currentUserDataPath);
    removeLegacyUserDataPathIfPresent(legacyUserDataPath);
    markLegacyUserDataMigrationComplete();
    console.info(
      `[main:migrateUserData] Migrated ${LEGACY_APP_NAME} data to ${APP_NAME}.`,
    );
  } catch (error) {
    console.error("[main:migrateUserData]", error);
  }
}

function nextAvailableUserDataBackupPath(userDataPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseBackupPath = `${userDataPath}.before-devdock-migration-${timestamp}`;
  let backupPath = baseBackupPath;
  let suffix = 1;

  while (existsSync(backupPath)) {
    backupPath = `${baseBackupPath}-${suffix}`;
    suffix += 1;
  }

  return backupPath;
}

function removeLegacyUserDataPathIfPresent(legacyUserDataPath: string): void {
  if (!existsSync(legacyUserDataPath)) {
    return;
  }

  rmSync(legacyUserDataPath, { recursive: true, force: true });
  console.info(
    `[main:migrateUserData] Removed leftover ${LEGACY_APP_NAME} data folder.`,
  );
}

function markLegacyUserDataMigrationComplete(): void {
  process.env[DATA_MIGRATION_ENV_FLAG] = "1";

  const result = spawnSync("setx", [DATA_MIGRATION_ENV_FLAG, "1"], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    console.warn(
      `[main:migrateUserData] Failed to persist ${DATA_MIGRATION_ENV_FLAG}.`,
      result.error ?? result.stderr,
    );
  }
}
