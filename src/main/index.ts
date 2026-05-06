import started from "electron-squirrel-startup";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions } from "electron";
import { join } from "node:path";
import { DashboardBackend } from "./dashboardBackend";
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

if (started) {
  app.quit();
  process.exit(0);
}

let backend: DashboardBackend | null = null;
let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const EXIT_AFTER_SHUTDOWN_DELAY_MS = 1000;

function getBackend(): DashboardBackend {
  if (!backend) {
    throw new Error("Dashboard backend has not been initialized.");
  }

  return backend;
}

function registerIpc(): void {
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
    "database:getWorksheetState",
    (_event, connectionId: string) =>
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
        win.destroy();
        app.exit(0);
      });
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
    backend = new DashboardBackend(app.getPath("userData"), app.getAppPath());
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
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
