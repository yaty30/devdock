import { contextBridge, ipcRenderer } from "electron";
import type {
  DashboardApi,
  DashboardEvent,
  BuildQueryOptions,
  ApiFetchQueryOptions,
  LogChannel,
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
  getGitStatus: (projectId) =>
    ipcRenderer.invoke("dashboard:getGitStatus", projectId),
  runGitCommand: (projectId, args) =>
    ipcRenderer.invoke("dashboard:runGitCommand", projectId, args),
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
};

contextBridge.exposeInMainWorld("ivsDashboard", api);
