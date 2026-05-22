import type {
  ChatNativeNotification,
  ChatServiceConfig,
  ChatUserProfile,
} from "./chatTypes";

export type BackendType = "wildfly" | "python";
export type BackendServiceName = BackendType;
export type ServiceName = "frontend" | BackendServiceName;
export type ServiceAction = "start" | "stop" | "restart";
export type ServiceState =
  | "running"
  | "stopping"
  | "starting"
  | "stopped"
  | "unknown"
  | "failed";
export type BuildOutcomeType = "build-only" | "build-and-deploy";
export type BuildStatus = "running" | "success" | "failed" | "stopped";
export type ActivityTone = "success" | "accent" | "info" | "neutral" | "failed";
export type ActivityKind = "service" | "build" | "git" | "system";
export type LogChannel = "frontend" | BackendServiceName | "build" | "tail";

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

export type SheetContentJson = Record<string, unknown>;

export type Sheet = {
  id: string;
  projectId: string;
  title: string;
  contentJson: SheetContentJson;
  createdAt: string;
  updatedAt: string;
  autoSaveEnabled: boolean;
  pinned: boolean;
  pinnedAt: string | null;
};

export type SheetUpdate = Partial<
  Pick<Sheet, "contentJson" | "autoSaveEnabled" | "pinned" | "pinnedAt">
>;

export type ProjectRecord = {
  id: string;
  name: string;
  code: string;
  backendType: BackendType;
};

export type ServiceConfig = {
  enabled?: boolean;
  workingDirectory: string;
  command: string;
  healthUrl: string;
  appUrl?: string;
  managementUrl?: string;
  autoStart?: boolean;
};

export type ProjectFrontendConfig = {
  enabled: boolean;
  path?: string;
  installCommand?: string;
  devCommand?: string;
  buildCommand?: string;
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
  backendType: BackendType;
  appLogFile: string;
  gitProjectDirectory: string;
  defaultBranch: string;
  remote: string;
  frontend: ProjectFrontendConfig;
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
  frontendEnabled: boolean;
  statuses: ServiceStatusRecord[];
  lastBuild?: RecentBuildRecord;
  serviceUrls: {
    frontendUrl: string;
    backendUrl: string;
    backendManagementUrl: string;
    backendLabel: string;
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

export type DatabaseConnectionStatus = "connected" | "disconnected" | "error";
export type DatabaseConnectionType = "MySQL" | "Oracle";
export type DatabaseSslMode = "disabled" | "preferred" | "required";
export type OracleConnectionMode =
  | "serviceName"
  | "sid"
  | "connectString"
  | "tnsAlias";

export type DatabaseConnection = {
  id: string;
  name: string;
  type: DatabaseConnectionType;
  status: DatabaseConnectionStatus;
  host: string;
  port: string;
  user: string;
  schema: string;
  password?: string;
  savePassword?: boolean;
  autoConnect?: boolean;
  connectionTimeoutMs?: number;
  database?: string;
  sslMode?: DatabaseSslMode;
  connectionMode?: OracleConnectionMode;
  serviceName?: string;
  sid?: string;
  connectString?: string;
  networkAlias?: string;
  role?: string;
  walletPath?: string;
  latency: string;
  uptime: string;
  activeSessions: number;
};

export type DatabaseConnectionTestResult = {
  success: boolean;
  message: string;
  latency?: string;
};

export type DatabaseColumnMetadata = Array<{ label: string; value: string }>;

export type DatabaseColumn = {
  name: string;
  metadata: DatabaseColumnMetadata;
};

export type DatabaseIndex = {
  name: string;
  columns: string[];
  type: string;
};

export type DatabaseTrigger = {
  name: string;
  timing?: string;
  event?: string;
};

export type DatabasePartition = {
  name: string;
  method?: string;
  expression?: string;
  description?: string;
};

export type DatabaseTable = {
  schema: string;
  name: string;
  estimatedRowCount?: number | null;
  columns: DatabaseColumn[];
  indexes: DatabaseIndex[];
  triggers: DatabaseTrigger[];
  partitions: DatabasePartition[];
};

export type DatabaseObjectCollectionName =
  | "tables"
  | "views"
  | "procedures"
  | "functions"
  | "types"
  | "sequences"
  | "packages"
  | "triggers"
  | "indexes";

export type DatabaseMetadata = {
  schemas: string[];
  tables: DatabaseTable[];
  views: string[];
  procedures: string[];
  functions: string[];
  types: string[];
  sequences: string[];
  packages: string[];
  objectCounts: Partial<Record<DatabaseObjectCollectionName, number>>;
};

export type DatabaseQueryValue = string | number | boolean | null;

export type DatabaseQueryColumn = {
  key: string;
  label: string;
  type?: string;
};

export type DatabaseStatementExecutionResult = {
  executionRecordId?: string;
  executedAt?: string;
  executionMessage?: string;
  statement: string;
  columns: DatabaseQueryColumn[];
  rows: Array<Record<string, DatabaseQueryValue>>;
  status: "success" | "error";
  errorMessage?: string;
  durationMs: number;
  rowsFetched: number;
  rowsAffected?: number;
};

export type DatabaseExecutionBatchResult = {
  results: DatabaseStatementExecutionResult[];
};

export type DatabaseExportResult =
  | {
      success: true;
      path: string;
    }
  | {
      success: false;
      canceled: true;
    };

export type DatabaseWorksheet = {
  connectionId: string;
  sheetId: string;
  sheetName: string;
  sql: string;
  savedAt: string;
  isOpen: boolean;
  sortOrder: number;
  sheetMode?: "normal" | "object-backed" | "transient-preview";
  objectBinding?: {
    connectionId: string;
    objectType:
      | "table"
      | "view"
      | "procedure"
      | "function"
      | "type"
      | "sequence"
      | "package"
      | "trigger"
      | "index";
    schema: string;
    name: string;
    tableName?: string;
    isNew?: boolean;
  };
};

export type DatabaseWorksheetState = {
  connectionId: string;
  sheets: DatabaseWorksheet[];
  activeSheetId: string | null;
};

export type DatabaseExecutionRecord = {
  id: string;
  time: string;
  connectionId: string;
  connection: string;
  user: string;
  query: string;
  duration: string;
  status: "success" | "error";
  rows: number;
  rowsAffected?: number;
  errorMessage?: string;
  message?: string;
};

export type ApiTesterRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  bodyBase64?: string;
  bodyEncoding?: "utf8" | "base64";
  bodyFormData?: ApiTesterFormDataPart[];
  timeoutMs?: number;
};

export type ApiTesterFormDataPart = {
  name: string;
  value?: string;
  fileName?: string;
  fileType?: string;
  fileBase64?: string;
};

export type ApiTesterResponseHeader = {
  name: string;
  value: string;
};

export type ApiTesterResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  durationMs: number;
  sizeBytes: number;
  headers: ApiTesterResponseHeader[];
  body: string;
  bodyBase64?: string;
  bodyEncoding?: "utf8" | "base64";
  binary?: boolean;
};

export type ApiTesterSavedRequestRecord = {
  id: string;
  scopeId: string;
  name: string;
  method: string;
  url: string;
  requestJson: string;
  createdAt: string;
  updatedAt: string;
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
  getFeatureFlags: () => Promise<{
    chatEnabled: boolean;
    debugEnabled: boolean;
  }>;
  showDebugBuildNotification: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  sendApiTesterRequest: (
    request: ApiTesterRequest,
  ) => Promise<ApiTesterResponse>;
  getApiTesterSavedRequests: (
    scopeId: string,
  ) => Promise<ApiTesterSavedRequestRecord[]>;
  saveApiTesterSavedRequest: (request: {
    id?: string;
    scopeId: string;
    name: string;
    method: string;
    url: string;
    requestJson: string;
  }) => Promise<ApiTesterSavedRequestRecord>;
  deleteApiTesterSavedRequest: (id: string) => Promise<void>;
  getSnapshot: () => Promise<DashboardSnapshot>;
  getDatabaseConnections: () => Promise<DatabaseConnection[]>;
  saveDatabaseConnection: (
    connection: DatabaseConnection,
  ) => Promise<DatabaseConnection>;
  updateDatabaseConnectionSettings: (
    connectionId: string,
    updates: Partial<
      Pick<
        DatabaseConnection,
        "autoConnect" | "status" | "latency" | "uptime" | "activeSessions"
      >
    >,
  ) => Promise<DatabaseConnection>;
  deleteDatabaseConnection: (connectionId: string) => Promise<void>;
  testDatabaseConnection: (
    connection: DatabaseConnection,
  ) => Promise<DatabaseConnectionTestResult>;
  getDatabaseMetadata: (
    connection: DatabaseConnection,
  ) => Promise<DatabaseMetadata>;
  getDatabaseObjectNames: (
    connection: DatabaseConnection,
    collection: DatabaseObjectCollectionName,
  ) => Promise<string[]>;
  getDatabaseWorksheetState: (
    connectionId: string,
  ) => Promise<DatabaseWorksheetState>;
  saveDatabaseWorksheetState: (
    state: DatabaseWorksheetState,
  ) => Promise<DatabaseWorksheetState>;
  deleteDatabaseWorksheet: (
    connectionId: string,
    sheetId: string,
  ) => Promise<void>;
  getDatabaseExecutionHistory: (
    connectionId?: string,
  ) => Promise<DatabaseExecutionRecord[]>;
  executeDatabaseStatements: (
    connection: DatabaseConnection,
    statements: string[],
  ) => Promise<DatabaseExecutionBatchResult>;
  exportDatabaseResult: (
    fileName: string,
    contentBase64: string,
  ) => Promise<DatabaseExportResult>;
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
  getSheets: (projectId: string) => Promise<Sheet[]>;
  createSheet: (projectId: string, title: string) => Promise<Sheet>;
  updateSheet: (
    projectId: string,
    sheetId: string,
    updates: SheetUpdate,
  ) => Promise<Sheet>;
  deleteSheet: (projectId: string, sheetId: string) => Promise<void>;
  browsePath: (options: BrowsePathOptions) => Promise<string | null>;
  openPath: (path: string) => Promise<string>;
  openExternalUrl: (url: string) => Promise<void>;
  getChatConfig: () => Promise<ChatServiceConfig>;
  saveChatProfile: (profile: ChatUserProfile) => Promise<ChatServiceConfig>;
  notifyChatMessage: (notification: ChatNativeNotification) => Promise<void>;
  openLog: (projectId: string, channel: LogChannel) => Promise<string>;
  deleteProject: (projectId: string) => Promise<void>;
  createProject: (
    name: string,
    code: string,
    backendType: BackendType,
  ) => Promise<ProjectRecord>;
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
  onAppExit: (listener: () => void) => () => void;
  onChatOpenRequest: (listener: (conversationId: string) => void) => () => void;
  onWindowMaximizedChange: (
    listener: (maximized: boolean) => void,
  ) => () => void;
};
