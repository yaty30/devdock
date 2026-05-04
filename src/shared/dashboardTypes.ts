export type ServiceName = "frontend" | "wildfly";
export type ServiceAction = "start" | "stop" | "restart";
export type ServiceState =
  | "running"
  | "stopping"
  | "starting"
  | "stopped"
  | "unknown"
  | "error";
export type BuildOutcomeType = "build-only" | "build-and-deploy";
export type BuildStatus = "running" | "success" | "failed" | "stopped";
export type ActivityTone = "success" | "accent" | "info" | "neutral" | "error";
export type ActivityKind = "service" | "build" | "git" | "system";
export type LogChannel = "frontend" | "wildfly" | "build" | "tail";

export type LogLine = {
  seq: number;
  text: string;
};

export type LogQueryResult = {
  lines: LogLine[];
  oldestSeq: number | null;
  newestSeq: number | null;
  hasMoreOlder: boolean;
};

export type LogSearchResult = {
  matchSeqs: number[];
  total: number;
};

export type ProjectRecord = {
  id: string;
  name: string;
  code: string;
};

export type ServiceConfig = {
  workingDirectory: string;
  command: string;
  healthUrl: string;
  appUrl?: string;
  managementUrl?: string;
  autoStart?: boolean;
};

export type MavenConfig = {
  executable: string;
  settingsXml: string;
  pomXml: string;
  skipTests: boolean;
};

export type BuildProfileRecord = {
  id: string;
  buttonName: string;
  profileName: string;
  goals: string;
  confirm: boolean;
  outcomeType: BuildOutcomeType;
};

export type ProjectSettingsRecord = {
  appLogFile: string;
  gitProjectDirectory: string;
  defaultBranch: string;
  remote: string;
  services: Record<ServiceName, ServiceConfig>;
  maven: MavenConfig;
  buildProfiles: BuildProfileRecord[];
};

export type ServiceStatusRecord = {
  service: ServiceName;
  state: ServiceState;
  message: string;
  url?: string;
  checkedAt: string;
  startedAt?: string;
};

export type RecentBuildRecord = {
  id: string;
  branch: string;
  commit: string;
  commitCleanliness: "clean" | "dirty" | "unknown";
  profile: string;
  status: "Running" | "Success" | "Failed" | "Stopped";
  duration: string;
  completed: string;
  startedAt: string;
  completedAt?: string;
  outcomeType: BuildOutcomeType;
};

export type BuildQuerySortKey =
  | "id"
  | "branch"
  | "commit"
  | "profile"
  | "status"
  | "duration"
  | "completed";

export type BuildQueryOptions = {
  search?: string;
  status?: RecentBuildRecord["status"] | "All";
  sortBy?: BuildQuerySortKey;
  sortDirection?: "asc" | "desc";
  offset?: number;
  limit?: number;
};

export type BuildQueryResult = {
  builds: RecentBuildRecord[];
  total: number;
  hasMore: boolean;
};

export type ActivityRecord = {
  id: number;
  title: string;
  meta: string;
  time: string;
  createdAt: string;
  tone: ActivityTone;
  kind: ActivityKind;
};

export type GitStatusRecord = {
  repository: string;
  branch: string;
  commit: string;
  status: string;
  lines: string[];
};

export type ProjectRuntimeState = {
  settings: ProjectSettingsRecord;
  statuses: ServiceStatusRecord[];
  recentBuilds: RecentBuildRecord[];
  activityFeed: ActivityRecord[];
  gitStatus: GitStatusRecord;
  logs: Record<LogChannel, string[]>;
};

export type ProjectDashboardSummary = {
  project: ProjectRecord;
  statuses: ServiceStatusRecord[];
  lastBuild?: RecentBuildRecord;
  serviceUrls: {
    frontendUrl: string;
    wildflyConsoleUrl: string;
    wildflyKmuUrl: string;
  };
};

export type DashboardSnapshot = {
  projects: ProjectRecord[];
  activeProjectId: string;
};

export type ShutdownEntry = {
  projectId: string;
  service: ServiceName;
  projectName: string;
};

export type BrowsePathOptions = {
  kind: "file" | "directory";
  title?: string;
  defaultPath?: string;
  filters?: Array<{
    name: string;
    extensions: string[];
  }>;
};

export type DashboardEvent =
  | {
      type: "log";
      projectId: string;
      channel: LogChannel;
      line: string;
    }
  | {
      type: "log-batch";
      projectId: string;
      channel: LogChannel;
      lines: LogLine[];
    }
  | {
      type: "log-clear";
      projectId: string;
      channel: LogChannel;
    }
  | {
      type: "status";
      projectId: string;
      status: ServiceStatusRecord;
    }
  | {
      type: "builds";
      projectId: string;
      builds: RecentBuildRecord[];
    }
  | {
      type: "activity";
      projectId: string;
      activityFeed: ActivityRecord[];
    }
  | {
      type: "settings";
      projectId: string;
      settings: ProjectSettingsRecord;
    };

export type DashboardApi = {
  getSnapshot: () => Promise<DashboardSnapshot>;
  getDashboardOverview: () => Promise<ProjectDashboardSummary[]>;
  getProjectState: (projectId: string) => Promise<ProjectRuntimeState>;
  saveProjectSettings: (
    projectId: string,
    settings: ProjectSettingsRecord,
  ) => Promise<ProjectSettingsRecord>;
  serviceAction: (
    projectId: string,
    service: ServiceName,
    action: ServiceAction,
  ) => Promise<ServiceStatusRecord>;
  runBuild: (
    projectId: string,
    profileId: string,
  ) => Promise<RecentBuildRecord>;
  stopBuild: (projectId: string) => Promise<RecentBuildRecord | null>;
  getBuilds: (
    projectId: string,
    options?: BuildQueryOptions,
  ) => Promise<BuildQueryResult>;
  refreshStatus: (projectId: string) => Promise<ServiceStatusRecord[]>;
  getGitStatus: (projectId: string) => Promise<GitStatusRecord>;
  runGitCommand: (projectId: string, args: string) => Promise<GitStatusRecord>;
  browsePath: (options: BrowsePathOptions) => Promise<string | null>;
  openPath: (path: string) => Promise<string>;
  openLog: (projectId: string, channel: LogChannel) => Promise<string>;
  deleteProject: (projectId: string) => Promise<void>;
  createProject: (name: string, code: string) => Promise<ProjectRecord>;
  updateProject: (
    projectId: string,
    name: string,
    code: string,
  ) => Promise<ProjectRecord>;
  validateProjectSettings: (
    projectId: string,
    name: string,
    code: string,
    settings: ProjectSettingsRecord,
  ) => Promise<string[]>;
  getLogLatest: (
    projectId: string,
    channel: LogChannel,
    limit?: number,
  ) => Promise<LogQueryResult>;
  getLogBefore: (
    projectId: string,
    channel: LogChannel,
    beforeSeq: number,
    limit?: number,
  ) => Promise<LogQueryResult>;
  getLogAround: (
    projectId: string,
    channel: LogChannel,
    seq: number,
    limit?: number,
  ) => Promise<LogQueryResult>;
  searchLog: (
    projectId: string,
    channel: LogChannel,
    term: string,
  ) => Promise<LogSearchResult>;
  onEvent: (listener: (event: DashboardEvent) => void) => () => void;
  onShutdownStarted: (
    listener: (entries: ShutdownEntry[]) => void,
  ) => () => void;
  onShutdownServiceStopped: (
    listener: (projectId: string, service: ServiceName) => void,
  ) => () => void;
};
