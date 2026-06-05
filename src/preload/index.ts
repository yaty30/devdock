import { contextBridge, ipcRenderer } from "electron";
import type {
  DashboardApi,
  DashboardEvent,
  BuildQueryOptions,
  ApiFetchQueryOptions,
  LogChannel,
  ProjectEnvScope,
  ProjectEnvVariable,
  ProjectSettingsRecord,
  ServiceAction,
  ServiceName,
  ShutdownEntry,
  BrowsePathOptions,
} from "../shared/dashboardTypes";
import type { ChatNativeNotification } from "../shared/chatTypes";

const api: DashboardApi = {
  getFeatureFlags: () => ipcRenderer.invoke("dashboard:getFeatureFlags"),
  showDebugBuildNotification: () =>
    ipcRenderer.invoke("dashboard:showDebugBuildNotification"),
  isWindowMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  sshConnect: (request) => ipcRenderer.invoke("ssh:connect", request),
  sshDisconnect: (sessionId) => ipcRenderer.invoke("ssh:disconnect", sessionId),
  sshExec: (sessionId, command) =>
    ipcRenderer.invoke("ssh:exec", sessionId, command),
  sshWrite: (sessionId, data) =>
    ipcRenderer.invoke("ssh:write", sessionId, data),
  onSshShellData: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { sessionId: string; data: string },
    ) => listener(payload);
    ipcRenderer.on("ssh:shell-data", handler);
    return () => ipcRenderer.off("ssh:shell-data", handler);
  },
  listLocalDirectory: (path) =>
    ipcRenderer.invoke("fs:listLocalDirectory", path),
  sshListDirectory: (sessionId, path) =>
    ipcRenderer.invoke("ssh:listDirectory", sessionId, path),
  createLocalDirectory: (parentPath, name) =>
    ipcRenderer.invoke("fs:createDirectory", parentPath, name),
  renameLocalPath: (path, newName) =>
    ipcRenderer.invoke("fs:renamePath", path, newName),
  deleteLocalPath: (path) => ipcRenderer.invoke("fs:deletePath", path),
  previewLocalFile: (path) => ipcRenderer.invoke("fs:previewFile", path),
  sshCreateDirectory: (sessionId, parentPath, name) =>
    ipcRenderer.invoke("ssh:createDirectory", sessionId, parentPath, name),
  sshRenamePath: (sessionId, path, newName) =>
    ipcRenderer.invoke("ssh:renamePath", sessionId, path, newName),
  sshDeletePath: (sessionId, path, type) =>
    ipcRenderer.invoke("ssh:deletePath", sessionId, path, type),
  sshUploadFile: (sessionId, localPath, remoteDirectory) =>
    ipcRenderer.invoke("ssh:uploadFile", sessionId, localPath, remoteDirectory),
  sshDownloadFile: (sessionId, remotePath, localDirectory) =>
    ipcRenderer.invoke(
      "ssh:downloadFile",
      sessionId,
      remotePath,
      localDirectory,
    ),
  sshPreviewFile: (sessionId, remotePath) =>
    ipcRenderer.invoke("ssh:previewFile", sessionId, remotePath),
  sendApiTesterRequest: (request) =>
    ipcRenderer.invoke("apiTester:sendRequest", request),
  getApiTesterSavedRequests: (scopeId) =>
    ipcRenderer.invoke("apiTester:getSavedRequests", scopeId),
  saveApiTesterSavedRequest: (request) =>
    ipcRenderer.invoke("apiTester:saveSavedRequest", request),
  deleteApiTesterSavedRequest: (id) =>
    ipcRenderer.invoke("apiTester:deleteSavedRequest", id),
  getSnapshot: () => ipcRenderer.invoke("dashboard:getSnapshot"),
  getDatabaseConnections: () => ipcRenderer.invoke("database:getConnections"),
  saveDatabaseConnection: (connection) =>
    ipcRenderer.invoke("database:saveConnection", connection),
  updateDatabaseConnectionSettings: (connectionId, updates) =>
    ipcRenderer.invoke(
      "database:updateConnectionSettings",
      connectionId,
      updates,
    ),
  deleteDatabaseConnection: (connectionId) =>
    ipcRenderer.invoke("database:deleteConnection", connectionId),
  testDatabaseConnection: (connection) =>
    ipcRenderer.invoke("database:testConnection", connection),
  getDatabaseMetadata: (connection) =>
    ipcRenderer.invoke("database:getMetadata", connection),
  getDatabaseObjectNames: (connection, collection) =>
    ipcRenderer.invoke("database:getObjectNames", connection, collection),
  getDatabaseWorksheetState: (connectionId) =>
    ipcRenderer.invoke("database:getWorksheetState", connectionId),
  saveDatabaseWorksheetState: (state) =>
    ipcRenderer.invoke("database:saveWorksheetState", state),
  deleteDatabaseWorksheet: (connectionId, sheetId) =>
    ipcRenderer.invoke("database:deleteWorksheet", connectionId, sheetId),
  getDatabaseExecutionHistory: (connectionId) =>
    ipcRenderer.invoke("database:getExecutionHistory", connectionId),
  executeDatabaseStatements: (connection, statements) =>
    ipcRenderer.invoke("database:executeStatements", connection, statements),
  exportDatabaseResult: (fileName, contentBase64) =>
    ipcRenderer.invoke("database:exportResult", fileName, contentBase64),
  getDashboardOverview: () =>
    ipcRenderer.invoke("dashboard:getDashboardOverview"),
  getProjectState: (projectId) =>
    ipcRenderer.invoke("dashboard:getProjectState", projectId),
  getProjectEnvFiles: (projectId) =>
    ipcRenderer.invoke("dashboard:getProjectEnvFiles", projectId),
  saveProjectEnvFile: (
    projectId: string,
    scope: ProjectEnvScope,
    filePath: string,
    variables: ProjectEnvVariable[],
  ) =>
    ipcRenderer.invoke(
      "dashboard:saveProjectEnvFile",
      projectId,
      scope,
      filePath,
      variables,
    ),
  saveProjectSettings: (projectId, settings: ProjectSettingsRecord) =>
    ipcRenderer.invoke("dashboard:saveProjectSettings", projectId, settings),
  serviceAction: (
    projectId: string,
    service: ServiceName,
    action: ServiceAction,
  ) =>
    ipcRenderer.invoke("dashboard:serviceAction", projectId, service, action),
  runBuild: (projectId, profileId) =>
    ipcRenderer.invoke("dashboard:runBuild", projectId, profileId),
  stopBuild: (projectId) =>
    ipcRenderer.invoke("dashboard:stopBuild", projectId),
  getBuilds: (projectId: string, options?: BuildQueryOptions) =>
    ipcRenderer.invoke("dashboard:getBuilds", projectId, options),
  getApiFetches: (projectId: string, options?: ApiFetchQueryOptions) =>
    ipcRenderer.invoke("dashboard:getApiFetches", projectId, options),
  refreshStatus: (projectId) =>
    ipcRenderer.invoke("dashboard:refreshStatus", projectId),
  getGitStatus: (projectId, context) =>
    ipcRenderer.invoke("dashboard:getGitStatus", projectId, context),
  runGitCommand: (projectId, args, context) =>
    ipcRenderer.invoke("dashboard:runGitCommand", projectId, args, context),
  getSheets: (projectId) =>
    ipcRenderer.invoke("dashboard:getSheets", projectId),
  createSheet: (projectId, title) =>
    ipcRenderer.invoke("dashboard:createSheet", projectId, title),
  updateSheet: (projectId, sheetId, updates) =>
    ipcRenderer.invoke("dashboard:updateSheet", projectId, sheetId, updates),
  deleteSheet: (projectId, sheetId) =>
    ipcRenderer.invoke("dashboard:deleteSheet", projectId, sheetId),
  browsePath: (options: BrowsePathOptions) =>
    ipcRenderer.invoke("dashboard:browsePath", options),
  openPath: (path) => ipcRenderer.invoke("dashboard:openPath", path),
  openExternalUrl: (url) =>
    ipcRenderer.invoke("dashboard:openExternalUrl", url),
  getChatConfig: () => ipcRenderer.invoke("chat:getConfig"),
  saveChatProfile: (profile) => ipcRenderer.invoke("chat:saveProfile", profile),
  notifyChatMessage: (notification: ChatNativeNotification) =>
    ipcRenderer.invoke("chat:notifyMessage", notification),
  openLog: (projectId, channel) =>
    ipcRenderer.invoke("dashboard:openLog", projectId, channel),
  deleteProject: (projectId) =>
    ipcRenderer.invoke("dashboard:deleteProject", projectId),
  createProject: (name, code, backendType, pythonServerType) =>
    ipcRenderer.invoke(
      "dashboard:createProject",
      name,
      code,
      backendType,
      pythonServerType,
    ),
  updateProject: (projectId, name, code) =>
    ipcRenderer.invoke("dashboard:updateProject", projectId, name, code),
  validateProjectSettings: (projectId, name, code, settings) =>
    ipcRenderer.invoke(
      "dashboard:validateProjectSettings",
      projectId,
      name,
      code,
      settings,
    ),
  getLogLatest: (projectId: string, channel: LogChannel, limit?: number) =>
    ipcRenderer.invoke("logs:get-latest", projectId, channel, limit),
  getLogBefore: (
    projectId: string,
    channel: LogChannel,
    beforeSeq: number,
    limit?: number,
  ) =>
    ipcRenderer.invoke("logs:get-before", projectId, channel, beforeSeq, limit),
  getLogAround: (
    projectId: string,
    channel: LogChannel,
    seq: number,
    limit?: number,
  ) => ipcRenderer.invoke("logs:get-around", projectId, channel, seq, limit),
  searchLog: (projectId: string, channel: LogChannel, term: string) =>
    ipcRenderer.invoke("logs:search", projectId, channel, term),
  onEvent: (listener: (event: DashboardEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: DashboardEvent,
    ) => listener(payload);
    ipcRenderer.on("dashboard:event", handler);
    return () => ipcRenderer.off("dashboard:event", handler);
  },
  onShutdownStarted: (listener: (entries: ShutdownEntry[]) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      entries: ShutdownEntry[],
    ) => listener(entries);
    ipcRenderer.on("dashboard:shutdown-started", handler);
    return () => ipcRenderer.off("dashboard:shutdown-started", handler);
  },
  onShutdownServiceStopped: (
    listener: (projectId: string, service: ServiceName) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      projectId: string,
      service: ServiceName,
    ) => listener(projectId, service);
    ipcRenderer.on("dashboard:shutdown-service-stopped", handler);
    return () => ipcRenderer.off("dashboard:shutdown-service-stopped", handler);
  },
  onAppExit: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("dashboard:app-exit", handler);
    return () => ipcRenderer.off("dashboard:app-exit", handler);
  },
  onChatOpenRequest: (listener: (conversationId: string) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      conversationId: string,
    ) => listener(conversationId);
    ipcRenderer.on("chat:open-conversation", handler);
    return () => ipcRenderer.off("chat:open-conversation", handler);
  },
  onWindowMaximizedChange: (listener: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
      listener(maximized);
    ipcRenderer.on("window:maximized-changed", handler);
    return () => ipcRenderer.off("window:maximized-changed", handler);
  },
  xtermCreateSession: (request) =>
    ipcRenderer.invoke("xterm:createSession", request),
  xtermInput: (sessionId, data) =>
    ipcRenderer.invoke("xterm:input", sessionId, data),
  xtermResize: (sessionId, cols, rows) =>
    ipcRenderer.invoke("xterm:resize", sessionId, cols, rows),
  xtermKillSession: (sessionId) =>
    ipcRenderer.invoke("xterm:killSession", sessionId),
  onXtermData: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { sessionId: string; data: string },
    ) => listener(payload);
    ipcRenderer.on("xterm:data", handler);
    return () => ipcRenderer.off("xterm:data", handler);
  },
  onXtermExit: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { sessionId: string; exitCode: number; signal?: number },
    ) => listener(payload);
    ipcRenderer.on("xterm:exit", handler);
    return () => ipcRenderer.off("xterm:exit", handler);
  },
};

contextBridge.exposeInMainWorld("ivsDashboard", api);
