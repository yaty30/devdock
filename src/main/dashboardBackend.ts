import { BrowserWindow } from "electron";
import DatabaseConstructor, { type Database } from "better-sqlite3";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  closeSync,
  existsSync,
  appendFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { userInfo } from "node:os";
import type {
  ActivityKind,
  ActivityRecord,
  ActivityTone,
  BuildOutcomeType,
  BuildProfileRecord,
  BuildQueryOptions,
  BuildQueryResult,
  BuildQuerySortKey,
  DashboardEvent,
  DashboardSnapshot,
  GitStatusRecord,
  LogChannel,
  LogLine,
  LogQueryResult,
  ProjectRecord,
  ProjectDashboardSummary,
  ProjectRuntimeState,
  ProjectSettingsRecord,
  RecentBuildRecord,
  ServiceAction,
  ServiceName,
  ServiceState,
  ServiceStatusRecord,
  ShutdownEntry,
} from "../shared/dashboardTypes";
import {
  MAX_PROJECTS,
  MAX_RUNNING_SERVICES,
  RUNNING_SERVER_LIMIT_MESSAGE,
} from "../shared/appLimits";

type ServiceProcess = {
  child: ChildProcessWithoutNullStreams;
  startedAt: string;
  startupLogAt?: string;
  readyLogAt?: string;
  stopRequested?: boolean;
};

type BuildProcess = {
  child: ChildProcessWithoutNullStreams;
  rowId: number;
  stopRequested: boolean;
};

type BuildResult = "success" | "failed" | "stopped";

type TailState = {
  path: string;
  offset: number;
  lineCount: number;
  timer: NodeJS.Timeout;
};

type BuildRow = {
  id: number;
  project_id: string;
  profile_name: string;
  button_name: string;
  branch: string;
  commit_hash: string;
  commit_cleanliness: string;
  environment: string;
  triggered_by: string;
  status: string;
  outcome_type: BuildOutcomeType;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
};

type ActivityRow = {
  id: number;
  project_id: string;
  title: string;
  meta: string;
  tone: ActivityTone;
  kind: ActivityKind;
  created_at: string;
};

type ProjectRow = ProjectRecord;

type SettingsRow = {
  project_id: string;
  settings_json: string;
  updated_at: string;
};

type SettingsActivityEntry = {
  title: string;
  meta: string;
  tone: ActivityTone;
};

const LOG_LIMIT = 5000;
const LOG_BATCH_FLUSH_MS = 50;
const STATUS_INTERVAL_MS = 5000;
const TAIL_INTERVAL_MS = 1000;
const SERVICE_STARTING_GRACE_MS = 5 * 60 * 1000;
const WILDFLY_READY_LOG_FRAGMENT = "Admin console listening on";

const CHANNEL_NAME = "dashboard:event";

export class DashboardBackend {
  private readonly db: Database;
  private readonly repoRoot: string;
  private readonly dataRoot: string;
  private readonly serviceProcesses = new Map<string, ServiceProcess>();
  private readonly explicitlyStoppedServices = new Set<string>();
  private readonly buildProcesses = new Map<string, BuildProcess>();
  private readonly logs = new Map<string, LogLine[]>();
  private readonly logSeqMap = new Map<string, number>();
  private readonly tailStates = new Map<string, TailState>();
  private readonly statusTimers = new Map<string, NodeJS.Timeout>();
  private readonly logBuffer = new Map<string, LogLine[]>();
  private logFlushTimer: NodeJS.Timeout | null = null;

  constructor(userDataPath: string, repoRoot: string) {
    const dbDir = join(userDataPath, "dashboard");
    mkdirSync(dbDir, { recursive: true });
    this.dataRoot = dbDir;
    this.repoRoot = repoRoot;
    this.db = new DatabaseConstructor(join(dbDir, "ivs-dashboard.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.initializeSchema();
    this.markInterruptedBuilds();
  }

  getSnapshot(): DashboardSnapshot {
    const projects = this.db
      .prepare("SELECT id, name, code FROM projects ORDER BY created_at ASC")
      .all() as ProjectRow[];

    return {
      projects,
      activeProjectId: projects[0]?.id ?? "",
    };
  }

  getDashboardOverview(): ProjectDashboardSummary[] {
    return this.getProjects().map((project) => {
      this.pruneBuilds(project.id);
      const settings = this.getSettings(project.id);
      return {
        project,
        statuses: this.getStatuses(project.id),
        lastBuild: this.queryBuilds(project.id, { limit: 1 }).builds[0],
        serviceUrls: {
          frontendUrl:
            settings.services.frontend.appUrl ||
            settings.services.frontend.healthUrl,
          wildflyConsoleUrl: settings.services.wildfly.managementUrl || "",
          wildflyKmuUrl: settings.services.wildfly.appUrl || "",
        },
      };
    });
  }

  getProjectState(projectId: string): ProjectRuntimeState {
    const settings = this.getSettings(projectId);
    this.ensureStatusPolling(projectId);
    this.ensureTail(projectId, settings.appLogFile);

    return {
      settings,
      statuses: this.getStatuses(projectId),
      recentBuilds: this.getRecentBuilds(projectId),
      activityFeed: this.getActivity(projectId),
      gitStatus: this.getGitStatus(projectId),
      logs: {
        frontend: this.getLog(projectId, "frontend"),
        wildfly: this.getLog(projectId, "wildfly"),
        build: this.getLog(projectId, "build"),
        tail: [],
      },
    };
  }

  async autoStartServices(): Promise<void> {
    const projects = this.getProjects();
    const startedCommands = new Set<string>();

    for (const project of projects) {
      for (const service of ["frontend", "wildfly"] as ServiceName[]) {
        const settings = this.getSettings(project.id);
        const config = settings.services[service];
        if (!config.autoStart) continue;
        const commandKey = `${service}:${config.workingDirectory}:${config.command}`;

        if (startedCommands.has(commandKey)) {
          continue;
        }

        startedCommands.add(commandKey);
        await this.startService(project.id, service);
      }
    }
  }

  shutdown(): void {
    if (this.logFlushTimer !== null) {
      clearTimeout(this.logFlushTimer);
      this.logFlushTimer = null;
    }
    this.flushLogBuffer();

    for (const [key, processState] of this.serviceProcesses) {
      terminateProcessTree(processState.child);
      this.serviceProcesses.delete(key);
    }

    for (const [projectId, processState] of this.buildProcesses) {
      processState.stopRequested = true;
      terminateProcessTree(processState.child);
      this.buildProcesses.delete(projectId);
    }

    for (const tail of this.tailStates.values()) {
      clearInterval(tail.timer);
    }
    this.tailStates.clear();

    for (const timer of this.statusTimers.values()) {
      clearInterval(timer);
    }
    this.statusTimers.clear();
  }

  getShutdownEntries(): ShutdownEntry[] {
    const projects = this.getProjects();
    return [...this.serviceProcesses.keys()].map((key) => {
      const colonIdx = key.indexOf(":");
      const projectId = key.slice(0, colonIdx);
      const service = key.slice(colonIdx + 1) as ServiceName;
      const project = projects.find((p) => p.id === projectId);
      return { projectId, service, projectName: project?.name ?? projectId };
    });
  }

  async shutdownWithProgress(
    onServiceStopped: (projectId: string, service: ServiceName) => void,
  ): Promise<void> {
    for (const timer of this.statusTimers.values()) clearInterval(timer);
    this.statusTimers.clear();
    for (const tail of this.tailStates.values()) clearInterval(tail.timer);
    this.tailStates.clear();

    for (const [, processState] of this.buildProcesses) {
      processState.stopRequested = true;
      await terminateProcessTreeAsync(processState.child);
    }
    this.buildProcesses.clear();

    const entries = [...this.serviceProcesses.entries()];
    await Promise.all(
      entries.map(async ([key, processState]) => {
        await terminateProcessTreeAsync(processState.child);
        this.serviceProcesses.delete(key);
        const colonIdx = key.indexOf(":");
        const projectId = key.slice(0, colonIdx);
        const service = key.slice(colonIdx + 1) as ServiceName;
        onServiceStopped(projectId, service);
      }),
    );
  }

  updateProject(projectId: string, name: string, code: string): ProjectRecord {
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    const errors = validateProjectIdentity(trimmedName, trimmedCode);
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }

    this.db
      .prepare("UPDATE projects SET name = ?, code = ? WHERE id = ?")
      .run(trimmedName, trimmedCode, projectId);
    return { id: projectId, name: trimmedName, code: trimmedCode };
  }

  createProject(name: string, code: string): ProjectRecord {
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    const errors = validateProjectIdentity(trimmedName, trimmedCode);
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }

    const projectCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM projects")
      .get() as { count: number };
    if (projectCount.count >= MAX_PROJECTS) {
      throw new Error(
        `Project limit reached. You can create up to ${MAX_PROJECTS} projects.`,
      );
    }

    const id = this.nextProjectId(trimmedName, trimmedCode);
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO projects (id, name, code, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, trimmedName, trimmedCode, now);
    this.writeProjectConfig(id, this.defaultSettings(id));
    this.insertActivity(
      id,
      "Project created",
      trimmedName,
      "success",
      "system",
    );
    return { id, name: trimmedName, code: trimmedCode };
  }

  validateProjectSettings(
    _projectId: string,
    name: string,
    code: string,
    settings: ProjectSettingsRecord,
  ): string[] {
    const errors = validateProjectIdentity(name.trim(), code.trim());
    const appLogFile = settings.appLogFile.trim();
    const frontend = settings.services.frontend;
    const wildfly = settings.services.wildfly;
    const frontendDirectory = frontend.workingDirectory.trim();
    const wildflyDirectory = wildfly.workingDirectory.trim();
    const gitProjectDirectory = settings.gitProjectDirectory.trim();

    if (!appLogFile) {
      errors.push("Application log file is required");
    } else if (!isExistingFile(appLogFile)) {
      errors.push(`Application log file does not exist: ${appLogFile}`);
    }

    if (frontendDirectory) {
      if (!isExistingDirectory(frontendDirectory)) {
        errors.push(`Frontend directory does not exist: ${frontendDirectory}`);
      }
      if (!frontend.command.trim()) {
        errors.push("Frontend command is required");
      }
      if (!frontend.healthUrl.trim()) {
        errors.push("Frontend health URL is required");
      }
      if (!frontend.appUrl?.trim()) {
        errors.push("Frontend app URL is required");
      }
    }

    if (wildflyDirectory) {
      if (!isExistingDirectory(wildflyDirectory)) {
        errors.push(
          `WildFly bin directory does not exist: ${wildflyDirectory}`,
        );
      }
      if (!wildfly.command.trim()) {
        errors.push("WildFly start command is required");
      }
      if (!wildfly.healthUrl.trim()) {
        errors.push("WildFly health URL is required");
      }
      errors.push(...validateMavenConfig(settings.maven));
    }

    if (!gitProjectDirectory) {
      errors.push("Git project directory is required");
    } else if (!isExistingDirectory(gitProjectDirectory)) {
      errors.push(
        `Git project directory does not exist: ${gitProjectDirectory}`,
      );
    }

    return errors;
  }

  async deleteProject(projectId: string): Promise<void> {
    // stop any running services
    for (const service of ["frontend", "wildfly"] as ServiceName[]) {
      const key = `${projectId}:${service}`;
      const proc = this.serviceProcesses.get(key);
      if (proc) {
        await terminateProcessTreeAsync(proc.child);
        this.serviceProcesses.delete(key);
      }
      const timer = this.statusTimers.get(key);
      if (timer) {
        clearInterval(timer);
        this.statusTimers.delete(key);
      }
    }
    const build = this.buildProcesses.get(projectId);
    if (build) {
      build.stopRequested = true;
      await terminateProcessTreeAsync(build.child);
      this.buildProcesses.delete(projectId);
    }
    const tail = this.tailStates.get(projectId);
    if (tail) {
      clearInterval(tail.timer);
      this.tailStates.delete(projectId);
    }
    // remove from DB
    this.db
      .prepare("DELETE FROM activity_events WHERE project_id = ?")
      .run(projectId);
    this.db
      .prepare("DELETE FROM build_runs WHERE project_id = ?")
      .run(projectId);
    this.db
      .prepare("DELETE FROM service_status WHERE project_id = ?")
      .run(projectId);
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    // remove config file
    const configDir = join(this.dataRoot, "projects", projectId);
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true, force: true });
    }
    // clear in-memory logs
    for (const channel of ["frontend", "wildfly", "build"] as LogChannel[]) {
      const key = `${projectId}:${channel}`;
      this.logs.delete(key);
      this.logSeqMap.delete(key);
    }
  }

  saveProjectSettings(
    projectId: string,
    settings: ProjectSettingsRecord,
  ): ProjectSettingsRecord {
    const previousSettings = this.getSettings(projectId);
    const activityEntries = settingsActivityEntries(previousSettings, settings);
    this.writeProjectConfig(projectId, settings);
    this.ensureTail(projectId, settings.appLogFile, true);
    this.send({ type: "settings", projectId, settings });
    for (const entry of activityEntries) {
      this.insertActivity(
        projectId,
        entry.title,
        entry.meta,
        entry.tone,
        "system",
      );
    }
    return settings;
  }

  async serviceAction(
    projectId: string,
    service: ServiceName,
    action: ServiceAction,
  ): Promise<ServiceStatusRecord> {
    if (action === "restart") {
      this.clearLog(projectId, service);
      await this.stopService(projectId, service);
      return this.startService(projectId, service);
    }

    if (action === "stop") {
      return this.stopService(projectId, service);
    }

    return this.startService(projectId, service);
  }

  async runBuild(
    projectId: string,
    profileId: string,
  ): Promise<RecentBuildRecord> {
    const activeBuild = this.buildProcesses.get(projectId);
    if (activeBuild && activeBuild.child.exitCode === null) {
      const existingBuild = this.getRecentBuilds(projectId).find(
        (item) => item.id === `#${activeBuild.rowId}`,
      );
      if (existingBuild) {
        return existingBuild;
      }
      throw new Error("A build is already running for this project.");
    }

    const settings = this.getSettings(projectId);
    const profile = settings.buildProfiles.find(
      (item) => item.id === profileId,
    );
    if (!profile) {
      throw new Error(`Unknown build profile: ${profileId}`);
    }

    const startedAt = new Date();
    const git = this.getGitStatus(projectId);
    const commitCleanliness = buildCleanlinessFromGitStatus(git);
    const environment = environmentFromProfile(profile.profileName);
    const commandText = composeMavenCommand(settings, profile);

    this.clearLog(projectId, "build");
    this.appendLog(projectId, "build", stamp(`$ ${commandText}`));
    const insert = this.db
      .prepare(
        `INSERT INTO build_runs (
          project_id, profile_name, button_name, branch, commit_hash, commit_cleanliness,
          environment, triggered_by, status, outcome_type, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        projectId,
        profile.profileName,
        profile.buttonName,
        git.branch,
        git.commit,
        commitCleanliness,
        environment,
        userInfo().username || "local-user",
        "running",
        profile.outcomeType,
        startedAt.toISOString(),
      );
    const rowId = Number(insert.lastInsertRowid);
    this.insertActivity(
      projectId,
      `${profile.buttonName} build started`,
      `${git.branch} @ ${git.commit}/${commitCleanliness}`,
      "accent",
      "build",
    );
    this.pruneBuilds(projectId);
    this.sendBuilds(projectId);

    const result = await this.spawnBuild(projectId, settings, profile, rowId);
    const completedAt = new Date();
    const durationSeconds = Math.max(
      0,
      Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
    );

    this.db
      .prepare(
        `UPDATE build_runs
         SET status = ?, completed_at = ?, duration_seconds = ?
         WHERE id = ?`,
      )
      .run(result, completedAt.toISOString(), durationSeconds, rowId);

    const successTitle =
      profile.outcomeType === "build-and-deploy"
        ? `${profile.buttonName} build deployed`
        : `${profile.buttonName} build completed`;
    const title =
      result === "success"
        ? successTitle
        : result === "stopped"
          ? `${profile.buttonName} build stopped`
          : `${profile.buttonName} build failed`;
    const statusLabel =
      result === "success"
        ? "Success"
        : result === "stopped"
          ? "Stopped"
          : "Failed";
    this.insertActivity(
      projectId,
      title,
      `Build #${rowId} - ${statusLabel}`,
      result === "success" ? "success" : "error",
      "build",
    );
    this.pruneBuilds(projectId);
    this.sendBuilds(projectId);
    void this.refreshStatus(projectId);

    const build = this.getRecentBuilds(projectId).find(
      (item) => item.id === `#${rowId}`,
    );
    if (!build) {
      throw new Error(
        "Build completed but could not be read from the database.",
      );
    }
    return build;
  }

  async stopBuild(projectId: string): Promise<RecentBuildRecord | null> {
    const activeBuild = this.buildProcesses.get(projectId);
    if (!activeBuild || activeBuild.child.exitCode !== null) {
      return this.getRecentBuilds(projectId)[0] ?? null;
    }

    activeBuild.stopRequested = true;
    this.appendLog(projectId, "build", stamp("Stop build requested"));
    this.flushLogBuffer();
    terminateProcessTree(activeBuild.child);
    this.sendBuilds(projectId);
    return (
      this.getRecentBuilds(projectId).find(
        (item) => item.id === `#${activeBuild.rowId}`,
      ) ?? null
    );
  }

  getBuilds(
    projectId: string,
    options: BuildQueryOptions = {},
  ): BuildQueryResult {
    this.pruneBuilds(projectId);
    return this.queryBuilds(projectId, options);
  }

  async refreshStatus(projectId: string): Promise<ServiceStatusRecord[]> {
    const settings = this.getSettings(projectId);
    const statuses = await Promise.all(
      (["frontend", "wildfly"] as ServiceName[]).map(async (service) => {
        const config = settings.services[service];
        const processKey = serviceProcessKey(projectId, service);
        const runningProcess = this.serviceProcesses.get(processKey);
        const explicitlyStopped =
          this.explicitlyStoppedServices.has(processKey);

        if (explicitlyStopped) {
          const status = this.statusRecord(
            service,
            "stopped",
            "Stopped",
            config.healthUrl,
          );
          this.upsertStatus(projectId, status);
          return status;
        }

        if (runningProcess?.stopRequested) {
          const status = this.statusRecord(
            service,
            "stopping",
            "Stopping",
            config.healthUrl,
            runningProcess.startedAt,
          );
          this.upsertStatus(projectId, status);
          return status;
        }

        if (!config.healthUrl) {
          const status =
            runningProcess && hasRecentServiceStartupSignal(runningProcess)
              ? this.statusRecord(
                  service,
                  "starting",
                  "Startup output detected",
                  config.healthUrl,
                  runningProcess.startedAt,
                )
              : this.statusFromProcess(
                  projectId,
                  service,
                  runningProcess,
                  "No health URL configured",
                );
          this.upsertStatus(projectId, status);
          return status;
        }

        const health = await checkUrl(config.healthUrl);
        const reachable =
          health.ok || (service === "wildfly" && health.reachable);
        const wildflyReadyByLog =
          service === "wildfly" && Boolean(runningProcess?.readyLogAt);
        const canReportRunning =
          service === "wildfly"
            ? wildflyReadyByLog || (!runningProcess && reachable)
            : reachable;
        const previousStatus = this.getStoredStatus(projectId, service);
        const startedAt =
          runningProcess?.startedAt ||
          normalizeOptionalDate(previousStatus?.startedAt);
        const startupLogActive = runningProcess
          ? hasRecentServiceStartupSignal(runningProcess)
          : false;
        const stillStarting =
          Boolean(runningProcess) &&
          (startupLogActive ||
            (previousStatus?.state === "starting" &&
              Boolean(startedAt) &&
              Date.now() - new Date(startedAt as string).getTime() <
                SERVICE_STARTING_GRACE_MS));
        const status: ServiceStatusRecord = {
          service,
          state: canReportRunning
            ? "running"
            : stillStarting
              ? "starting"
              : runningProcess
                ? "error"
                : "stopped",
          message:
            service === "wildfly" && reachable && !canReportRunning
              ? `Waiting for "${WILDFLY_READY_LOG_FRAGMENT}"`
              : health.message,
          url: config.healthUrl,
          checkedAt: new Date().toISOString(),
          startedAt: canReportRunning
            ? startedAt || new Date().toISOString()
            : stillStarting
              ? startedAt
              : undefined,
        };
        this.upsertStatus(projectId, status);
        return status;
      }),
    );

    return statuses;
  }

  getGitStatus(projectId: string): GitStatusRecord {
    const settings = this.getSettings(projectId);
    return this.readGitStatus(settings.gitProjectDirectory);
  }

  getLogFilePath(projectId: string, channel: LogChannel): string {
    if (channel === "tail") {
      const appLogFile = this.getSettings(projectId).appLogFile.trim();
      if (appLogFile) {
        return appLogFile;
      }
    }
    const filePath = this.projectLogPath(projectId, channel);
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      writeFileSync(filePath, "", "utf8");
    }
    return filePath;
  }

  async runGitCommand(
    projectId: string,
    args: string,
  ): Promise<GitStatusRecord> {
    const settings = this.getSettings(projectId);
    const repository = settings.gitProjectDirectory;
    const trimmed = args.trim().replace(/^git\s+/, "");
    if (!trimmed) {
      return this.getGitStatus(projectId);
    }

    if (!existsSync(repository)) {
      return {
        repository,
        branch: "unavailable",
        commit: "unavailable",
        status: `Git Project Directory does not exist: ${repository}`,
        lines: [stamp(`Git Project Directory does not exist: ${repository}`)],
      };
    }

    const lines = await spawnCollect("git", splitCommand(trimmed), repository);
    const status = this.readGitStatus(repository);
    return { ...status, lines };
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_settings (
        project_id TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS service_status (
        project_id TEXT NOT NULL,
        service TEXT NOT NULL,
        state TEXT NOT NULL,
        message TEXT NOT NULL,
        url TEXT,
        checked_at TEXT NOT NULL,
        started_at TEXT,
        PRIMARY KEY(project_id, service)
      );

      CREATE TABLE IF NOT EXISTS build_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        button_name TEXT NOT NULL,
        branch TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        commit_cleanliness TEXT NOT NULL DEFAULT 'unknown',
        environment TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        status TEXT NOT NULL,
        outcome_type TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_seconds INTEGER
      );

      CREATE TABLE IF NOT EXISTS activity_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        meta TEXT NOT NULL,
        tone TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    this.patchExistingActivityDatesToYesterday();
    this.ensureBuildRunCleanlinessColumn();
  }

  private ensureBuildRunCleanlinessColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(build_runs)")
      .all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "commit_cleanliness")) {
      this.db.exec(
        "ALTER TABLE build_runs ADD COLUMN commit_cleanliness TEXT NOT NULL DEFAULT 'unknown'",
      );
    }
  }

  private markInterruptedBuilds(): void {
    this.db
      .prepare(
        `UPDATE build_runs
         SET status = 'stopped',
             completed_at = ?,
             duration_seconds = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400 AS INTEGER))
         WHERE status = 'running'`,
      )
      .run(new Date().toISOString(), new Date().toISOString());
  }

  private patchExistingActivityDatesToYesterday(): void {
    const patchKey = "activity-existing-yesterday-v1";
    const applied = this.db
      .prepare("SELECT value FROM app_meta WHERE key = ?")
      .get(patchKey) as { value: string } | undefined;

    if (applied) {
      return;
    }

    this.db
      .prepare(
        `UPDATE activity_events
         SET created_at = datetime(created_at, '-1 day')
         WHERE created_at >= datetime('now', '-1 day')`,
      )
      .run();

    this.db
      .prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)")
      .run(patchKey, new Date().toISOString());
  }

  private getProjects(): ProjectRecord[] {
    return this.db
      .prepare("SELECT id, name, code FROM projects ORDER BY created_at ASC")
      .all() as ProjectRecord[];
  }

  private nextProjectId(name: string, code: string): string {
    const preferred = slugifyProjectId(code) || slugifyProjectId(name);
    const base = preferred || `project-${Date.now()}`;
    let id = base;
    let suffix = 2;
    while (
      this.db.prepare("SELECT 1 FROM projects WHERE id = ?").get(id) !==
      undefined
    ) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    return id;
  }

  private defaultSettings(_projectId: string): ProjectSettingsRecord {
    return {
      appLogFile: "",
      gitProjectDirectory: "",
      defaultBranch: "",
      remote: "",
      services: {
        frontend: {
          workingDirectory: "",
          command: "",
          healthUrl: "",
          appUrl: "",
        },
        wildfly: {
          workingDirectory: "",
          command: "",
          healthUrl: "",
          appUrl: "",
          managementUrl: "",
        },
      },
      maven: {
        executable: "",
        settingsXml: "",
        pomXml: "",
        skipTests: false,
      },
      buildProfiles: [],
    };
  }

  private getSettings(projectId: string): ProjectSettingsRecord {
    const configPath = this.projectConfigPath(projectId);
    if (existsSync(configPath)) {
      try {
        return JSON.parse(
          readFileSync(configPath, "utf8"),
        ) as ProjectSettingsRecord;
      } catch (error) {
        console.error(
          `[settings:${projectId}] Failed to read app.config`,
          error,
        );
      }
    }

    const defaults = this.defaultSettings(projectId);
    this.writeProjectConfig(projectId, defaults);
    return defaults;
  }

  private writeProjectConfig(
    projectId: string,
    settings: ProjectSettingsRecord,
  ): void {
    const configPath = this.projectConfigPath(projectId);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }

  private projectConfigPath(projectId: string): string {
    return join(this.dataRoot, "projects", projectId, "app.config");
  }

  private async startService(
    projectId: string,
    service: ServiceName,
  ): Promise<ServiceStatusRecord> {
    const settings = this.getSettings(projectId);
    const config = settings.services[service];
    const key = serviceProcessKey(projectId, service);
    const existing = this.serviceProcesses.get(key);
    if (existing && existing.child.exitCode === null) {
      const status = this.statusFromProcess(
        projectId,
        service,
        existing,
        "Already running",
      );
      this.upsertStatus(projectId, status);
      return status;
    }

    const runningServiceCount = [...this.serviceProcesses.values()].filter(
      (processState) => processState.child.exitCode === null,
    ).length;
    if (runningServiceCount >= MAX_RUNNING_SERVICES) {
      const status = this.statusRecord(
        service,
        "error",
        RUNNING_SERVER_LIMIT_MESSAGE,
        config.healthUrl,
      );
      this.upsertStatus(projectId, status);
      this.appendLog(projectId, service, stamp(RUNNING_SERVER_LIMIT_MESSAGE));
      return status;
    }

    if (!config.workingDirectory || !existsSync(config.workingDirectory)) {
      const status = this.statusRecord(
        service,
        "error",
        `Working directory does not exist: ${config.workingDirectory}`,
        config.healthUrl,
      );
      this.upsertStatus(projectId, status);
      return status;
    }

    if (!config.command.trim()) {
      const status = this.statusRecord(
        service,
        "error",
        "No command configured",
        config.healthUrl,
      );
      this.upsertStatus(projectId, status);
      return status;
    }

    this.clearLog(projectId, service);
    this.appendLog(projectId, service, stamp(`$ ${config.command}`));
    const child = spawn(config.command, {
      cwd: config.workingDirectory,
      shell: true,
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    const startedAt = new Date().toISOString();
    this.explicitlyStoppedServices.delete(key);
    const serviceProcess: ServiceProcess = { child, startedAt };
    this.serviceProcesses.set(key, serviceProcess);

    child.stdout.on("data", (chunk: Buffer) =>
      this.appendChunk(projectId, service, chunk),
    );
    child.stderr.on("data", (chunk: Buffer) =>
      this.appendChunk(projectId, service, chunk),
    );
    child.on("exit", (code) => {
      if (this.serviceProcesses.get(key) === serviceProcess) {
        this.serviceProcesses.delete(key);
      }
      this.appendLog(
        projectId,
        service,
        stamp(`${service} exited with code ${code ?? "unknown"}`),
      );
      // If stop was explicitly requested, the status was already set to "stopped".
      // Do not override it with "error" from the non-zero exit code.
      if (!serviceProcess.stopRequested) {
        const status = this.statusRecord(
          service,
          code === 0 ? "stopped" : "error",
          `Process exited with code ${code ?? "unknown"}`,
          config.healthUrl,
        );
        this.upsertStatus(projectId, status);
      }
    });

    const status = this.statusRecord(
      service,
      "starting",
      "Process starting",
      config.healthUrl,
      startedAt,
    );
    this.upsertStatus(projectId, status);
    this.insertActivity(
      projectId,
      `${serviceLabel(service)} started`,
      config.command,
      "success",
      "service",
    );
    void this.refreshStatus(projectId);
    return status;
  }

  private async stopService(
    projectId: string,
    service: ServiceName,
  ): Promise<ServiceStatusRecord> {
    const key = serviceProcessKey(projectId, service);
    const running = this.serviceProcesses.get(key);
    const settings = this.getSettings(projectId);
    const config = settings.services[service];

    const stoppingStatus = this.statusRecord(
      service,
      "stopping",
      "Stopping",
      config.healthUrl,
      running?.startedAt,
    );
    this.upsertStatus(projectId, stoppingStatus);

    if (running) {
      // Mark stop as requested so the exit handler does not override the status.
      running.stopRequested = true;
      this.appendLog(projectId, service, stamp("Stop requested"));
      await terminateProcessTreeAsync(running.child);
      if (this.serviceProcesses.get(key) === running) {
        this.serviceProcesses.delete(key);
      }
    } else {
      // Process not tracked (e.g. started before this session).
      // Best-effort: kill by the port advertised in the health URL.
      const port = extractPort(config.healthUrl);
      if (port) {
        killProcessByPort(port);
        this.appendLog(
          projectId,
          service,
          stamp("Stop requested (killed by port)"),
        );
      }
    }

    this.explicitlyStoppedServices.add(key);

    // Always record the activity and update status, regardless of whether the
    // process was tracked in serviceProcesses.
    this.insertActivity(
      projectId,
      `${serviceLabel(service)} stopped`,
      "",
      "neutral",
      "service",
    );

    const status = this.statusRecord(
      service,
      "stopped",
      "Stopped",
      config.healthUrl,
    );
    this.upsertStatus(projectId, status);
    void this.refreshStatus(projectId);
    return status;
  }

  private spawnBuild(
    projectId: string,
    settings: ProjectSettingsRecord,
    profile: BuildProfileRecord,
    rowId: number,
  ): Promise<BuildResult> {
    return new Promise((resolvePromise) => {
      let resolved = false;
      const resolveOnce = (result: BuildResult): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        this.buildProcesses.delete(projectId);
        this.flushLogBuffer();
        resolvePromise(result);
      };
      const executable = settings.maven.executable;
      const pomDir = dirname(settings.maven.pomXml);

      if (!executable || !existsSync(executable)) {
        this.appendLog(
          projectId,
          "build",
          stamp(`Maven executable does not exist: ${executable}`),
        );
        resolveOnce("failed");
        return;
      }

      if (!settings.maven.pomXml || !existsSync(settings.maven.pomXml)) {
        this.appendLog(
          projectId,
          "build",
          stamp(`pom.xml does not exist: ${settings.maven.pomXml}`),
        );
        resolveOnce("failed");
        return;
      }

      if (
        settings.maven.settingsXml &&
        !existsSync(settings.maven.settingsXml)
      ) {
        this.appendLog(
          projectId,
          "build",
          stamp(`settings.xml does not exist: ${settings.maven.settingsXml}`),
        );
        resolveOnce("failed");
        return;
      }

      const args = ["-P", profile.profileName, ...splitCommand(profile.goals)];
      if (settings.maven.settingsXml) {
        args.push("--settings", settings.maven.settingsXml);
      }
      if (settings.maven.skipTests) {
        args.push("-DskipTests");
      }
      args.push("-f", settings.maven.pomXml);

      const isWindowsScript =
        process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable);
      let child: ChildProcessWithoutNullStreams;
      try {
        child = isWindowsScript
          ? spawn(
              process.env.ComSpec ?? "cmd.exe",
              ["/d", "/s", "/c", executable, ...args],
              {
                cwd: existsSync(pomDir) ? pomDir : undefined,
                shell: false,
                windowsHide: true,
              },
            )
          : spawn(executable, args, {
              cwd: existsSync(pomDir) ? pomDir : undefined,
              shell: false,
              windowsHide: true,
            });
      } catch (error) {
        this.appendLog(
          projectId,
          "build",
          stamp(error instanceof Error ? error.message : String(error)),
        );
        resolveOnce("failed");
        return;
      }
      this.buildProcesses.set(projectId, {
        child,
        rowId,
        stopRequested: false,
      });
      child.stdout.on("data", (chunk: Buffer) =>
        this.appendChunk(projectId, "build", chunk, false, true),
      );
      child.stderr.on("data", (chunk: Buffer) =>
        this.appendChunk(projectId, "build", chunk, false, true),
      );
      child.on("error", (error) => {
        this.appendLog(projectId, "build", stamp(error.message));
        resolveOnce("failed");
      });
      child.on("exit", (code) => {
        const stopped = this.buildProcesses.get(projectId)?.stopRequested;
        this.appendLog(
          projectId,
          "build",
          stamp(`Build exited with code ${code ?? "unknown"}`),
        );
        resolveOnce(stopped ? "stopped" : code === 0 ? "success" : "failed");
      });
    });
  }

  private getStatuses(projectId: string): ServiceStatusRecord[] {
    const rows = this.db
      .prepare(
        `SELECT service, state, message, url, checked_at AS checkedAt, started_at AS startedAt
         FROM service_status WHERE project_id = ? ORDER BY service ASC`,
      )
      .all(projectId) as ServiceStatusRecord[];

    if (rows.length > 0) {
      return rows;
    }

    return (["frontend", "wildfly"] as ServiceName[]).map((service) =>
      this.statusRecord(
        service,
        "unknown",
        "Not checked",
        this.getSettings(projectId).services[service].healthUrl,
      ),
    );
  }

  private getStoredStatus(
    projectId: string,
    service: ServiceName,
  ): ServiceStatusRecord | undefined {
    return this.db
      .prepare(
        `SELECT service, state, message, url, checked_at AS checkedAt, started_at AS startedAt
           FROM service_status WHERE project_id = ? AND service = ?`,
      )
      .get(projectId, service) as ServiceStatusRecord | undefined;
  }

  private upsertStatus(projectId: string, status: ServiceStatusRecord): void {
    this.db
      .prepare(
        `INSERT INTO service_status (
          project_id, service, state, message, url, checked_at, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, service)
        DO UPDATE SET
          state = excluded.state,
          message = excluded.message,
          url = excluded.url,
          checked_at = excluded.checked_at,
          started_at = excluded.started_at`,
      )
      .run(
        projectId,
        status.service,
        status.state,
        status.message,
        status.url ?? "",
        status.checkedAt,
        status.startedAt ?? "",
      );
    this.send({ type: "status", projectId, status });
  }

  private statusRecord(
    service: ServiceName,
    state: ServiceState,
    message: string,
    url?: string,
    startedAt?: string,
  ): ServiceStatusRecord {
    return {
      service,
      state,
      message,
      url,
      checkedAt: new Date().toISOString(),
      startedAt,
    };
  }

  private statusFromProcess(
    _projectId: string,
    service: ServiceName,
    processState: ServiceProcess | undefined,
    fallbackMessage: string,
  ): ServiceStatusRecord {
    return this.statusRecord(
      service,
      processState
        ? service === "wildfly" && !processState.readyLogAt
          ? "starting"
          : "running"
        : "unknown",
      processState
        ? service === "wildfly" && !processState.readyLogAt
          ? `Waiting for "${WILDFLY_READY_LOG_FRAGMENT}"`
          : "Process running"
        : fallbackMessage,
      undefined,
      processState?.startedAt,
    );
  }

  private getRecentBuilds(projectId: string): RecentBuildRecord[] {
    this.pruneBuilds(projectId);
    return this.queryBuilds(projectId, { limit: 50 }).builds;
  }

  private queryBuilds(
    projectId: string,
    options: BuildQueryOptions = {},
  ): BuildQueryResult {
    const limit = clampInteger(options.limit, 1, 100, 30);
    const offset = clampInteger(options.offset, 0, 100_000, 0);
    const sortBy = normalizeBuildSortKey(options.sortBy);
    const sortDirection = options.sortDirection === "asc" ? "ASC" : "DESC";
    const whereParts = ["project_id = ?"];
    const params: unknown[] = [projectId];
    const search = options.search?.trim().toLowerCase() ?? "";
    const status = normalizeBuildStatus(options.status);

    if (status) {
      whereParts.push("status = ?");
      params.push(status);
    }

    if (search) {
      whereParts.push(`(
        lower(branch) LIKE ?
        OR lower(commit_hash) LIKE ?
        OR lower(commit_cleanliness) LIKE ?
        OR lower(profile_name) LIKE ?
        OR lower(button_name) LIKE ?
        OR lower(status) LIKE ?
        OR lower(COALESCE(completed_at, started_at)) LIKE ?
        OR CAST(COALESCE(duration_seconds, 0) AS TEXT) LIKE ?
        OR ('#' || id) LIKE ?
      )`);
      const pattern = `%${search}%`;
      params.push(
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
      );
    }

    const whereSql = whereParts.join(" AND ");
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS count FROM build_runs WHERE ${whereSql}`)
        .get(...params) as { count: number }
    ).count;

    const rows = this.db
      .prepare(
        `SELECT * FROM build_runs
         WHERE ${whereSql}
         ORDER BY ${buildOrderExpression(sortBy)} ${sortDirection}, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as BuildRow[];
    const builds = rows.map(formatBuildRow);
    return {
      builds,
      total,
      hasMore: offset + builds.length < total,
    };
  }

  private pruneBuilds(projectId: string): void {
    this.db
      .prepare(
        `DELETE FROM build_runs
         WHERE project_id = ?
           AND status != 'running'
           AND datetime(COALESCE(completed_at, started_at)) < datetime('now', '-7 days')`,
      )
      .run(projectId);
  }

  private getActivity(projectId: string): ActivityRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM activity_events
         WHERE project_id = ?
           AND created_at >= datetime('now', '-7 days')
         ORDER BY created_at DESC, id DESC`,
      )
      .all(projectId) as ActivityRow[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      meta: row.meta,
      tone: row.tone,
      kind: row.kind,
      time: formatTime(row.created_at),
      createdAt: row.created_at,
    }));
  }

  private insertActivity(
    projectId: string,
    title: string,
    meta: string,
    tone: ActivityTone,
    kind: ActivityKind,
  ): void {
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO activity_events
         (project_id, title, meta, tone, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(projectId, title, meta, tone, kind, createdAt);
    // prune records older than 7 days to prevent unbounded growth
    this.db
      .prepare(
        `DELETE FROM activity_events
         WHERE project_id = ?
           AND created_at < datetime('now', '-7 days')`,
      )
      .run(projectId);
    this.send({
      type: "activity",
      projectId,
      activityFeed: this.getActivity(projectId),
    });
  }

  private sendBuilds(projectId: string): void {
    this.send({
      type: "builds",
      projectId,
      builds: this.getRecentBuilds(projectId),
    });
  }

  private getLog(projectId: string, channel: LogChannel): string[] {
    return (this.logs.get(logKey(projectId, channel)) ?? []).map((l) => l.text);
  }

  private clearLog(projectId: string, channel: LogChannel): void {
    if (channel === "tail") {
      this.send({ type: "log-clear", projectId, channel });
      return;
    }
    const key = logKey(projectId, channel);
    this.logs.set(key, []);
    this.logSeqMap.set(key, 0);
    const filePath = this.projectLogPath(projectId, channel);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, "", "utf8");
    this.send({ type: "log-clear", projectId, channel });
  }

  private appendChunk(
    projectId: string,
    channel: LogChannel,
    chunk: Buffer,
    silent = false,
    flushImmediately = false,
  ): void {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim().length > 0) {
        this.observeServiceLogLine(projectId, channel, line);
        this.appendLog(projectId, channel, line, silent);
      }
    }
    if (flushImmediately && !silent) {
      this.flushLogBuffer();
    }
  }

  private appendLog(
    projectId: string,
    channel: LogChannel,
    line: string,
    silent = false,
  ): void {
    const key = logKey(projectId, channel);
    const existingSeq = this.logSeqMap.get(key);
    const nextSeq =
      (existingSeq ?? this.getPersistedLogLineCount(projectId, channel)) + 1;
    this.logSeqMap.set(key, nextSeq);
    const logLine: LogLine = { seq: nextSeq, text: line };
    const existing = this.logs.get(key) ?? [];
    if (existing.length >= LOG_LIMIT) {
      existing.shift();
    }
    existing.push(logLine);
    this.logs.set(key, existing);
    const filePath = this.projectLogPath(projectId, channel);
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${line}\n`, "utf8");
    if (silent) return;
    const bufKey = `${projectId}:${channel}`;
    const buf = this.logBuffer.get(bufKey);
    if (buf) {
      buf.push(logLine);
    } else {
      this.logBuffer.set(bufKey, [logLine]);
    }
    if (this.logFlushTimer === null) {
      this.logFlushTimer = setTimeout(
        () => this.flushLogBuffer(),
        LOG_BATCH_FLUSH_MS,
      );
    }
  }

  private flushLogBuffer(): void {
    this.logFlushTimer = null;
    for (const [bufKey, lines] of this.logBuffer) {
      if (lines.length === 0) continue;
      const colonIdx = bufKey.indexOf(":");
      const projectId = bufKey.slice(0, colonIdx);
      const channel = bufKey.slice(colonIdx + 1) as LogChannel;
      this.send({ type: "log-batch", projectId, channel, lines: [...lines] });
      lines.length = 0;
    }
    this.logBuffer.clear();
  }

  private observeServiceLogLine(
    projectId: string,
    channel: LogChannel,
    line: string,
  ): void {
    if (channel !== "frontend" && channel !== "wildfly") {
      return;
    }

    const processState = this.serviceProcesses.get(
      serviceProcessKey(projectId, channel),
    );

    if (
      channel === "wildfly" &&
      line.includes(WILDFLY_READY_LOG_FRAGMENT) &&
      processState &&
      !processState.stopRequested
    ) {
      processState.readyLogAt = new Date().toISOString();
      const healthUrl = this.getSettings(projectId).services[channel].healthUrl;
      this.upsertStatus(
        projectId,
        this.statusRecord(
          channel,
          "running",
          line.trim(),
          healthUrl,
          processState.startedAt,
        ),
      );
      return;
    }

    if (!isServiceStartupLogLine(channel, line)) {
      return;
    }

    if (processState && !processState.stopRequested) {
      processState.startupLogAt = new Date().toISOString();
      const currentStatus = this.getStoredStatus(projectId, channel);
      if (
        currentStatus?.state !== "running" &&
        currentStatus?.state !== "starting"
      ) {
        const healthUrl =
          this.getSettings(projectId).services[channel].healthUrl;
        this.upsertStatus(
          projectId,
          this.statusRecord(
            channel,
            "starting",
            "Startup output detected",
            healthUrl,
            processState.startedAt,
          ),
        );
      }
    }
  }

  getLogLatest(
    projectId: string,
    channel: LogChannel,
    limit = 400,
  ): LogQueryResult {
    if (channel === "tail") {
      return this.tailLogLatest(projectId, limit);
    }
    const all = this.readPersistedLogLines(projectId, channel);
    const start = Math.max(0, all.length - limit);
    const lines = all
      .slice(start)
      .map((text, index) => ({ seq: start + index + 1, text }));
    return {
      lines: [...lines],
      oldestSeq: lines[0]?.seq ?? null,
      newestSeq: lines[lines.length - 1]?.seq ?? null,
      hasMoreOlder: all.length > lines.length,
    };
  }

  getLogBefore(
    projectId: string,
    channel: LogChannel,
    beforeSeq: number,
    limit = 400,
  ): LogQueryResult {
    if (channel === "tail") {
      return this.tailLogBefore(projectId, beforeSeq, limit);
    }
    const all = this.readPersistedLogLines(projectId, channel);
    const sliceEnd = Math.min(Math.max(beforeSeq - 1, 0), all.length);
    const start = Math.max(0, sliceEnd - limit);
    const lines = all
      .slice(start, sliceEnd)
      .map((text, index) => ({ seq: start + index + 1, text }));
    return {
      lines: [...lines],
      oldestSeq: lines[0]?.seq ?? null,
      newestSeq: lines[lines.length - 1]?.seq ?? null,
      hasMoreOlder: start > 0,
    };
  }

  getLogAround(
    projectId: string,
    channel: LogChannel,
    seq: number,
    limit = 800,
  ): LogQueryResult {
    const all =
      channel === "tail"
        ? this.tailReadCurrentLines(projectId)
        : this.readPersistedLogLines(projectId, channel);
    const safeLimit = clampInteger(limit, 1, 5000, 800);
    const targetIndex = clampInteger(
      seq - 1,
      0,
      Math.max(0, all.length - 1),
      0,
    );
    const before = Math.floor(safeLimit / 2);
    const start = Math.max(0, targetIndex - before);
    const end = Math.min(all.length, start + safeLimit);
    const adjustedStart = Math.max(0, end - safeLimit);
    const lines = all
      .slice(adjustedStart, end)
      .map((text, index) => ({ seq: adjustedStart + index + 1, text }));

    return {
      lines,
      oldestSeq: lines[0]?.seq ?? null,
      newestSeq: lines[lines.length - 1]?.seq ?? null,
      hasMoreOlder: adjustedStart > 0,
    };
  }

  searchLog(
    projectId: string,
    channel: LogChannel,
    term: string,
  ): { matchSeqs: number[]; total: number } {
    const query = term.trim().toLowerCase();
    if (!query) {
      return { matchSeqs: [], total: 0 };
    }

    const lines =
      channel === "tail"
        ? this.tailReadCurrentLines(projectId)
        : this.readPersistedLogLines(projectId, channel);
    const matchSeqs: number[] = [];
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(query)) {
        matchSeqs.push(index + 1);
      }
    });
    return { matchSeqs, total: matchSeqs.length };
  }

  private tailReadLines(filePath: string): string[] {
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
  }

  private readPersistedLogLines(
    projectId: string,
    channel: LogChannel,
  ): string[] {
    const filePath = this.projectLogPath(projectId, channel);
    return this.tailReadLines(filePath);
  }

  private getPersistedLogLineCount(
    projectId: string,
    channel: LogChannel,
  ): number {
    if (channel === "tail") {
      return 0;
    }
    return this.readPersistedLogLines(projectId, channel).length;
  }

  private tailReadCurrentLines(projectId: string): string[] {
    const state = this.tailStates.get(projectId);
    const filePath = state?.path ?? this.getSettings(projectId).appLogFile;
    return filePath.trim() ? this.tailReadLines(filePath) : [];
  }

  private tailLogLatest(projectId: string, limit: number): LogQueryResult {
    const all = this.tailReadCurrentLines(projectId);
    if (all.length === 0)
      return {
        lines: [],
        oldestSeq: null,
        newestSeq: null,
        hasMoreOlder: false,
      };
    const start = Math.max(0, all.length - limit);
    const lines: LogLine[] = all
      .slice(start)
      .map((text, i) => ({ seq: start + i + 1, text }));
    return {
      lines,
      oldestSeq: lines[0]?.seq ?? null,
      newestSeq: lines[lines.length - 1]?.seq ?? null,
      hasMoreOlder: start > 0,
    };
  }

  private tailLogBefore(
    projectId: string,
    beforeSeq: number,
    limit: number,
  ): LogQueryResult {
    const all = this.tailReadCurrentLines(projectId);
    if (all.length === 0)
      return {
        lines: [],
        oldestSeq: null,
        newestSeq: null,
        hasMoreOlder: false,
      };
    const sliceEnd = Math.min(beforeSeq - 1, all.length);
    const start = Math.max(0, sliceEnd - limit);
    const lines: LogLine[] = all
      .slice(start, sliceEnd)
      .map((text, i) => ({ seq: start + i + 1, text }));
    return {
      lines,
      oldestSeq: lines[0]?.seq ?? null,
      newestSeq: lines[lines.length - 1]?.seq ?? null,
      hasMoreOlder: start > 0,
    };
  }

  private projectLogPath(projectId: string, channel: LogChannel): string {
    return join(this.dataRoot, "projects", projectId, "logs", `${channel}.log`);
  }

  private ensureTail(projectId: string, filePath: string, force = false): void {
    const existing = this.tailStates.get(projectId);
    if (existing && !force && existing.path === filePath) {
      if (existsSync(filePath) && statSync(filePath).size < existing.offset) {
        existing.offset = 0;
        existing.lineCount = 0;
        this.send({ type: "log-clear", projectId, channel: "tail" });
      }
      return;
    }

    if (existing) {
      clearInterval(existing.timer);
      this.tailStates.delete(projectId);
    }

    this.send({ type: "log-clear", projectId, channel: "tail" });

    if (!filePath.trim()) {
      return;
    }

    let offset = existsSync(filePath) ? statSync(filePath).size : 0;
    let lineCount = 0;
    if (existsSync(filePath)) {
      lineCount = this.tailReadLines(filePath).length;
    }

    const timer = setInterval(() => {
      try {
        if (!existsSync(filePath)) {
          return;
        }
        const size = statSync(filePath).size;
        if (size < offset) {
          offset = 0;
          lineCount = 0;
          this.send({ type: "log-clear", projectId, channel: "tail" });
        }
        if (size === offset) {
          return;
        }
        const fd = openSync(filePath, "r");
        const length = size - offset;
        const buffer = Buffer.alloc(Math.min(length, 64_000));
        readSync(fd, buffer, 0, buffer.length, offset);
        closeSync(fd);
        offset = size;
        const newLines = buffer
          .toString()
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0);
        if (newLines.length === 0) return;
        const logLines: LogLine[] = newLines.map((text) => ({
          seq: ++lineCount,
          text,
        }));
        const state = this.tailStates.get(projectId);
        if (state) state.lineCount = lineCount;
        this.send({
          type: "log-batch",
          projectId,
          channel: "tail",
          lines: logLines,
        });
      } catch (error) {
        // silently ignore transient read errors
      }
    }, TAIL_INTERVAL_MS);

    this.tailStates.set(projectId, {
      path: filePath,
      offset,
      lineCount,
      timer,
    });
  }

  private ensureStatusPolling(projectId: string): void {
    if (this.statusTimers.has(projectId)) {
      return;
    }

    void this.refreshStatus(projectId);
    const timer = setInterval(() => {
      void this.refreshStatus(projectId);
    }, STATUS_INTERVAL_MS);
    this.statusTimers.set(projectId, timer);
  }

  private readGitStatus(repository: string): GitStatusRecord {
    if (!repository || !existsSync(repository)) {
      return {
        repository,
        branch: "unavailable",
        commit: "unavailable",
        status: repository
          ? `Git Project Directory does not exist: ${repository}`
          : "Git Project Directory is not configured",
        lines: [
          stamp(
            repository
              ? `Git Project Directory does not exist: ${repository}`
              : "Git Project Directory is not configured",
          ),
        ],
      };
    }

    try {
      const branch = spawnSyncText(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        repository,
      );
      const commit = spawnSyncText(
        "git",
        ["rev-parse", "--short", "HEAD"],
        repository,
      );
      const status = spawnSyncText("git", ["status", "--short"], repository);
      const lines = [
        stamp(`Repository: ${repository}`),
        stamp(`Branch: ${branch || "unavailable"}`),
        stamp(`Commit: ${commit || "unavailable"}`),
        ...(status
          ? status.split(/\r?\n/).map((line) => stamp(line))
          : [stamp("Working tree clean")]),
      ];
      return {
        repository,
        branch: branch || "unavailable",
        commit: commit || "unavailable",
        status: status ? "Working tree has changes" : "Clean",
        lines,
      };
    } catch (error) {
      return {
        repository,
        branch: "unavailable",
        commit: "unavailable",
        status: error instanceof Error ? error.message : String(error),
        lines: [stamp(error instanceof Error ? error.message : String(error))],
      };
    }
  }

  private send(event: DashboardEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(CHANNEL_NAME, event);
    }
  }
}

function composeMavenCommand(
  settings: ProjectSettingsRecord,
  profile: BuildProfileRecord,
): string {
  const parts = [
    quote(settings.maven.executable),
    "-P",
    profile.profileName,
    profile.goals,
  ];
  if (settings.maven.settingsXml) {
    parts.push("--settings", quote(settings.maven.settingsXml));
  }
  if (settings.maven.skipTests) {
    parts.push("-DskipTests");
  }
  parts.push("-f", quote(settings.maven.pomXml));
  return parts.join(" ");
}

type UrlCheckResult = {
  ok: boolean;
  reachable: boolean;
  statusCode?: number;
  message: string;
};

function checkUrl(url: string): Promise<UrlCheckResult> {
  return new Promise((resolvePromise) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolvePromise({
        ok: false,
        reachable: false,
        message: `Invalid URL: ${url}`,
      });
      return;
    }

    const client = parsed.protocol === "https:" ? httpsRequest : httpRequest;
    const request = client(
      parsed,
      { method: "GET", timeout: 3000 },
      (response) => {
        response.resume();
        const statusCode = response.statusCode ?? 0;
        const authRequired = statusCode === 401 || statusCode === 403;
        resolvePromise({
          ok: statusCode >= 200 && statusCode < 400,
          reachable: statusCode > 0,
          statusCode,
          message: authRequired
            ? `HTTP ${statusCode} (authentication required)`
            : `HTTP ${statusCode}`,
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("timeout"));
    });
    request.on("error", (error) =>
      resolvePromise({
        ok: false,
        reachable: false,
        message: error.message,
      }),
    );
    request.end();
  });
}

function normalizeOptionalDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : value;
}

function hasRecentServiceStartupSignal(processState: ServiceProcess): boolean {
  if (!processState.startupLogAt) {
    return false;
  }

  const signalTime = new Date(processState.startupLogAt).getTime();
  return (
    !Number.isNaN(signalTime) &&
    Date.now() - signalTime < SERVICE_STARTING_GRACE_MS
  );
}

function isServiceStartupLogLine(service: ServiceName, line: string): boolean {
  const normalized = line.toLowerCase();
  if (
    /\b(starting|startup|initiali[sz](ing|ed)?|booting|deploying|binding|listening)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (service === "frontend") {
    return (
      /\bvite\b/.test(normalized) ||
      /\bready in\b/.test(normalized) ||
      /\blocal:\s*https?:\/\//.test(normalized) ||
      /port \d+ is in use/.test(normalized)
    );
  }

  return (
    /\bwfly[a-z0-9]*\d+/.test(normalized) ||
    /\bwildfly\b/.test(normalized) ||
    /\bjboss\b/.test(normalized)
  );
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeBuildSortKey(
  value: BuildQuerySortKey | undefined,
): BuildQuerySortKey {
  if (
    value === "id" ||
    value === "branch" ||
    value === "commit" ||
    value === "profile" ||
    value === "status" ||
    value === "duration" ||
    value === "completed"
  ) {
    return value;
  }

  return "completed";
}

function buildOrderExpression(sortBy: BuildQuerySortKey): string {
  switch (sortBy) {
    case "id":
      return "id";
    case "branch":
      return "lower(branch)";
    case "commit":
      return "lower(commit_hash)";
    case "profile":
      return "lower(button_name)";
    case "status":
      return "status";
    case "duration":
      return "COALESCE(duration_seconds, 0)";
    case "completed":
      return "datetime(COALESCE(completed_at, started_at))";
  }
}

function normalizeBuildStatus(
  value: BuildQueryOptions["status"],
): string | null {
  if (value === "Running") {
    return "running";
  }
  if (value === "Success") {
    return "success";
  }
  if (value === "Failed") {
    return "failed";
  }
  if (value === "Stopped") {
    return "stopped";
  }
  return null;
}

function formatBuildRow(row: BuildRow): RecentBuildRecord {
  return {
    id: `#${row.id}`,
    branch: row.branch || "unavailable",
    commit: row.commit_hash || "unavailable",
    commitCleanliness: normalizeCommitCleanliness(row.commit_cleanliness),
    profile: row.button_name || row.profile_name,
    status:
      row.status === "success"
        ? "Success"
        : row.status === "failed"
          ? "Failed"
          : row.status === "stopped"
            ? "Stopped"
            : "Running",
    duration:
      row.duration_seconds === null
        ? "Running"
        : formatDuration(row.duration_seconds),
    completed: formatDate(row.completed_at ?? row.started_at),
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    outcomeType: row.outcome_type,
  };
}

function buildCleanlinessFromGitStatus(
  git: GitStatusRecord,
): RecentBuildRecord["commitCleanliness"] {
  if (git.commit === "unavailable" || git.branch === "unavailable") {
    return "unknown";
  }

  return git.status === "Clean" ? "clean" : "dirty";
}

function normalizeCommitCleanliness(
  value: string,
): RecentBuildRecord["commitCleanliness"] {
  if (value === "clean" || value === "dirty") {
    return value;
  }
  return "unknown";
}

function environmentFromProfile(profile: string): string {
  const normalized = profile.toLowerCase();
  if (normalized === "prod" || normalized === "production") {
    return "Production";
  }
  if (normalized === "sit") {
    return "SIT";
  }
  return "Local";
}

function splitCommand(value: string): string[] {
  const matches = value.match(/"([^"]+)"|'([^']+)'|[^\s]+/g) ?? [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ""));
}

function quote(value: string): string {
  return value.includes(" ") ? `"${value}"` : value;
}

function validateProjectIdentity(name: string, code: string): string[] {
  const errors: string[] = [];
  if (!name) {
    errors.push("Project name is required");
  } else if (name.length > 20) {
    errors.push("Project name must be 20 characters or fewer");
  }

  if (!code) {
    errors.push("Project tag is required");
  } else if (code.length > 3) {
    errors.push("Project tag must be 3 characters or fewer");
  }

  return errors;
}

function validateMavenConfig(
  settings: ProjectSettingsRecord["maven"],
): string[] {
  const errors: string[] = [];
  const executable = settings.executable.trim();
  const settingsXml = settings.settingsXml.trim();
  const pomXml = settings.pomXml.trim();

  if (!executable) {
    errors.push("Maven executable is required");
  } else if (!isExistingFile(executable)) {
    errors.push(`Maven executable does not exist: ${executable}`);
  }

  if (!settingsXml) {
    errors.push("Maven settings.xml is required");
  } else if (!isExistingFile(settingsXml)) {
    errors.push(`Maven settings.xml does not exist: ${settingsXml}`);
  }

  if (!pomXml) {
    errors.push("Maven pom.xml is required");
  } else if (!isExistingFile(pomXml)) {
    errors.push(`Maven pom.xml does not exist: ${pomXml}`);
  }

  return errors;
}

function isExistingFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function isExistingDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function slugifyProjectId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function settingsActivityEntries(
  previous: ProjectSettingsRecord,
  next: ProjectSettingsRecord,
): SettingsActivityEntry[] {
  const entries: SettingsActivityEntry[] = [];

  const add = (
    title: string,
    meta: string,
    tone: ActivityTone = "info",
  ): void => {
    entries.push({ title, meta, tone });
  };
  const addIfChanged = (
    before: string | undefined,
    after: string | undefined,
    title: string,
    meta: string,
  ): void => {
    if ((before ?? "") !== (after ?? "")) {
      add(title, meta);
    }
  };

  addIfChanged(
    previous.appLogFile,
    next.appLogFile,
    "Project settings updated",
    "Application log file updated",
  );
  addIfChanged(
    previous.gitProjectDirectory,
    next.gitProjectDirectory,
    "Git settings updated",
    "Git project directory updated",
  );
  addIfChanged(
    previous.defaultBranch,
    next.defaultBranch,
    "Git settings updated",
    "Default branch updated",
  );
  addIfChanged(
    previous.remote,
    next.remote,
    "Git settings updated",
    "Git remote updated",
  );

  addIfChanged(
    previous.maven.executable,
    next.maven.executable,
    "Maven settings updated",
    "Maven executable path updated",
  );
  addIfChanged(
    previous.maven.settingsXml,
    next.maven.settingsXml,
    "Maven settings updated",
    "settings.xml path updated",
  );
  addIfChanged(
    previous.maven.pomXml,
    next.maven.pomXml,
    "Maven settings updated",
    "pom.xml path updated",
  );
  if (previous.maven.skipTests !== next.maven.skipTests) {
    add(
      "Maven settings updated",
      `Skip tests turned ${next.maven.skipTests ? "on" : "off"}`,
    );
  }

  for (const service of ["frontend", "wildfly"] as ServiceName[]) {
    const before = previous.services[service];
    const after = next.services[service];
    const label = serviceLabel(service);
    const title = `${label} settings updated`;

    addIfChanged(
      before.workingDirectory,
      after.workingDirectory,
      title,
      `${label} working directory updated`,
    );
    addIfChanged(
      before.command,
      after.command,
      title,
      `${label} command updated`,
    );
    addIfChanged(
      before.healthUrl,
      after.healthUrl,
      title,
      `${label} health URL updated`,
    );

    if (service === "frontend") {
      addIfChanged(
        before.appUrl,
        after.appUrl,
        title,
        "Frontend app URL updated",
      );
    } else {
      addIfChanged(
        before.appUrl,
        after.appUrl,
        title,
        "WildFly KMU URL updated",
      );
      addIfChanged(
        before.managementUrl,
        after.managementUrl,
        title,
        "WildFly admin console URL updated",
      );
    }

    if ((before.autoStart ?? false) !== (after.autoStart ?? false)) {
      add(
        title,
        `${label} auto start turned ${(after.autoStart ?? false) ? "on" : "off"}`,
      );
    }
  }

  const previousProfiles = new Map(
    previous.buildProfiles.map((profile) => [profile.id, profile]),
  );
  const nextProfiles = new Map(
    next.buildProfiles.map((profile) => [profile.id, profile]),
  );

  for (const profile of next.buildProfiles) {
    const before = previousProfiles.get(profile.id);
    if (!before) {
      add(
        "Build profile added",
        `Profile "${profileDisplayName(profile)}" added`,
        "success",
      );
      continue;
    }

    if (buildProfileChanged(before, profile)) {
      if (
        before.buttonName !== profile.buttonName &&
        profileChangeCount(before, profile) === 1
      ) {
        add(
          "Build profile renamed",
          `Profile "${profileDisplayName(before)}" renamed to "${profileDisplayName(profile)}"`,
        );
      } else {
        add(
          "Build profile updated",
          `Profile "${profileDisplayName(profile)}" updated`,
        );
      }
    }
  }

  for (const profile of previous.buildProfiles) {
    if (!nextProfiles.has(profile.id)) {
      add(
        "Build profile deleted",
        `Profile "${profileDisplayName(profile)}" deleted`,
        "error",
      );
    }
  }

  return entries.length > 0
    ? entries
    : [
        {
          title: "Settings saved",
          meta: "No setting changes detected",
          tone: "neutral",
        },
      ];
}

function profileDisplayName(profile: BuildProfileRecord): string {
  return profile.buttonName.trim() || profile.profileName.trim() || "Unnamed";
}

function buildProfileChanged(
  previous: BuildProfileRecord,
  next: BuildProfileRecord,
): boolean {
  return profileChangeCount(previous, next) > 0;
}

function profileChangeCount(
  previous: BuildProfileRecord,
  next: BuildProfileRecord,
): number {
  return (
    Number(previous.buttonName !== next.buttonName) +
    Number(previous.profileName !== next.profileName) +
    Number(previous.goals !== next.goals) +
    Number(previous.confirm !== next.confirm) +
    Number(previous.outcomeType !== next.outcomeType)
  );
}

function serviceProcessKey(projectId: string, service: ServiceName): string {
  return `${projectId}:${service}`;
}

function logKey(projectId: string, channel: LogChannel): string {
  return `${projectId}:${channel}`;
}

function stamp(message: string): string {
  return `${new Date().toTimeString().slice(0, 8)} ${message}`;
}

function serviceLabel(service: ServiceName): string {
  return service === "wildfly" ? "WildFly" : "Frontend";
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function extractPort(url: string): number | null {
  try {
    const parsed = new URL(url);
    const port = parseInt(parsed.port, 10);
    return isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

function killProcessByPort(port: number): void {
  if (process.platform !== "win32") {
    return;
  }
  const result = spawnSync("cmd", ["/c", `netstat -ano | findstr :${port}`], {
    windowsHide: true,
    encoding: "utf8",
  });
  const output = (result.stdout as unknown as string) ?? "";
  const pids = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    // Format: Proto  Local Address  Foreign Address  State  PID
    if (parts.length >= 5 && parts[1].endsWith(`:${port}`)) {
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) {
        pids.add(pid);
      }
    }
  }
  for (const pid of pids) {
    spawnSync("taskkill", ["/pid", pid, "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }

  child.kill("SIGTERM");
}

function terminateProcessTreeAsync(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    if (process.platform === "win32" && child.pid) {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/T", "/F"],
        {
          windowsHide: true,
          stdio: "ignore",
        },
      );
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    } else {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    }
  });
}

function spawnCollect(
  command: string,
  args: string[],
  cwd: string,
): Promise<string[]> {
  return new Promise((resolvePromise) => {
    const lines: string[] = [stamp(`$ ${command} ${args.join(" ")}`)];
    const child = spawn(command, args, { cwd, windowsHide: true });
    child.stdout.on("data", (chunk: Buffer) => {
      lines.push(...chunk.toString().split(/\r?\n/).filter(Boolean).map(stamp));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      lines.push(...chunk.toString().split(/\r?\n/).filter(Boolean).map(stamp));
    });
    child.on("error", (error) => {
      lines.push(stamp(error.message));
      resolvePromise(lines);
    });
    child.on("exit", (code) => {
      lines.push(stamp(`git exited with code ${code ?? "unknown"}`));
      resolvePromise(lines);
    });
  });
}

function spawnSyncText(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  return result.stdout.trim();
}
