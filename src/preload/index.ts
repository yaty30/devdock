import { contextBridge, ipcRenderer } from "electron";
import type {
  DashboardApi,
  DashboardEvent,
  BuildQueryOptions,
  LogChannel,
  ProjectSettingsRecord,
  ServiceAction,
  ServiceName,
  ShutdownEntry,
  BrowsePathOptions,
} from "../shared/dashboardTypes";

const api: DashboardApi = {
  getSnapshot: () => ipcRenderer.invoke("dashboard:getSnapshot"),
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
  stopBuild: (projectId) => ipcRenderer.invoke("dashboard:stopBuild", projectId),
  getBuilds: (projectId: string, options?: BuildQueryOptions) =>
    ipcRenderer.invoke("dashboard:getBuilds", projectId, options),
  refreshStatus: (projectId) =>
    ipcRenderer.invoke("dashboard:refreshStatus", projectId),
  getGitStatus: (projectId) =>
    ipcRenderer.invoke("dashboard:getGitStatus", projectId),
  runGitCommand: (projectId, args) =>
    ipcRenderer.invoke("dashboard:runGitCommand", projectId, args),
  browsePath: (options: BrowsePathOptions) =>
    ipcRenderer.invoke("dashboard:browsePath", options),
  openPath: (path) => ipcRenderer.invoke("dashboard:openPath", path),
  openLog: (projectId, channel) =>
    ipcRenderer.invoke("dashboard:openLog", projectId, channel),
  deleteProject: (projectId) =>
    ipcRenderer.invoke("dashboard:deleteProject", projectId),
  getLogLatest: (projectId: string, channel: LogChannel, limit?: number) =>
    ipcRenderer.invoke("logs:get-latest", projectId, channel, limit),
  getLogBefore: (
    projectId: string,
    channel: LogChannel,
    beforeSeq: number,
    limit?: number,
  ) =>
    ipcRenderer.invoke("logs:get-before", projectId, channel, beforeSeq, limit),
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
};

contextBridge.exposeInMainWorld("ivsDashboard", api);
