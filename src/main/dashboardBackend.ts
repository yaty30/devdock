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
import { dirname, join, resolve } from "node:path";
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
  ProjectRuntimeState,
  ProjectSettingsRecord,
  RecentBuildRecord,
  ServiceAction,
  ServiceName,
  ServiceState,
  ServiceStatusRecord,
  ShutdownEntry,
} from "../shared/dashboardTypes";

type ServiceProcess = {
  child: ChildProcessWithoutNullStreams;
  startedAt: string;
  startupLogAt?: string;
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
  timer: NodeJS.Timeout;
};

type BuildRow = {
  id: number;
  project_id: string;
  profile_name: string;
  button_name: string;
  branch: string;
  commit_hash: string;
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

const LOG_LIMIT = 5000;
const LOG_BATCH_FLUSH_MS = 50;
const STATUS_INTERVAL_MS = 5000;
const TAIL_INTERVAL_MS = 1000;
const SERVICE_STARTING_GRACE_MS = 5 * 60 * 1000;

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
    this.seedDefaults();
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
        tail: this.getLog(projectId, "tail"),
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
    for (const channel of [
      "frontend",
      "wildfly",
      "build",
      "tail",
    ] as LogChannel[]) {
      const key = `${projectId}:${channel}`;
      this.logs.delete(key);
      this.logSeqMap.delete(key);
    }
  }

  saveProjectSettings(
    projectId: string,
    settings: ProjectSettingsRecord,
  ): ProjectSettingsRecord {
    this.writeProjectConfig(projectId, settings);
    this.ensureTail(projectId, settings.appLogFile, true);
    this.send({ type: "settings", projectId, settings });
    this.insertActivity(
      projectId,
      "Settings saved",
      "Project configuration updated",
      "neutral",
      "system",
    );
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
    const environment = environmentFromProfile(profile.profileName);
    const commandText = composeMavenCommand(settings, profile);

    this.clearLog(projectId, "build");
    this.appendLog(projectId, "build", stamp(`$ ${commandText}`));
    const insert = this.db
      .prepare(
        `INSERT INTO build_runs (
          project_id, profile_name, button_name, branch, commit_hash,
          environment, triggered_by, status, outcome_type, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        projectId,
        profile.profileName,
        profile.buttonName,
        git.branch,
        git.commit,
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
      `${git.branch} @ ${git.commit}`,
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
          state: reachable
            ? "running"
            : stillStarting
              ? "starting"
              : runningProcess
                ? "error"
                : "stopped",
          message: health.message,
          url: config.healthUrl,
          checkedAt: new Date().toISOString(),
          startedAt: reachable
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

    const result = await spawnCollect("git", splitCommand(trimmed), repository);
    const status = this.readGitStatus(repository);
    const trackedGitAction = describeTrackedGitAction(trimmed);
    if (trackedGitAction) {
      const ok = result.exitCode === 0;
      this.insertActivity(
        projectId,
        `Git ${trackedGitAction} ${ok ? "completed" : "failed"}`,
        gitActivityMeta(trimmed, status, result.exitCode),
        ok ? "accent" : "error",
        "git",
      );
    }
    return { ...status, lines: result.lines };
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

  private seedDefaults(): void {
    const count = this.db
      .prepare("SELECT COUNT(*) AS count FROM projects")
      .get() as { count: number };
    if (count.count > 0) {
      return;
    }

    const now = new Date().toISOString();
    const projects: ProjectRecord[] = [
      { id: "iap", name: "Project IAP", code: "IAP" },
      { id: "ivs-core", name: "Project IVS Core", code: "IVS" },
    ];

    for (const project of projects) {
      this.db
        .prepare(
          "INSERT INTO projects (id, name, code, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(project.id, project.name, project.code, now);
      this.saveProjectSettings(project.id, this.defaultSettings(project.id));
    }
  }

  private defaultSettings(projectId: string): ProjectSettingsRecord {
    const stockNewsFrontend =
      "C:\\Users\\user\\Documents\\Codes\\stock-news\\stock-news-vite";
    const dummyRoot = resolve(this.repoRoot, "dummy");
    const wildflyReal = join(dummyRoot, "wildfly-real");
    const dummyWarPom = join(dummyRoot, "java-war", "pom.xml");
    const dummyMavenSettings = join(dummyRoot, "maven", "settings.xml");
    const localMaven = join(
      this.repoRoot,
      "tools",
      "apache-maven-3.9.15",
      "bin",
      "mvn.cmd",
    );
    const wildflyCommand =
      process.platform === "win32"
        ? "powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\start.ps1"
        : "pwsh -NoProfile -File ./scripts/start.ps1";

    return {
      appLogFile: "",
      gitProjectDirectory: this.repoRoot,
      defaultBranch: "main",
      remote: "origin",
      services: {
        frontend: {
          workingDirectory: existsSync(stockNewsFrontend)
            ? stockNewsFrontend
            : join(dummyRoot, "frontend"),
          command: "npm run dev -- --host 127.0.0.1 --port 5174",
          healthUrl: "http://127.0.0.1:5174/",
          appUrl: "http://127.0.0.1:5174/",
        },
        wildfly: {
          workingDirectory: wildflyReal,
          command: wildflyCommand,
          healthUrl:
            "http://127.0.0.1:9990/management?operation=attribute&name=server-state",
          appUrl: "http://127.0.0.1:8080/",
          managementUrl: "http://127.0.0.1:9990/console",
        },
      },
      maven: {
        executable: existsSync(localMaven)
          ? localMaven
          : "D:\\bd-rvdwp-tools\\apache-maven-3.9.8-bin\\apache-maven-3.9.8\\bin\\mvn.cmd",
        settingsXml: existsSync(dummyMavenSettings)
          ? dummyMavenSettings
          : "D:\\Users\\yipsy1\\Desktop\\Projects\\setting xml\\settings-iap.xml",
        pomXml: existsSync(dummyWarPom)
          ? dummyWarPom
          : "D:\\Users\\yipsy1\\Desktop\\IVS\\IAP\\rvdiap\\pom.xml",
        skipTests: true,
      },
      buildProfiles: [
        {
          id: "local",
          buttonName: "Local",
          profileName: "local",
          goals: "clean install",
          confirm: false,
          outcomeType: "build-only",
        },
        {
          id: "sit",
          buttonName: "SIT",
          profileName: "sit",
          goals: "clean package",
          confirm: false,
          outcomeType: "build-and-deploy",
        },
        {
          id: "prod",
          buttonName: "Production",
          profileName: "prod",
          goals: "clean package",
          confirm: true,
          outcomeType: "build-and-deploy",
        },
      ],
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
              [
                "/d",
                "/s",
                "/c",
                [quote(executable), ...args.map(quote)].join(" "),
              ],
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
      processState ? "running" : "unknown",
      processState ? "Process running" : fallbackMessage,
      undefined,
      processState?.startedAt,
    );
  }

  private getRecentBuilds(projectId: string): RecentBuildRecord[] {
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
    void projectId;
  }

  private getActivity(projectId: string): ActivityRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM activity_events
         WHERE project_id = ?
           AND created_at >= datetime('now', '-2 days')
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
    // prune records older than 2 days to prevent unbounded growth
    this.db
      .prepare(
        `DELETE FROM activity_events
         WHERE project_id = ?
           AND created_at < datetime('now', '-2 days')`,
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
    const nextSeq = (this.logSeqMap.get(key) ?? 0) + 1;
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

    if (!isServiceStartupLogLine(channel, line)) {
      return;
    }

    const processState = this.serviceProcesses.get(
      serviceProcessKey(projectId, channel),
    );
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
    const all = this.logs.get(logKey(projectId, channel)) ?? [];
    const lines = all.slice(-limit);
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
    const all = this.logs.get(logKey(projectId, channel)) ?? [];
    const beforeIdx = all.findIndex((l) => l.seq >= beforeSeq);
    const sliceEnd = beforeIdx === -1 ? all.length : beforeIdx;
    const lines = all.slice(Math.max(0, sliceEnd - limit), sliceEnd);
    return {
      lines: [...lines],
      oldestSeq: lines[0]?.seq ?? null,
      newestSeq: lines[lines.length - 1]?.seq ?? null,
      hasMoreOlder: sliceEnd - limit > 0,
    };
  }

  private projectLogPath(projectId: string, channel: LogChannel): string {
    return join(this.dataRoot, "projects", projectId, "logs", `${channel}.log`);
  }

  private ensureTail(projectId: string, filePath: string, force = false): void {
    const existing = this.tailStates.get(projectId);
    if (existing && !force && existing.path === filePath) {
      return;
    }

    if (existing) {
      clearInterval(existing.timer);
      this.tailStates.delete(projectId);
    }

    this.clearLog(projectId, "tail");
    if (!filePath.trim()) {
      this.appendLog(
        projectId,
        "tail",
        stamp("No Application Log File configured"),
      );
      return;
    }

    let offset = 0;
    if (existsSync(filePath)) {
      const stat = statSync(filePath);
      const startAt = Math.max(0, stat.size - 2_000_000);
      if (stat.size > startAt) {
        const fd = openSync(filePath, "r");
        const len = stat.size - startAt;
        const buf = Buffer.alloc(len);
        readSync(fd, buf, 0, len, startAt);
        closeSync(fd);
        // silent=true: lines already delivered in getProjectState snapshot
        this.appendChunk(projectId, "tail", buf, true);
      }
      offset = stat.size;
    } else {
      this.appendLog(
        projectId,
        "tail",
        stamp(`Waiting for log file: ${filePath}`),
      );
    }

    const timer = setInterval(() => {
      try {
        if (!existsSync(filePath)) {
          return;
        }
        const size = statSync(filePath).size;
        if (size < offset) {
          offset = 0;
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
        this.appendChunk(projectId, "tail", buffer);
      } catch (error) {
        this.appendLog(
          projectId,
          "tail",
          stamp(error instanceof Error ? error.message : String(error)),
        );
      }
    }, TAIL_INTERVAL_MS);

    this.tailStates.set(projectId, { path: filePath, offset, timer });
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

type CommandResult = {
  lines: string[];
  exitCode: number | null;
};

function spawnCollect(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
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
      resolvePromise({ lines, exitCode: null });
    });
    child.on("exit", (code) => {
      lines.push(stamp(`git exited with code ${code ?? "unknown"}`));
      resolvePromise({ lines, exitCode: code });
    });
  });
}

function describeTrackedGitAction(args: string): string | null {
  const parts = splitCommand(args);
  const command = parts.find((part) => !part.startsWith("-"))?.toLowerCase();
  if (!command) {
    return null;
  }

  if (
    command === "commit" ||
    command === "push" ||
    command === "pull" ||
    command === "fetch" ||
    command === "merge" ||
    command === "rebase" ||
    command === "checkout" ||
    command === "switch" ||
    command === "reset" ||
    command === "revert" ||
    command === "cherry-pick"
  ) {
    return command;
  }

  if (command === "stash") {
    const subcommand = parts
      .slice(parts.indexOf(command) + 1)
      .find((part) => !part.startsWith("-"))
      ?.toLowerCase();
    return subcommand && subcommand !== "list" && subcommand !== "show"
      ? "stash"
      : null;
  }

  return null;
}

function gitActivityMeta(
  args: string,
  status: GitStatusRecord,
  exitCode: number | null,
): string {
  const branch = status.branch || "unavailable";
  const commit = status.commit || "unavailable";
  const exit = exitCode === null ? "unknown" : String(exitCode);
  return `${branch} @ ${commit} - git ${args} exited ${exit}`;
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
