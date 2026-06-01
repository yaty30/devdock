import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChefHat,
  ChevronUp,
  Grid3X3,
  List,
  Minimize2,
  Moon,
  Package,
  PackageCheck,
  Plus,
  Send,
  Sun,
} from "lucide-react";
import { AddProjectDialog } from "./components/dialogs/AddProjectDialog";
import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { Modal } from "./components/dialogs/Modal";
import { AppHeader } from "./components/layout/AppHeader";
import {
  FontSizeDropdown,
  HeaderActions,
  HeaderUtilityActions,
} from "./components/layout/HeaderActions";
import { Sidebar } from "./components/layout/Sidebar";
import {
  DatabaseConnectionModal,
  DatabaseWorkspace,
  DatabaseWorkspaceTabs,
} from "./features/databases";
import { ProjectEnvFilesModal } from "./features/env/ProjectEnvFilesModal";
import {
  DashboardContent,
  ProjectDashboardContent,
} from "./features/dashboard/DashboardContent";
import { GitTerminalTab } from "./features/git/GitTerminalTab";
import { MonitorTab } from "./features/monitor/MonitorTab";
import { NotesTab, type NotesView } from "./features/notes/NotesTab";
import { SettingsContent } from "./features/settings/SettingsContent";
import {
  ApiTesterCookieButton,
  ApiTesterCookieModal,
  type ApiTesterDraftState,
  ApiTesterMockup,
} from "./features/tools/ApiTesterMockup";
import { CompareTool } from "./features/tools/CompareTool";
import {
  CryptographicTool,
  CryptographicToolTab,
} from "./features/tools/ConversionTools";
import {
  readStoredSelectedSshServerId,
  readStoredSshServers,
  getSshEndpoint,
  getSshHost,
  getSshUsername,
  hasValidSshCredential,
  isValidSshServerCredential,
  SshHeaderActions,
  SshHeaderTabs,
  SshSettingsModal,
  SshTool,
  storeSelectedSshServerId,
  storeSshServers,
  type SshConnectionStatus,
  type SshActiveHostContext,
  type SshServerConfig,
  type SshToolTab,
} from "./features/tools/SshTool";
import { ChatFeature } from "./features/chat/ChatDrawer";
import { appendLiveBatch, clearViewport } from "./hooks/useLogStore";
import splashIcon from "./assets/icon.png";
import { MAX_PROJECTS } from "../../shared/appLimits";
import { isProjectFrontendEnabled } from "../../shared/projectFrontend";
import type {
  AppSection,
  BackendType,
  DashboardTab,
  DashboardEvent,
  DatabaseConnection,
  DatabaseExecutionRecord,
  DatabaseWorkspaceTab,
  FontSizeMode,
  LogChannel,
  Project,
  ProjectDashboardSummary,
  ProjectRecord,
  ProjectRuntimeState,
  PythonServerType,
  RecentBuildRecord,
  ServiceStatusRecord,
  ShutdownEntry,
  Theme,
  ToolId,
} from "./types";

const SPLASH_READY_FRAME_MS = 800;
const SPLASH_EXIT_HOLD_MS = 800;
const SPLASH_FADE_OUT_MS = 420;
const SPLASH_LOGO_SIZE = "min(66px, 7vw)";
const INITIAL_STATE_LOAD_TIMEOUT_MS = 10000;
const PROJECT_STATE_LOAD_TIMEOUT_MS = 8000;
const DATABASE_IDLE_DISCONNECT_MS = 2 * 60 * 1000;
const PROJECT_DASHBOARD_EXIT_LOG_CHANNELS: LogChannel[] = [
  "frontend",
  "build",
  "wildfly",
  "python",
];
const STANDALONE_NOTEBOOK_PROJECT_ID = "__ivs_standalone_notebook__";

type SplashPhase = "visible" | "exiting" | "hidden";
type SnackbarState = {
  message: string;
  tone: "valid" | "invalid" | "warning";
};
type BuildMiniPanelItem = {
  project: ProjectRecord;
  build: RecentBuildRecord;
  debug?: boolean;
};
type DatabaseRuntimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "sleeping"
  | "disconnected"
  | "reconnecting"
  | "error";
type ApiTesterView = "test" | "history" | "saved";
type CompareView = "compare";
type AccentColor =
  | "blue"
  | "green"
  | "yellow"
  | "orange"
  | "purple"
  | "pink"
  | "black";

const ACCENT_OPTIONS: ReadonlyArray<{ value: AccentColor; label: string }> = [
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "yellow", label: "Yellow" },
  { value: "orange", label: "Orange" },
  { value: "purple", label: "Purple" },
  { value: "pink", label: "Pink" },
  { value: "black", label: "Black" },
];

function findSshProfileForTerminalHost(
  context: SshActiveHostContext,
  servers: SshServerConfig[],
  selectedServer: SshServerConfig | null,
  allowSelectedFallback: boolean,
): SshServerConfig | null {
  const host = normalizeTerminalHost(context.host);
  const username = context.username.trim().toLowerCase();
  const exact = servers.find((server) => {
    const serverHost = normalizeTerminalHost(getSshHost(server));
    const serverUser = getSshUsername(server).toLowerCase();
    return serverHost === host && (!username || serverUser === username);
  });
  if (exact) {
    return exact;
  }
  if (allowSelectedFallback && selectedServer) {
    const selectedUser = getSshUsername(selectedServer).toLowerCase();
    if (!username || selectedUser === username) {
      return selectedServer;
    }
  }
  return null;
}

function normalizeTerminalHost(value: string): string {
  const trimmed = value
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  const colonIndex = trimmed.lastIndexOf(":");
  if (colonIndex > 0 && /^\d+$/.test(trimmed.slice(colonIndex + 1))) {
    return trimmed.slice(0, colonIndex);
  }
  return trimmed;
}

function getTerminalHostProfileKey(context: SshActiveHostContext): string {
  return `${context.username.trim().toLowerCase()}@${normalizeTerminalHost(
    context.host,
  )}`;
}

function getTerminalHostDirectorySessionId(
  context: SshActiveHostContext,
  jumpProfile: SshServerConfig,
): string {
  return `${jumpProfile.id}->${getTerminalHostProfileKey(context)}`;
}

function isSameTerminalHostAndProfile(
  context: SshActiveHostContext,
  profile: SshServerConfig,
): boolean {
  const contextHost = normalizeTerminalHost(context.host);
  const profileHost = normalizeTerminalHost(getSshHost(profile));
  const contextUser = context.username.trim().toLowerCase();
  const profileUser = getSshUsername(profile).toLowerCase();
  return (
    contextHost === profileHost && (!contextUser || contextUser === profileUser)
  );
}

function resolveTerminalDirectoryCwd(
  terminalCwd: string | undefined,
  backendCwd: string | null | undefined,
): string | null {
  const promptCwd = terminalCwd?.trim() ?? "";
  const resolvedBackendCwd = backendCwd?.trim() || null;
  if (!promptCwd || promptCwd === "~") {
    return resolvedBackendCwd;
  }
  if (promptCwd.startsWith("~/")) {
    return resolvedBackendCwd
      ? `${resolvedBackendCwd.replace(/\/+$/, "")}/${promptCwd.slice(2)}`
      : null;
  }
  if (promptCwd.startsWith("/")) {
    return promptCwd;
  }
  return resolvedBackendCwd ?? promptCwd;
}

function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<DashboardTab>("dashboard");
  const [notesView, setNotesView] = useState<NotesView>("grid");
  const [notesAddRequestId, setNotesAddRequestId] = useState(0);
  const [notebookView, setNotebookView] = useState<NotesView>("grid");
  const [notebookAddRequestId, setNotebookAddRequestId] = useState(0);
  const [activeSection, setActiveSection] = useState<AppSection>("dashboard");
  const [activeTool, setActiveTool] = useState<ToolId>("comparing");
  const [apiTesterView, setApiTesterView] = useState<ApiTesterView>("test");
  const [apiTesterDraftStateByScope, setApiTesterDraftStateByScope] = useState<
    Record<string, ApiTesterDraftState>
  >({});
  const [comparingView, setComparingView] = useState<CompareView>("compare");
  const [cryptoActiveTab, setCryptoActiveTab] =
    useState<CryptographicToolTab>("base64");
  const [sshServers, setSshServers] = useState<SshServerConfig[]>(() =>
    readStoredSshServers(),
  );
  const [selectedSshServerId, setSelectedSshServerId] = useState(() =>
    readStoredSelectedSshServerId(sshServers),
  );
  const [sshSettingsOpen, setSshSettingsOpen] = useState(false);
  const [activeSshTab, setActiveSshTab] = useState<SshToolTab>("ssh");
  const [sshConnectionStatus, setSshConnectionStatus] =
    useState<SshConnectionStatus>("idle");
  const [sshReconnectAttempt, setSshReconnectAttempt] = useState(0);
  const [sshTerminalConnectionEnabled, setSshTerminalConnectionEnabled] =
    useState(false);
  const [sshTerminalConnectionSignal, setSshTerminalConnectionSignal] =
    useState(0);
  const [sshActiveSessionId, setSshActiveSessionId] = useState<string | null>(
    null,
  );
  const [sshRemoteCwd, setSshRemoteCwd] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [databaseConnections, setDatabaseConnections] = useState<
    DatabaseConnection[]
  >([]);
  const [databaseConnectionModal, setDatabaseConnectionModal] = useState<
    "add" | "edit" | null
  >(null);
  const [cookieModalOpen, setCookieModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedDatabaseConnectionId, setSelectedDatabaseConnectionId] =
    useState<string | null>(null);
  const [deleteDatabaseConnectionRequest, setDeleteDatabaseConnectionRequest] =
    useState<DatabaseConnection | null>(null);
  const [deletedDatabaseConnectionId, setDeletedDatabaseConnectionId] =
    useState<string | null>(null);
  const [activeDatabaseTab, setActiveDatabaseTab] =
    useState<DatabaseWorkspaceTab>("connection");
  const [databaseExecutionHistory, setDatabaseExecutionHistory] = useState<
    DatabaseExecutionRecord[]
  >([]);
  const [databaseLastRefreshTime, setDatabaseLastRefreshTime] = useState(() =>
    new Date().toISOString(),
  );
  const [databaseRuntimeStatus, setDatabaseRuntimeStatus] =
    useState<DatabaseRuntimeStatus>("idle");
  const [projectState, setProjectState] = useState<ProjectRuntimeState | null>(
    null,
  );
  const [dashboardOverview, setDashboardOverview] = useState<
    ProjectDashboardSummary[]
  >([]);
  const [dashboardOverviewLoading, setDashboardOverviewLoading] =
    useState(true);
  const [projectStateProjectId, setProjectStateProjectId] = useState<
    string | null
  >(null);
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [accentColor, setAccentColor] = useState<AccentColor>(() =>
    readStoredAccentColor(),
  );
  const [fontSizeMode, setFontSizeMode] = useState<FontSizeMode>(() =>
    readStoredFontSizeMode(),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [interfaceSettingsOpen, setInterfaceSettingsOpen] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [envFilesOpen, setEnvFilesOpen] = useState(false);
  const [panelResetVersion, setPanelResetVersion] = useState(0);
  const [projectLoading, setProjectLoading] = useState(true);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const [initialStateLoaded, setInitialStateLoaded] = useState(false);
  const [shutdownEntries, setShutdownEntries] = useState<
    ShutdownEntry[] | null
  >(null);
  const [stoppedServices, setStoppedServices] = useState<Set<string>>(
    new Set(),
  );
  const [splashPhase, setSplashPhase] = useState<SplashPhase>("visible");
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const [snackbarClosing, setSnackbarClosing] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [buildMiniPanelMinimized, setBuildMiniPanelMinimized] = useState(false);
  const [dismissedBuildMiniRecordKeys, setDismissedBuildMiniRecordKeys] =
    useState<Set<string>>(() => new Set());
  const projectLoadingTimerRef = useRef<number | null>(null);
  const projectSwitchStartedAtRef = useRef<number | null>(null);
  const splashSequenceStartedRef = useRef(false);
  const selectedProjectIdRef = useRef<string | null>(null);
  const dashboardOverviewRequestRef = useRef(0);
  const snackbarDismissTimerRef = useRef<number | null>(null);
  const snackbarCloseTimerRef = useRef<number | null>(null);
  const buildMiniPanelBuildIdRef = useRef<string | null>(null);
  const buildMiniPanelSessionStartedAtRef = useRef(Date.now());
  const appExitStartedRef = useRef(false);
  const appShellRef = useRef<HTMLDivElement>(null);
  const sidebarTransitionReadyRef = useRef(false);
  const databaseSleepTimerRef = useRef<number | null>(null);
  const hadDatabaseConnectionRef = useRef(false);
  const selectedDatabaseConnectionIdRef = useRef<string | null>(null);
  const verifyingDatabaseConnectionIdRef = useRef<string | null>(null);
  const sshReconnectTimerRef = useRef<number | null>(null);
  const sshManualDisconnectRef = useRef(false);
  const sshActiveServerIdRef = useRef<string | null>(null);
  const sshActiveSessionIdRef = useRef<string | null>(null);
  const sshAutoLoginAttemptedRef = useRef<string | null>(null);
  const sshCredentialPromptedRef = useRef(false);
  const sshDirectorySyncRequestRef = useRef(0);
  const sshTerminalHostProfileMapRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    selectedDatabaseConnectionIdRef.current = selectedDatabaseConnectionId;
  }, [selectedDatabaseConnectionId]);

  useEffect(() => {
    storeSshServers(sshServers);
    setSelectedSshServerId((current) =>
      sshServers.some((server) => server.id === current)
        ? current
        : (sshServers[0]?.id ?? ""),
    );
  }, [sshServers]);

  useEffect(() => {
    if (selectedSshServerId) {
      storeSelectedSshServerId(selectedSshServerId);
    }
  }, [selectedSshServerId]);

  useEffect(() => {
    sshActiveSessionIdRef.current = sshActiveSessionId;
  }, [sshActiveSessionId]);

  useEffect(() => {
    let cancelled = false;
    void window.ivsDashboard
      .getFeatureFlags()
      .then((flags) => {
        if (!cancelled) {
          setChatEnabled(flags.chatEnabled);
          setDebugEnabled(flags.debugEnabled);
        }
      })
      .catch((error) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (databaseSleepTimerRef.current !== null) {
        window.clearTimeout(databaseSleepTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const hasConnection = Boolean(selectedDatabaseConnectionId);
    if (!hasConnection) {
      hadDatabaseConnectionRef.current = false;
      if (databaseSleepTimerRef.current !== null) {
        window.clearTimeout(databaseSleepTimerRef.current);
        databaseSleepTimerRef.current = null;
      }
      setDatabaseRuntimeStatus("idle");
      return;
    }

    const selectedConnection = databaseConnections.find(
      (connection) => connection.id === selectedDatabaseConnectionId,
    );
    if (
      selectedConnection?.status === "error" &&
      verifyingDatabaseConnectionIdRef.current !== selectedConnection.id
    ) {
      if (databaseSleepTimerRef.current !== null) {
        window.clearTimeout(databaseSleepTimerRef.current);
        databaseSleepTimerRef.current = null;
      }
      setDatabaseRuntimeStatus("error");
      return;
    }
    if (selectedConnection?.status === "disconnected") {
      if (databaseSleepTimerRef.current !== null) {
        window.clearTimeout(databaseSleepTimerRef.current);
        databaseSleepTimerRef.current = null;
      }
      setDatabaseRuntimeStatus("disconnected");
      return;
    }

    if (activeSection === "database") {
      if (databaseSleepTimerRef.current !== null) {
        window.clearTimeout(databaseSleepTimerRef.current);
        databaseSleepTimerRef.current = null;
      }
      setDatabaseRuntimeStatus((current) => {
        if (current === "connected") {
          return current;
        }
        if (current === "sleeping" || current === "disconnected") {
          return "reconnecting";
        }
        return hadDatabaseConnectionRef.current ? "reconnecting" : "connecting";
      });
      return;
    }

    setDatabaseRuntimeStatus((current) =>
      current === "connected" ||
      current === "connecting" ||
      current === "reconnecting"
        ? "sleeping"
        : current,
    );
    if (databaseSleepTimerRef.current !== null) {
      window.clearTimeout(databaseSleepTimerRef.current);
    }
    databaseSleepTimerRef.current = window.setTimeout(() => {
      databaseSleepTimerRef.current = null;
      setDatabaseRuntimeStatus("disconnected");
    }, DATABASE_IDLE_DISCONNECT_MS);
  }, [activeSection, selectedDatabaseConnectionId, databaseConnections]);

  useEffect(() => {
    if (
      activeSection !== "database" ||
      !selectedDatabaseConnectionId ||
      (databaseRuntimeStatus !== "connecting" &&
        databaseRuntimeStatus !== "reconnecting")
    ) {
      return;
    }

    let cancelled = false;
    const connectTimer = window.setTimeout(() => {
      if (!cancelled) {
        hadDatabaseConnectionRef.current = true;
        setDatabaseRuntimeStatus("connected");
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(connectTimer);
    };
  }, [activeSection, selectedDatabaseConnectionId, databaseRuntimeStatus]);

  useEffect(() => {
    let cancelled = false;
    const initialLoadTimeout = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      console.error("[renderer:startup] Initial state load timed out");
      setInitialStateLoaded(true);
      setProjectLoading(false);
      setDashboardOverviewLoading(false);
    }, INITIAL_STATE_LOAD_TIMEOUT_MS);

    async function loadInitialState(): Promise<void> {
      const snapshot = await window.ivsDashboard.getSnapshot();
      const connections = await window.ivsDashboard.getDatabaseConnections();
      const executionHistory =
        await window.ivsDashboard.getDatabaseExecutionHistory();
      if (cancelled) {
        return;
      }
      window.clearTimeout(initialLoadTimeout);
      const hydratedConnections: DatabaseConnection[] = connections.map(
        (connection) => ({
          ...connection,
          status: connection.autoConnect ? "connected" : "disconnected",
        }),
      );
      const autoConnectConnection = hydratedConnections.find(
        (connection) => connection.autoConnect,
      );
      setProjects(snapshot.projects);
      setDatabaseConnections(hydratedConnections);
      setDatabaseExecutionHistory(executionHistory);
      setSelectedDatabaseConnectionId(
        autoConnectConnection?.id ?? hydratedConnections[0]?.id ?? null,
      );
      void refreshDashboardOverview();
      const active =
        snapshot.projects.find(
          (project) => project.id === snapshot.activeProjectId,
        ) ??
        snapshot.projects[0] ??
        null;
      setSelectedProject(active);
      if (active === null) {
        setProjectLoading(false);
      }
      setInitialStateLoaded(true);
    }

    void loadInitialState().catch((error) => {
      console.error(error);
      window.clearTimeout(initialLoadTimeout);
      setInitialStateLoaded(true);
      setProjectLoading(false);
      setDashboardOverviewLoading(false);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(initialLoadTimeout);
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("ivs-dashboard-theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("ivs-dashboard-accent", accentColor);
    document.documentElement.dataset.accent = accentColor;
  }, [accentColor]);

  useEffect(() => {
    window.localStorage.setItem("ivs-dashboard-font-size", fontSizeMode);
    document.documentElement.dataset.fontSize = fontSizeMode;
  }, [fontSizeMode]);

  useEffect(() => {
    if (!sidebarTransitionReadyRef.current) {
      sidebarTransitionReadyRef.current = true;
      return undefined;
    }

    const shell = appShellRef.current;
    if (!shell) {
      return undefined;
    }

    let dispatched = false;
    const dispatchSettledResize = (): void => {
      if (dispatched) {
        return;
      }

      dispatched = true;
      window.dispatchEvent(new Event("resize"));
    };

    const fallbackTimer = window.setTimeout(dispatchSettledResize, 220);
    const handleTransitionEnd = (event: TransitionEvent): void => {
      if (
        event.target === shell &&
        event.propertyName === "grid-template-columns"
      ) {
        window.clearTimeout(fallbackTimer);
        dispatchSettledResize();
      }
    };

    shell.addEventListener("transitionend", handleTransitionEnd);
    return () => {
      window.clearTimeout(fallbackTimer);
      shell.removeEventListener("transitionend", handleTransitionEnd);
    };
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!selectedProject) {
      return undefined;
    }

    selectedProjectIdRef.current = selectedProject.id;
    if (activeSection !== "project") {
      setProjectLoading(false);
      return undefined;
    }

    let cancelled = false;
    const loadingTimeout = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      console.error(
        `[renderer:project] Project state load timed out for ${selectedProject.id}`,
      );
      setProjectLoading(false);
      projectSwitchStartedAtRef.current = null;
    }, PROJECT_STATE_LOAD_TIMEOUT_MS);

    setProjectLoading(true);
    window.ivsDashboard
      .getProjectState(selectedProject.id)
      .then((nextState) => {
        if (!cancelled) {
          window.clearTimeout(loadingTimeout);
          setProjectState(nextState);
          setProjectStateProjectId(selectedProject.id);
          const switchStartedAt = projectSwitchStartedAtRef.current;
          const remainingDelay =
            switchStartedAt === null
              ? 0
              : Math.max(0, 1000 - (Date.now() - switchStartedAt));

          if (projectLoadingTimerRef.current !== null) {
            window.clearTimeout(projectLoadingTimerRef.current);
          }

          projectLoadingTimerRef.current = window.setTimeout(() => {
            setProjectLoading(false);
            projectLoadingTimerRef.current = null;
            projectSwitchStartedAtRef.current = null;
          }, remainingDelay);
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          window.clearTimeout(loadingTimeout);
          setProjectLoading(false);
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(loadingTimeout);
    };
  }, [selectedProject, activeSection]);

  useEffect(() => {
    function clearProjectDashboardForAppExit(): void {
      appExitStartedRef.current = true;
      const projectId = selectedProjectIdRef.current;
      if (projectId) {
        PROJECT_DASHBOARD_EXIT_LOG_CHANNELS.forEach((channel) => {
          clearViewport(projectId, channel);
        });
      }
      setProjectState((current) =>
        current ? { ...current, recentBuilds: [] } : current,
      );
    }

    const unsubscribe = window.ivsDashboard.onEvent((event) => {
      if (event.type === "status") {
        setDashboardOverview((current) =>
          applyDashboardOverviewStatusEvent(current, event),
        );
      }

      if (event.type === "builds" || event.type === "settings") {
        void refreshDashboardOverview();
      }

      if (event.projectId !== selectedProjectIdRef.current) {
        return;
      }
      // Log events go to the log store; they never touch React project state.
      if (event.type === "log-batch") {
        if (appExitStartedRef.current) {
          return;
        }
        appendLiveBatch(event.projectId, event.channel, event.lines);
        return;
      }
      if (event.type === "log-clear") {
        clearViewport(event.projectId, event.channel);
        return;
      }
      setProjectState((current) => applyDashboardEvent(current, event));
    });

    const unsubShutdownStarted = window.ivsDashboard.onShutdownStarted(
      (entries) => {
        setShutdownEntries(entries);
        setStoppedServices(new Set());
      },
    );

    const unsubShutdownStopped = window.ivsDashboard.onShutdownServiceStopped(
      (projectId, service) => {
        setStoppedServices((prev) => {
          const next = new Set(prev);
          next.add(`${projectId}:${service}`);
          return next;
        });
      },
    );

    const unsubAppExit = window.ivsDashboard.onAppExit(
      clearProjectDashboardForAppExit,
    );

    return () => {
      unsubscribe();
      unsubShutdownStarted();
      unsubShutdownStopped();
      unsubAppExit();
      if (projectLoadingTimerRef.current !== null) {
        window.clearTimeout(projectLoadingTimerRef.current);
      }
      if (snackbarDismissTimerRef.current !== null) {
        window.clearTimeout(snackbarDismissTimerRef.current);
      }
      if (snackbarCloseTimerRef.current !== null) {
        window.clearTimeout(snackbarCloseTimerRef.current);
      }
    };
  }, []);

  const activeProjectState =
    projectStateProjectId === selectedProject?.id ? projectState : null;
  const sidebarProjectStatuses = getSidebarProjectStatuses(
    dashboardOverview,
    activeProjectState,
    selectedProject?.id ?? null,
  );
  const sidebarProjectFrontendEnabled = getSidebarProjectFrontendEnabled(
    dashboardOverview,
    activeProjectState,
    selectedProject?.id ?? null,
  );
  const selectedDatabaseConnection =
    databaseConnections.find(
      (connection) => connection.id === selectedDatabaseConnectionId,
    ) ??
    databaseConnections[0] ??
    null;
  const selectedDatabaseExecutionHistory = selectedDatabaseConnection
    ? databaseExecutionHistory.filter(
        (entry) => entry.connectionId === selectedDatabaseConnection.id,
      )
    : [];
  const selectedSshServer =
    sshServers.find((server) => server.id === selectedSshServerId) ??
    sshServers[0] ??
    null;
  const sshHasValidCredential = useMemo(
    () => hasValidSshCredential(sshServers),
    [sshServers],
  );
  const sshSettingsRequired =
    activeSection === "tools" && activeTool === "ssh" && !sshHasValidCredential;

  useEffect(() => {
    if (!sshSettingsRequired) {
      sshCredentialPromptedRef.current = false;
      return;
    }

    if (sshCredentialPromptedRef.current) {
      return;
    }

    sshCredentialPromptedRef.current = true;
    setSshSettingsOpen(true);
  }, [sshSettingsRequired]);

  function saveSshServers(nextServers: SshServerConfig[]): void {
    setSshServers(nextServers);
    const selectedStillExists = nextServers.some(
      (server) => server.id === selectedSshServerId,
    );
    if (!selectedStillExists) {
      clearSshReconnectTimer();
      setSshTerminalConnectionActive(false);
      void disconnectActiveSshSession();
      sshManualDisconnectRef.current = false;
      setSshConnectionStatus("idle");
      setSshReconnectAttempt(0);
      setSshRemoteCwd(null);
      setSelectedSshServerId(nextServers[0]?.id ?? "");
    }
    setSshSettingsOpen(false);
  }

  function closeSshSettings(): void {
    setSshSettingsOpen(false);
  }

  function clearSshReconnectTimer(): void {
    if (sshReconnectTimerRef.current !== null) {
      window.clearTimeout(sshReconnectTimerRef.current);
      sshReconnectTimerRef.current = null;
    }
  }

  function setSshTerminalConnectionActive(active: boolean): void {
    setSshTerminalConnectionEnabled(active);
    setSshTerminalConnectionSignal((current) => current + 1);
  }

  async function disconnectActiveSshSession(): Promise<void> {
    const sessionId = sshActiveSessionIdRef.current;
    sshActiveSessionIdRef.current = null;
    setSshActiveSessionId(null);
    if (!sessionId) {
      return;
    }

    await window.ivsDashboard.sshDisconnect(sessionId).catch((error) => {
      console.error("[ssh:disconnect]", error);
    });
  }

  async function connectSshServer(
    server: SshServerConfig,
    status: SshConnectionStatus,
    currentAttempt: number,
  ): Promise<void> {
    if (!isValidSshServerCredential(server)) {
      return;
    }

    sshActiveServerIdRef.current = server.id;
    clearSshReconnectTimer();
    await disconnectActiveSshSession();
    setSshConnectionStatus(status);

    const result = await window.ivsDashboard
      .sshConnect({
        serverId: server.id,
        name: server.name,
        address: getSshEndpoint(server),
        username: getSshUsername(server),
        password: server.password,
        macs: server.macs,
        ciphers: server.ciphers,
      })
      .catch((error) => ({
        ok: false,
        sessionId: null,
        error:
          error instanceof Error
            ? error.message
            : "SSH backend is not available.",
      }));

    if (sshActiveServerIdRef.current !== server.id) {
      if (result.sessionId) {
        await window.ivsDashboard
          .sshDisconnect(result.sessionId)
          .catch((error) => {
            console.error("[ssh:disconnect-stale]", error);
          });
      }
      return;
    }

    if (result.ok && result.sessionId) {
      sshActiveSessionIdRef.current = result.sessionId;
      setSshActiveSessionId(result.sessionId);
      setSshRemoteCwd(result.cwd ?? null);
      setSshConnectionStatus("connected");
      setSshReconnectAttempt(0);
      return;
    }

    setSshActiveSessionId(null);
    if (shouldRetrySshConnection(server, currentAttempt)) {
      scheduleSshReconnect(server, currentAttempt + 1);
      return;
    }

    setSshConnectionStatus("failed");
  }

  async function syncDirectoryToTerminalHost(
    context: SshActiveHostContext,
  ): Promise<void> {
    const hostProfileKey = getTerminalHostProfileKey(context);
    const mappedProfileId =
      sshTerminalHostProfileMapRef.current.get(hostProfileKey);
    const mappedProfile = mappedProfileId
      ? (sshServers.find((server) => server.id === mappedProfileId) ?? null)
      : null;
    const profile =
      mappedProfile ??
      findSshProfileForTerminalHost(
        context,
        sshServers,
        selectedSshServer,
        sshActiveSessionIdRef.current === null,
      );
    const jumpProfile =
      !profile &&
      selectedSshServer &&
      isValidSshServerCredential(selectedSshServer) &&
      !isSameTerminalHostAndProfile(context, selectedSshServer)
        ? selectedSshServer
        : null;
    if ((!profile || !isValidSshServerCredential(profile)) && !jumpProfile) {
      await disconnectActiveSshSession();
      setSshRemoteCwd(context.cwd ?? null);
      return;
    }
    const targetProfile = profile ?? jumpProfile;
    if (!targetProfile) {
      await disconnectActiveSshSession();
      setSshRemoteCwd(context.cwd ?? null);
      return;
    }
    const directorySessionServerId = profile
      ? targetProfile.id
      : getTerminalHostDirectorySessionId(context, targetProfile);

    if (
      sshActiveServerIdRef.current === directorySessionServerId &&
      sshActiveSessionIdRef.current
    ) {
      if (profile) {
        sshTerminalHostProfileMapRef.current.set(hostProfileKey, profile.id);
      }
      setSshRemoteCwd(resolveTerminalDirectoryCwd(context.cwd, sshRemoteCwd));
      setSshConnectionStatus("connected");
      return;
    }

    const requestId = sshDirectorySyncRequestRef.current + 1;
    sshDirectorySyncRequestRef.current = requestId;
    sshActiveServerIdRef.current = directorySessionServerId;
    await disconnectActiveSshSession();

    const result = await window.ivsDashboard
      .sshConnect({
        serverId: directorySessionServerId,
        name: profile
          ? profile.name
          : `${targetProfile.name} -> ${context.host}`,
        address: profile
          ? getSshEndpoint(targetProfile)
          : `${context.host.trim()}:22`,
        username: profile
          ? getSshUsername(targetProfile)
          : context.username.trim() || getSshUsername(targetProfile),
        password: targetProfile.password,
        macs: targetProfile.macs,
        ciphers: targetProfile.ciphers,
        jump: profile
          ? undefined
          : {
              address: getSshEndpoint(targetProfile),
              username: getSshUsername(targetProfile),
              password: targetProfile.password,
              macs: targetProfile.macs,
              ciphers: targetProfile.ciphers,
            },
      })
      .catch((error) => ({
        ok: false,
        sessionId: null,
        error:
          error instanceof Error
            ? error.message
            : "SSH backend is not available.",
      }));

    if (sshDirectorySyncRequestRef.current !== requestId) {
      if (result.sessionId) {
        await window.ivsDashboard
          .sshDisconnect(result.sessionId)
          .catch((error) =>
            console.error("[ssh:disconnect-stale-directory]", error),
          );
      }
      return;
    }

    if (result.ok && result.sessionId) {
      if (profile) {
        sshTerminalHostProfileMapRef.current.set(hostProfileKey, profile.id);
      }
      sshActiveSessionIdRef.current = result.sessionId;
      setSshActiveSessionId(result.sessionId);
      setSshRemoteCwd(resolveTerminalDirectoryCwd(context.cwd, result.cwd));
      setSshConnectionStatus("connected");
      setSshReconnectAttempt(0);
      return;
    }

    setSshActiveSessionId(null);
    setSshRemoteCwd(resolveTerminalDirectoryCwd(context.cwd, null));
  }

  function handleSshTerminalConnectionStatusChange(
    status: SshConnectionStatus,
  ): void {
    clearSshReconnectTimer();
    if (status === "connecting") {
      sshManualDisconnectRef.current = false;
      setSshReconnectAttempt(0);
      setSshConnectionStatus("connecting");
      return;
    }
    if (status === "connected") {
      setSshConnectionStatus("connected");
      return;
    }
    if (status === "failed" || status === "disconnected") {
      setSshTerminalConnectionActive(false);
      void disconnectActiveSshSession();
      setSshReconnectAttempt(0);
      setSshRemoteCwd(null);
      setSshConnectionStatus(status);
    }
  }

  function handleSshTerminalHostChange(context: SshActiveHostContext): void {
    setSshConnectionStatus("connected");
    void syncDirectoryToTerminalHost(context);
  }

  function shouldRetrySshConnection(
    server: SshServerConfig,
    currentAttempt: number,
  ): boolean {
    return (
      server.autoReconnect &&
      !sshManualDisconnectRef.current &&
      currentAttempt < server.maxReconnectAttempts &&
      isValidSshServerCredential(server) &&
      sshActiveServerIdRef.current === server.id
    );
  }

  function scheduleSshReconnect(
    server: SshServerConfig,
    nextAttempt: number,
  ): void {
    setSshReconnectAttempt(nextAttempt);
    setSshConnectionStatus("reconnecting");
    sshReconnectTimerRef.current = window.setTimeout(() => {
      sshReconnectTimerRef.current = null;
      if (
        sshManualDisconnectRef.current ||
        sshActiveServerIdRef.current !== server.id
      ) {
        return;
      }
      void connectSshServer(server, "reconnecting", nextAttempt);
    }, server.reconnectDelayMs);
  }

  function handleSshConnect(server: SshServerConfig): void {
    sshManualDisconnectRef.current = false;
    setSshTerminalConnectionActive(true);
    setSshReconnectAttempt(0);
    sshActiveServerIdRef.current = server.id;
    void disconnectActiveSshSession();
    setSshRemoteCwd(null);
    setSshConnectionStatus("connecting");
  }

  function handleSshDisconnect(): void {
    sshManualDisconnectRef.current = true;
    clearSshReconnectTimer();
    setSshTerminalConnectionActive(false);
    void disconnectActiveSshSession();
    setSshReconnectAttempt(0);
    setSshRemoteCwd(null);
    setSshConnectionStatus("disconnected");
  }

  function handleSshConnectionToggle(server: SshServerConfig): void {
    if (
      sshConnectionStatus === "connected" ||
      sshConnectionStatus === "connecting" ||
      sshConnectionStatus === "reconnecting"
    ) {
      handleSshDisconnect();
      return;
    }

    handleSshConnect(server);
  }

  async function handleSshCommandSubmit(command: string) {
    const sessionId = sshActiveSessionIdRef.current;
    if (sshConnectionStatus !== "connected" || !sessionId) {
      return {
        stdout: "",
        stderr: "",
        exitCode: null,
        error: "Not connected. Please connect to the SSH server first.",
      };
    }

    try {
      const result = await window.ivsDashboard.sshExec(sessionId, command);
      return result;
    } catch (error) {
      return {
        stdout: "",
        stderr: "",
        exitCode: null,
        error:
          error instanceof Error
            ? error.message
            : "SSH backend is not available.",
      };
    }
  }

  // XtermTerminal now owns the visible SSH login flow. This effect only resets
  // the old guard when leaving the SSH tool so profile changes can start fresh.
  useEffect(() => {
    const onSshTool = activeSection === "tools" && activeTool === "ssh";
    if (!onSshTool) {
      sshAutoLoginAttemptedRef.current = null;
    }
  }, [activeSection, activeTool]);

  // Cancel pending SSH activity when selected server changes.
  useEffect(() => {
    if (
      sshActiveServerIdRef.current !== null &&
      sshActiveServerIdRef.current !== selectedSshServerId
    ) {
      clearSshReconnectTimer();
      setSshTerminalConnectionActive(false);
      void disconnectActiveSshSession();
      sshManualDisconnectRef.current = false;
      setSshConnectionStatus("idle");
      setSshReconnectAttempt(0);
      setSshRemoteCwd(null);
    }
    sshActiveServerIdRef.current = selectedSshServerId || null;
  }, [selectedSshServerId]);

  // Cleanup SSH timers on unmount.
  useEffect(() => {
    return () => {
      clearSshReconnectTimer();
      void disconnectActiveSshSession();
    };
  }, []);
  const runningBuildItems = useMemo(
    () =>
      getBuildMiniPanelItems(
        dashboardOverview,
        projects,
        dismissedBuildMiniRecordKeys,
        buildMiniPanelSessionStartedAtRef.current,
      ),
    [dashboardOverview, dismissedBuildMiniRecordKeys, projects],
  );
  const runningBuildKey = useMemo(
    () =>
      runningBuildItems
        .map((item) => `${item.project.id}:${item.build.id}`)
        .join("|"),
    [runningBuildItems],
  );
  const completedBuildMiniRecordKeys = useMemo(
    () =>
      runningBuildItems
        .filter((item) => item.build.status !== "Running")
        .map(getBuildMiniRecordKey),
    [runningBuildItems],
  );

  useEffect(() => {
    if (buildMiniPanelBuildIdRef.current === runningBuildKey) {
      return;
    }

    buildMiniPanelBuildIdRef.current = runningBuildKey;
    if (runningBuildKey && activeSection !== "project") {
      setBuildMiniPanelMinimized(false);
    }
  }, [activeSection, runningBuildKey]);

  useEffect(() => {
    if (activeSection !== "project") {
      return;
    }

    if (completedBuildMiniRecordKeys.length === 0) {
      return;
    }

    setDismissedBuildMiniRecordKeys((current) => {
      let changed = false;
      const next = new Set(current);
      completedBuildMiniRecordKeys.forEach((key) => {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [activeSection, completedBuildMiniRecordKeys]);

  useEffect(() => {
    if (splashSequenceStartedRef.current) {
      return undefined;
    }

    const appReady =
      initialStateLoaded && (selectedProject === null || !projectLoading);
    if (!appReady) {
      return undefined;
    }

    splashSequenceStartedRef.current = true;

    const timers = [
      window.setTimeout(
        () => setSplashPhase("exiting"),
        SPLASH_READY_FRAME_MS + SPLASH_EXIT_HOLD_MS,
      ),
      window.setTimeout(
        () => setSplashPhase("hidden"),
        SPLASH_READY_FRAME_MS + SPLASH_EXIT_HOLD_MS + SPLASH_FADE_OUT_MS,
      ),
    ];

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [initialStateLoaded, selectedProject, projectLoading]);

  function switchProject(project: Project): void {
    if (project.id === selectedProject?.id) {
      if (settingsDirty && settingsOpen) {
        setPendingNav(() => () => {
          setSettingsOpen(false);
          setActiveSection("project");
          setSettingsDirty(false);
        });
        return;
      }
      setSettingsOpen(false);
      setActiveSection("project");
      return;
    }

    const doSwitch = (): void => {
      if (projectLoadingTimerRef.current !== null) {
        window.clearTimeout(projectLoadingTimerRef.current);
      }
      selectedProjectIdRef.current = project.id;
      setSelectedProject(project);
      setProjectLoading(true);
      setProjectStateProjectId(null);
      projectSwitchStartedAtRef.current = Date.now();
      setSettingsOpen(false);
      setSettingsDirty(false);
      setActiveSection("project");
    };

    if (settingsDirty && settingsOpen) {
      setPendingNav(() => doSwitch);
      return;
    }

    doSwitch();
  }

  function openProjectDashboard(project: ProjectRecord): void {
    const targetProject: Project = {
      id: project.id,
      name: project.name,
      code: project.code,
      backendType: project.backendType,
    };

    const doOpen = (): void => {
      setActiveTab("dashboard");
      if (targetProject.id === selectedProject?.id) {
        setSettingsOpen(false);
        setActiveSection("project");
        return;
      }

      if (projectLoadingTimerRef.current !== null) {
        window.clearTimeout(projectLoadingTimerRef.current);
      }
      selectedProjectIdRef.current = targetProject.id;
      setSelectedProject(targetProject);
      setProjectLoading(true);
      setProjectStateProjectId(null);
      projectSwitchStartedAtRef.current = Date.now();
      setSettingsOpen(false);
      setSettingsDirty(false);
      setActiveSection("project");
    };

    if (settingsDirty && settingsOpen) {
      setPendingNav(() => doOpen);
      return;
    }

    doOpen();
  }

  function dismissBuildMiniRecord(item: BuildMiniPanelItem): void {
    if (item.build.status === "Running") {
      return;
    }

    setDismissedBuildMiniRecordKeys((current) => {
      const next = new Set(current);
      next.add(getBuildMiniRecordKey(item));
      return next;
    });
  }

  function switchDatabaseConnection(connection: DatabaseConnection): void {
    const doSwitch = (): void => {
      selectedDatabaseConnectionIdRef.current = connection.id;
      setSelectedDatabaseConnectionId(connection.id);
      setDatabaseConnections((current) =>
        current.map((item) =>
          item.id === connection.id
            ? {
                ...item,
                status: item.status === "error" ? "error" : "connected",
              }
            : item,
        ),
      );
      setActiveDatabaseTab("connection");
      setSettingsOpen(false);
      setSettingsDirty(false);
      setActiveSection("database");
    };

    if (settingsDirty && settingsOpen) {
      setPendingNav(() => doSwitch);
      return;
    }

    doSwitch();
  }

  function connectDatabaseConnection(connection: DatabaseConnection): void {
    if (databaseSleepTimerRef.current !== null) {
      window.clearTimeout(databaseSleepTimerRef.current);
      databaseSleepTimerRef.current = null;
    }
    selectedDatabaseConnectionIdRef.current = connection.id;
    setSelectedDatabaseConnectionId(connection.id);
    setActiveDatabaseTab("connection");
    setActiveSection("database");
    void verifyDatabaseConnection(connection, {
      persistAutoConnect: true,
      showSuccess: true,
    });
  }

  async function verifyDatabaseConnection(
    connection: DatabaseConnection,
    options: { persistAutoConnect: boolean; showSuccess: boolean },
  ): Promise<void> {
    verifyingDatabaseConnectionIdRef.current = connection.id;
    hadDatabaseConnectionRef.current = true;
    setDatabaseRuntimeStatus((current) =>
      current === "connected" || current === "sleeping"
        ? "reconnecting"
        : "connecting",
    );

    try {
      const result =
        await window.ivsDashboard.testDatabaseConnection(connection);
      if (!result.success) {
        if (verifyingDatabaseConnectionIdRef.current === connection.id) {
          verifyingDatabaseConnectionIdRef.current = null;
        }
        applyDatabaseConnectionStatus(connection, "error");
        if (selectedDatabaseConnectionIdRef.current === connection.id) {
          setDatabaseRuntimeStatus("error");
        }
        showSnackbar(
          result.message || "Database connection failed.",
          "invalid",
        );
        if (options.persistAutoConnect) {
          await saveDatabaseConnectionRuntimeStatus(connection, "error", false);
        }
        return;
      }

      applyDatabaseConnectionStatus(connection, "connected");
      if (verifyingDatabaseConnectionIdRef.current === connection.id) {
        verifyingDatabaseConnectionIdRef.current = null;
      }
      if (selectedDatabaseConnectionIdRef.current === connection.id) {
        setDatabaseRuntimeStatus("connected");
      }
      if (options.showSuccess) {
        showSnackbar(`${connection.name} connected.`, "valid");
      }
      if (options.persistAutoConnect) {
        await saveDatabaseConnectionRuntimeStatus(
          connection,
          "connected",
          true,
        );
      }
    } catch (error) {
      if (verifyingDatabaseConnectionIdRef.current === connection.id) {
        verifyingDatabaseConnectionIdRef.current = null;
      }
      const message =
        error instanceof Error ? error.message : "Database connection failed.";
      applyDatabaseConnectionStatus(connection, "error");
      if (selectedDatabaseConnectionIdRef.current === connection.id) {
        setDatabaseRuntimeStatus("error");
      }
      showSnackbar(message, "invalid");
      if (options.persistAutoConnect) {
        await saveDatabaseConnectionRuntimeStatus(connection, "error", false);
      }
    }
  }

  function applyDatabaseConnectionStatus(
    connection: DatabaseConnection,
    status: DatabaseConnection["status"],
  ): void {
    setDatabaseConnections((current) =>
      current.map((item) =>
        item.id === connection.id ? { ...item, status } : item,
      ),
    );
  }

  async function saveDatabaseConnectionRuntimeStatus(
    connection: DatabaseConnection,
    status: DatabaseConnection["status"],
    autoConnect: boolean,
  ): Promise<void> {
    try {
      const saved = await window.ivsDashboard.updateDatabaseConnectionSettings(
        connection.id,
        { autoConnect, status },
      );
      setDatabaseConnections((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
    } catch (error) {
      console.error(error);
      showSnackbar("Connection setting could not be saved.", "invalid");
    }
  }

  function disconnectDatabaseConnection(connection: DatabaseConnection): void {
    if (databaseSleepTimerRef.current !== null) {
      window.clearTimeout(databaseSleepTimerRef.current);
      databaseSleepTimerRef.current = null;
    }
    if (selectedDatabaseConnectionId === connection.id) {
      hadDatabaseConnectionRef.current = false;
      setDatabaseRuntimeStatus("disconnected");
    }
    setDatabaseConnections((current) =>
      current.map((item) =>
        item.id === connection.id ? { ...item, status: "disconnected" } : item,
      ),
    );
    showSnackbar(`${connection.name} disconnected.`, "warning");
    void window.ivsDashboard
      .updateDatabaseConnectionSettings(connection.id, {
        autoConnect: false,
        status: "disconnected",
      })
      .then((saved) => {
        setDatabaseConnections((current) =>
          current.map((item) => (item.id === saved.id ? saved : item)),
        );
      })
      .catch((error) => {
        console.error(error);
        showSnackbar("Connection setting could not be saved.", "invalid");
      });
  }

  function handleSectionChange(section: AppSection): void {
    if (settingsDirty && settingsOpen) {
      setPendingNav(() => () => {
        setSettingsOpen(false);
        setActiveSection(section);
        setSettingsDirty(false);
      });
      return;
    }
    setSettingsOpen(false);
    setActiveSection(section);
  }

  function handleToolChange(tool: ToolId): void {
    if (settingsDirty && settingsOpen) {
      setPendingNav(() => () => {
        setSettingsOpen(false);
        setActiveSection("tools");
        setActiveTool(tool);
        setSettingsDirty(false);
      });
      return;
    }

    setSettingsOpen(false);
    setActiveSection("tools");
    setActiveTool(tool);
  }

  function closeSettings(): void {
    if (settingsDirty) {
      setPendingNav(() => () => {
        setSettingsOpen(false);
        setSettingsDirty(false);
      });
      return;
    }

    setSettingsOpen(false);
  }

  function showSnackbar(message: string, tone: SnackbarState["tone"]): void {
    if (snackbarDismissTimerRef.current !== null) {
      window.clearTimeout(snackbarDismissTimerRef.current);
    }
    if (snackbarCloseTimerRef.current !== null) {
      window.clearTimeout(snackbarCloseTimerRef.current);
    }

    setSnackbarClosing(false);
    setSnackbar({ message, tone });
    snackbarDismissTimerRef.current = window.setTimeout(() => {
      setSnackbarClosing(true);
      snackbarCloseTimerRef.current = window.setTimeout(() => {
        setSnackbar(null);
        setSnackbarClosing(false);
      }, 190);
    }, 3600);
  }

  function showDebugBuildNotification(): void {
    if (!debugEnabled) {
      return;
    }
    void window.ivsDashboard.showDebugBuildNotification().catch((error) => {
      showSnackbar(
        error instanceof Error
          ? error.message
          : "Debug notification could not be shown.",
        "invalid",
      );
    });
  }

  function openAddProjectDialog(): void {
    if (projects.length >= MAX_PROJECTS) {
      showSnackbar(
        `Project limit reached. You can create up to ${MAX_PROJECTS} projects.`,
        "invalid",
      );
      return;
    }

    setAddProjectOpen(true);
  }

  function handleAddDatabaseConnection(): void {
    setActiveSection("database");
    setDatabaseConnectionModal("add");
  }

  function openDatabaseConnectionSettings(): void {
    if (!selectedDatabaseConnection) {
      showSnackbar("Select a database connection first.", "invalid");
      return;
    }

    setDatabaseConnectionModal("edit");
  }

  async function handleSaveDatabaseConnection(
    savedConnection: DatabaseConnection,
  ): Promise<boolean> {
    try {
      const persisted =
        await window.ivsDashboard.saveDatabaseConnection(savedConnection);
      if (databaseConnectionModal === "add") {
        setDatabaseConnections((current) => [...current, persisted]);
        setSelectedDatabaseConnectionId(persisted.id);
        setActiveDatabaseTab("connection");
        setActiveSection("database");
        setDatabaseConnectionModal(null);
        showSnackbar("Connection saved", "valid");
        return true;
      }

      setDatabaseConnections((current) =>
        current.map((connection) =>
          connection.id === persisted.id
            ? {
                ...connection,
                ...persisted,
                name: persisted.name || connection.name,
              }
            : connection,
        ),
      );
      setSelectedDatabaseConnectionId(persisted.id);
      setDatabaseConnectionModal(null);
      showSnackbar("Connection settings saved", "valid");
      return true;
    } catch (error) {
      console.error(error);
      showSnackbar(
        error instanceof Error
          ? error.message
          : "Connection could not be saved",
        "invalid",
      );
      return false;
    }
  }

  async function confirmDeleteDatabaseConnection(): Promise<void> {
    if (!deleteDatabaseConnectionRequest) {
      return;
    }

    const deleted = deleteDatabaseConnectionRequest;
    try {
      await window.ivsDashboard.deleteDatabaseConnection(deleted.id);
      const remaining = databaseConnections.filter(
        (connection) => connection.id !== deleted.id,
      );
      setDatabaseConnections(remaining);
      setDeletedDatabaseConnectionId(deleted.id);
      setDeleteDatabaseConnectionRequest(null);
      setDatabaseExecutionHistory((current) =>
        current.filter((entry) => entry.connectionId !== deleted.id),
      );
      if (selectedDatabaseConnectionId === deleted.id) {
        setSelectedDatabaseConnectionId(remaining[0]?.id ?? null);
        setActiveDatabaseTab("connection");
        if (remaining.length === 0) {
          setActiveSection("database");
        }
      }
      showSnackbar(`${deleted.name} deleted.`, "valid");
    } catch (error) {
      console.error(error);
      showSnackbar(
        error instanceof Error
          ? error.message
          : "Connection could not be deleted",
        "invalid",
      );
    }
  }

  function handleDatabaseExecution(record: DatabaseExecutionRecord): void {
    setDatabaseExecutionHistory((current) => {
      const countsByConnection = new Map<string, number>();
      return [record, ...current].filter((entry) => {
        const count = countsByConnection.get(entry.connectionId) ?? 0;
        if (count >= 1000) {
          return false;
        }
        countsByConnection.set(entry.connectionId, count + 1);
        return true;
      });
    });
  }

  function refreshDatabaseMetadata(): void {
    setDatabaseLastRefreshTime(new Date().toISOString());
    showSnackbar("Database metadata refreshed.", "valid");
  }

  async function handleCreateProject(
    name: string,
    code: string,
    backendType: BackendType,
    pythonServerType?: PythonServerType,
  ): Promise<boolean> {
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    const errors: string[] = [];

    if (!trimmedName) {
      errors.push("Project name is required");
    } else if (trimmedName.length > 16) {
      errors.push("Project name must be 16 characters or fewer");
    }

    if (!trimmedCode) {
      errors.push("Project tag is required");
    } else if (trimmedCode.length > 3) {
      errors.push("Project tag must be 3 characters or fewer");
    }

    if (errors.length > 0) {
      showSnackbar(errors.join(". "), "invalid");
      return false;
    }

    if (projects.length >= MAX_PROJECTS) {
      showSnackbar(
        `Project limit reached. You can create up to ${MAX_PROJECTS} projects.`,
        "invalid",
      );
      return false;
    }

    try {
      const created = await window.ivsDashboard.createProject(
        trimmedName,
        trimmedCode,
        backendType,
        pythonServerType,
      );
      if (projectLoadingTimerRef.current !== null) {
        window.clearTimeout(projectLoadingTimerRef.current);
      }
      selectedProjectIdRef.current = created.id;
      setProjects((current) => [...current, created]);
      setSelectedProject(created);
      setProjectStateProjectId(null);
      setProjectLoading(true);
      projectSwitchStartedAtRef.current = Date.now();
      setActiveSection("project");
      setActiveTab("dashboard");
      setSettingsDirty(false);
      setSettingsOpen(true);
      void refreshDashboardOverview();
      showSnackbar(`${created.name} created.`, "valid");
      return true;
    } catch (error) {
      console.error(error);
      showSnackbar(
        error instanceof Error ? error.message : "Project could not be created",
        "invalid",
      );
      return false;
    }
  }

  function refreshDashboardOverview(): Promise<void> {
    const requestId = dashboardOverviewRequestRef.current + 1;
    dashboardOverviewRequestRef.current = requestId;
    setDashboardOverviewLoading(true);

    return window.ivsDashboard
      .getDashboardOverview()
      .then((overview) => setDashboardOverview(overview))
      .catch((error) => console.error(error))
      .finally(() => {
        if (dashboardOverviewRequestRef.current === requestId) {
          setDashboardOverviewLoading(false);
        }
      });
  }

  const splashOverlay =
    splashPhase !== "hidden" ? (
      <div className={`splash-screen ${splashPhase}`} aria-hidden="true">
        <div className="splash-logo-shell" style={{ width: SPLASH_LOGO_SIZE }}>
          <img className="splash-logo" src={splashIcon} alt="" />
        </div>
      </div>
    ) : null;

  const databaseConnectionDialog = (
    <DatabaseConnectionModal
      open={
        databaseConnectionModal !== null &&
        (databaseConnectionModal !== "edit" ||
          selectedDatabaseConnection !== null)
      }
      mode={databaseConnectionModal ?? "add"}
      connection={
        databaseConnectionModal === "edit" ? selectedDatabaseConnection : null
      }
      connections={databaseConnections}
      onClose={() => setDatabaseConnectionModal(null)}
      onSave={handleSaveDatabaseConnection}
      onTestStatus={showSnackbar}
      onDeleteRequest={(connection) => {
        setDatabaseConnectionModal(null);
        setDeleteDatabaseConnectionRequest(connection);
      }}
    />
  );

  const databaseDeleteDialog = deleteDatabaseConnectionRequest ? (
    <ConfirmDialog
      title="Delete Database Connection?"
      message={`Deleting "${deleteDatabaseConnectionRequest.name}" will remove its saved sheets, query results, metadata cache, and query history from this workspace. Other projects and database connections will not be changed.`}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      variant="danger"
      onClose={() => setDeleteDatabaseConnectionRequest(null)}
      onConfirm={() => void confirmDeleteDatabaseConnection()}
    />
  ) : null;
  const cookieModal = (
    <ApiTesterCookieModal
      open={cookieModalOpen}
      storageScopeId={
        activeSection === "tools" && selectedProject
          ? selectedProject.id
          : "global"
      }
      onClose={() => setCookieModalOpen(false)}
    />
  );
  const chatFeature = chatEnabled ? (
    <ChatFeature onToast={showSnackbar} />
  ) : null;
  const buildMiniPanel =
    activeSection !== "project" && runningBuildItems.length > 0 ? (
      <BuildMiniPanel
        items={runningBuildItems}
        minimized={buildMiniPanelMinimized}
        onMinimize={() => setBuildMiniPanelMinimized(true)}
        onRestore={() => setBuildMiniPanelMinimized(false)}
        onClearCompleted={() => {
          setDismissedBuildMiniRecordKeys((current) => {
            const next = new Set(current);
            runningBuildItems.forEach((item) => {
              next.add(getBuildMiniRecordKey(item));
            });
            return next;
          });
        }}
        onOpenProject={openProjectDashboard}
        onDismissRecord={dismissBuildMiniRecord}
      />
    ) : null;
  const interfaceSettingsModal = (
    <InterfaceSettingsModal
      open={interfaceSettingsOpen}
      theme={theme}
      accentColor={accentColor}
      onThemeChange={setTheme}
      onAccentColorChange={setAccentColor}
      onClose={() => setInterfaceSettingsOpen(false)}
    />
  );
  if (!selectedProject && !initialStateLoaded) {
    return (
      <div
        ref={appShellRef}
        className="app-shell"
        data-theme={theme}
        data-accent={accentColor}
        data-font-size={fontSizeMode}
      >
        <main className="main-content project-loading">
          <AppHeader actions={chatFeature} />
          <p className="database-empty-state">Loading project configuration.</p>
        </main>
        {splashOverlay}
      </div>
    );
  }

  if (!selectedProject) {
    return (
      <div
        ref={appShellRef}
        className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
        data-theme={theme}
        data-accent={accentColor}
        data-font-size={fontSizeMode}
      >
        <Sidebar
          projects={projects}
          databaseConnections={databaseConnections}
          selectedProjectId=""
          selectedDatabaseConnectionId={selectedDatabaseConnectionId}
          activeSection={
            activeSection === "project" ? "dashboard" : activeSection
          }
          activeTool={activeTool}
          collapsed={sidebarCollapsed}
          debugEnabled={debugEnabled}
          onProjectChange={switchProject}
          onDatabaseConnectionChange={switchDatabaseConnection}
          onDatabaseConnect={connectDatabaseConnection}
          onDatabaseDisconnect={disconnectDatabaseConnection}
          onSectionChange={handleSectionChange}
          onToolChange={handleToolChange}
          onAddProject={openAddProjectDialog}
          onAddDatabaseConnection={handleAddDatabaseConnection}
          onCollapseToggle={() => setSidebarCollapsed((current) => !current)}
          onInterfaceSettings={() => setInterfaceSettingsOpen(true)}
          onDebugBuildNotification={showDebugBuildNotification}
        />
        <main className="main-content">
          <AppHeader
            actions={
              <>
                {activeSection === "tools" && activeTool === "api-tester" ? (
                  <>
                    {apiTesterView === "test" ? (
                      <button
                        className="button primary compact"
                        type="button"
                        onClick={() =>
                          window.dispatchEvent(new Event("api-tester:send"))
                        }
                      >
                        <Send size={15} />
                        Send
                      </button>
                    ) : null}
                    <ApiTesterCookieButton
                      storageScopeId="global"
                      onClick={() => setCookieModalOpen(true)}
                    />
                    <FontSizeDropdown
                      value={fontSizeMode}
                      onChange={setFontSizeMode}
                    />
                  </>
                ) : activeSection === "tools" && activeTool === "notebook" ? (
                  <>
                    <button
                      className="icon-button secondary header-settings-button"
                      type="button"
                      aria-label="Add note"
                      title="Add note"
                      onClick={() =>
                        setNotebookAddRequestId((current) => current + 1)
                      }
                    >
                      <Plus size={18} />
                    </button>
                    <button
                      className="icon-button secondary header-settings-button"
                      type="button"
                      aria-label={
                        notebookView === "grid"
                          ? "Switch to list view"
                          : "Switch to grid view"
                      }
                      title={
                        notebookView === "grid" ? "List view" : "Grid view"
                      }
                      onClick={() =>
                        setNotebookView((current) =>
                          current === "grid" ? "list" : "grid",
                        )
                      }
                    >
                      {notebookView === "grid" ? (
                        <List size={18} />
                      ) : (
                        <Grid3X3 size={18} />
                      )}
                    </button>
                    <FontSizeDropdown
                      value={fontSizeMode}
                      onChange={setFontSizeMode}
                    />
                  </>
                ) : activeSection === "tools" && activeTool === "ssh" ? (
                  <SshHeaderActions
                    servers={sshServers}
                    selectedServerId={selectedSshServerId}
                    fontSizeMode={fontSizeMode}
                    disabled={!sshHasValidCredential}
                    connectionStatus={sshConnectionStatus}
                    onServerChange={setSelectedSshServerId}
                    onConnectionToggle={handleSshConnectionToggle}
                    onSettingsClick={() => setSshSettingsOpen(true)}
                    onFontSizeChange={setFontSizeMode}
                  />
                ) : activeSection === "tools" ? (
                  <FontSizeDropdown
                    value={fontSizeMode}
                    onChange={setFontSizeMode}
                  />
                ) : activeSection === "database" &&
                  selectedDatabaseConnection ? (
                  <DatabaseHeaderActions
                    connection={selectedDatabaseConnection}
                    databaseStatus={databaseRuntimeStatus}
                    fontSizeMode={fontSizeMode}
                    onFontSizeChange={setFontSizeMode}
                    onSettingsClick={openDatabaseConnectionSettings}
                  />
                ) : null}
                {chatFeature}
              </>
            }
          >
            {activeSection === "database" && selectedDatabaseConnection ? (
              <DatabaseWorkspaceTabs
                connectionName={selectedDatabaseConnection.name}
                activeTab={activeDatabaseTab}
                onTabChange={setActiveDatabaseTab}
              />
            ) : activeSection === "tools" && activeTool === "api-tester" ? (
              <ApiTesterHeaderTabs
                activeView={apiTesterView}
                onViewChange={setApiTesterView}
              />
            ) : activeSection === "tools" && activeTool === "comparing" ? (
              <CompareHeaderTabs
                activeView={comparingView}
                onViewChange={setComparingView}
              />
            ) : activeSection === "tools" && activeTool === "cryptographic" ? (
              <CryptographicHeaderTabs
                activeView={cryptoActiveTab}
                onViewChange={setCryptoActiveTab}
              />
            ) : activeSection === "tools" && activeTool === "notebook" ? (
              <SingleToolHeaderTabs label="Notes" />
            ) : activeSection === "tools" && activeTool === "ssh" ? (
              <SshHeaderTabs
                activeTab={activeSshTab}
                onTabChange={setActiveSshTab}
              />
            ) : null}
          </AppHeader>

          {activeSection === "tools" ? (
            activeTool === "api-tester" ? (
              <ApiTesterMockup
                view={apiTesterView}
                storageScopeId="global"
                onViewChange={setApiTesterView}
                onFeedback={showSnackbar}
                initialState={apiTesterDraftStateByScope.global ?? null}
                onStateChange={(next) =>
                  setApiTesterDraftStateByScope((current) => ({
                    ...current,
                    global: next,
                  }))
                }
              />
            ) : activeTool === "comparing" ? (
              <CompareTool />
            ) : activeTool === "notebook" ? (
              <NotesTab
                projectId={STANDALONE_NOTEBOOK_PROJECT_ID}
                view={notebookView}
                addNoteRequestId={notebookAddRequestId}
                onFeedback={(message) => showSnackbar(message, "invalid")}
              />
            ) : activeTool === "ssh" ? (
              <SshTool
                selectedServer={selectedSshServer}
                activeTab={activeSshTab}
                disabled={!sshHasValidCredential}
                connectionStatus={sshConnectionStatus}
                reconnectAttempt={sshReconnectAttempt}
                reconnectMaxAttempts={
                  selectedSshServer?.maxReconnectAttempts ?? 0
                }
                terminalConnectionEnabled={sshTerminalConnectionEnabled}
                terminalConnectionSignal={sshTerminalConnectionSignal}
                sshSessionId={sshActiveSessionId}
                remoteCwd={sshRemoteCwd}
                onConfigure={() => setSshSettingsOpen(true)}
                onCommandSubmit={handleSshCommandSubmit}
                onTerminalConnectionStatusChange={
                  handleSshTerminalConnectionStatusChange
                }
                onTerminalHostChange={handleSshTerminalHostChange}
              />
            ) : (
              <CryptographicTool
                activeTab={cryptoActiveTab}
                onFeedback={showSnackbar}
              />
            )
          ) : activeSection === "database" ? (
            selectedDatabaseConnection ? (
              <DatabaseWorkspace
                connection={selectedDatabaseConnection}
                activeTab={activeDatabaseTab}
                databaseStatus={databaseRuntimeStatus}
                onTabChange={setActiveDatabaseTab}
                executionHistory={selectedDatabaseExecutionHistory}
                queryCount={selectedDatabaseExecutionHistory.length}
                lastRefreshTime={databaseLastRefreshTime}
                onExecution={handleDatabaseExecution}
                onRefresh={refreshDatabaseMetadata}
                onSheetSaved={() => showSnackbar("Sheet saved", "valid")}
                deletedConnectionId={deletedDatabaseConnectionId}
              />
            ) : (
              <DatabaseEmptyState onCreate={handleAddDatabaseConnection} />
            )
          ) : (
            <DashboardContent
              projects={dashboardOverview}
              databaseConnections={databaseConnections}
              loading={dashboardOverviewLoading}
            />
          )}
        </main>
        {snackbar ? (
          <div
            className={`app-snackbar ${snackbar.tone}${
              snackbarClosing ? " closing" : ""
            }`}
            role="status"
          >
            {snackbar.message}
          </div>
        ) : null}
        {addProjectOpen ? (
          <AddProjectDialog
            onCreate={handleCreateProject}
            onClose={() => setAddProjectOpen(false)}
          />
        ) : null}
        {databaseConnectionDialog}
        {cookieModal}
        {interfaceSettingsModal}
        {databaseDeleteDialog}
        {buildMiniPanel}
        {splashOverlay}
      </div>
    );
  }

  return (
    <div
      ref={appShellRef}
      className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      data-theme={theme}
      data-accent={accentColor}
      data-font-size={fontSizeMode}
    >
      <Sidebar
        projects={projects}
        databaseConnections={databaseConnections}
        selectedProjectId={selectedProject.id}
        selectedDatabaseConnectionId={selectedDatabaseConnectionId}
        activeSection={activeSection}
        activeTool={activeTool}
        collapsed={sidebarCollapsed}
        projectStatuses={sidebarProjectStatuses}
        projectFrontendEnabled={sidebarProjectFrontendEnabled}
        debugEnabled={debugEnabled}
        onProjectChange={switchProject}
        onDatabaseConnectionChange={switchDatabaseConnection}
        onDatabaseConnect={connectDatabaseConnection}
        onDatabaseDisconnect={disconnectDatabaseConnection}
        onSectionChange={handleSectionChange}
        onToolChange={handleToolChange}
        onAddProject={openAddProjectDialog}
        onAddDatabaseConnection={handleAddDatabaseConnection}
        onCollapseToggle={() => setSidebarCollapsed((current) => !current)}
        onInterfaceSettings={() => setInterfaceSettingsOpen(true)}
        onDebugBuildNotification={showDebugBuildNotification}
      />
      <main
        className={`main-content${
          activeSection === "project" && projectLoading
            ? " project-loading"
            : ""
        }`}
      >
        <AppHeader
          activeTab={activeSection === "project" ? activeTab : undefined}
          onTabChange={activeSection === "project" ? setActiveTab : undefined}
          projectTabLabel={selectedProject.name}
          actions={
            <>
              {activeSection === "project" && activeProjectState ? (
                <HeaderActions
                  disabled={projectLoading}
                  projectId={selectedProject.id}
                  settings={activeProjectState.settings}
                  statuses={activeProjectState.statuses}
                  recentBuilds={activeProjectState.recentBuilds}
                  gitStatus={activeProjectState.gitStatus}
                  fontSizeMode={fontSizeMode}
                  onFontSizeChange={setFontSizeMode}
                  onSettingsClick={() => setSettingsOpen(true)}
                  onEnvFilesClick={() => setEnvFilesOpen(true)}
                  showSettingsButton={activeTab !== "notes"}
                  utilityActions={
                    activeTab === "notes" ? (
                      <>
                        <button
                          className="icon-button secondary header-settings-button"
                          type="button"
                          aria-label="Add note"
                          title="Add note"
                          disabled={projectLoading}
                          onClick={() =>
                            setNotesAddRequestId((current) => current + 1)
                          }
                        >
                          <Plus size={18} />
                        </button>
                        <button
                          className="icon-button secondary header-settings-button"
                          type="button"
                          aria-label={
                            notesView === "grid"
                              ? "Switch to list view"
                              : "Switch to grid view"
                          }
                          title={
                            notesView === "grid" ? "List view" : "Grid view"
                          }
                          disabled={projectLoading}
                          onClick={() =>
                            setNotesView((current) =>
                              current === "grid" ? "list" : "grid",
                            )
                          }
                        >
                          {notesView === "grid" ? (
                            <List size={18} />
                          ) : (
                            <Grid3X3 size={18} />
                          )}
                        </button>
                      </>
                    ) : undefined
                  }
                  onServiceWarning={(message) =>
                    showSnackbar(message, "invalid")
                  }
                />
              ) : activeSection === "database" && selectedDatabaseConnection ? (
                <DatabaseHeaderActions
                  connection={selectedDatabaseConnection}
                  databaseStatus={databaseRuntimeStatus}
                  fontSizeMode={fontSizeMode}
                  onFontSizeChange={setFontSizeMode}
                  onSettingsClick={openDatabaseConnectionSettings}
                />
              ) : activeSection === "tools" && activeTool === "api-tester" ? (
                <>
                  <ApiTesterCookieButton
                    storageScopeId={selectedProject.id}
                    onClick={() => setCookieModalOpen(true)}
                  />
                  <FontSizeDropdown
                    value={fontSizeMode}
                    onChange={setFontSizeMode}
                  />
                </>
              ) : activeSection === "tools" && activeTool === "notebook" ? (
                <>
                  <button
                    className="icon-button secondary header-settings-button"
                    type="button"
                    aria-label="Add note"
                    title="Add note"
                    onClick={() =>
                      setNotebookAddRequestId((current) => current + 1)
                    }
                  >
                    <Plus size={18} />
                  </button>
                  <button
                    className="icon-button secondary header-settings-button"
                    type="button"
                    aria-label={
                      notebookView === "grid"
                        ? "Switch to list view"
                        : "Switch to grid view"
                    }
                    title={notebookView === "grid" ? "List view" : "Grid view"}
                    onClick={() =>
                      setNotebookView((current) =>
                        current === "grid" ? "list" : "grid",
                      )
                    }
                  >
                    {notebookView === "grid" ? (
                      <List size={18} />
                    ) : (
                      <Grid3X3 size={18} />
                    )}
                  </button>
                  <FontSizeDropdown
                    value={fontSizeMode}
                    onChange={setFontSizeMode}
                  />
                </>
              ) : activeSection === "tools" && activeTool === "ssh" ? (
                <SshHeaderActions
                  servers={sshServers}
                  selectedServerId={selectedSshServerId}
                  fontSizeMode={fontSizeMode}
                  disabled={!sshHasValidCredential}
                  connectionStatus={sshConnectionStatus}
                  onServerChange={setSelectedSshServerId}
                  onConnectionToggle={handleSshConnectionToggle}
                  onSettingsClick={() => setSshSettingsOpen(true)}
                  onFontSizeChange={setFontSizeMode}
                />
              ) : activeSection === "tools" || activeSection === "dashboard" ? (
                <FontSizeDropdown
                  value={fontSizeMode}
                  onChange={setFontSizeMode}
                />
              ) : null}
              {chatFeature}
            </>
          }
        >
          {activeSection === "database" && selectedDatabaseConnection ? (
            <DatabaseWorkspaceTabs
              connectionName={selectedDatabaseConnection.name}
              activeTab={activeDatabaseTab}
              onTabChange={setActiveDatabaseTab}
            />
          ) : activeSection === "tools" && activeTool === "api-tester" ? (
            <ApiTesterHeaderTabs
              activeView={apiTesterView}
              onViewChange={setApiTesterView}
            />
          ) : activeSection === "tools" && activeTool === "comparing" ? (
            <CompareHeaderTabs
              activeView={comparingView}
              onViewChange={setComparingView}
            />
          ) : activeSection === "tools" && activeTool === "cryptographic" ? (
            <CryptographicHeaderTabs
              activeView={cryptoActiveTab}
              onViewChange={setCryptoActiveTab}
            />
          ) : activeSection === "tools" && activeTool === "notebook" ? (
            <SingleToolHeaderTabs label="Notes" />
          ) : activeSection === "tools" && activeTool === "ssh" ? (
            <SshHeaderTabs
              activeTab={activeSshTab}
              onTabChange={setActiveSshTab}
            />
          ) : null}
        </AppHeader>

        {activeSection === "dashboard" ? (
          <DashboardContent
            projects={dashboardOverview}
            databaseConnections={databaseConnections}
            loading={dashboardOverviewLoading}
          />
        ) : activeSection === "database" ? (
          selectedDatabaseConnection ? (
            <DatabaseWorkspace
              connection={selectedDatabaseConnection}
              activeTab={activeDatabaseTab}
              databaseStatus={databaseRuntimeStatus}
              onTabChange={setActiveDatabaseTab}
              executionHistory={selectedDatabaseExecutionHistory}
              queryCount={selectedDatabaseExecutionHistory.length}
              lastRefreshTime={databaseLastRefreshTime}
              onExecution={handleDatabaseExecution}
              onRefresh={refreshDatabaseMetadata}
              onSheetSaved={() => showSnackbar("Sheet saved", "valid")}
              deletedConnectionId={deletedDatabaseConnectionId}
            />
          ) : (
            <DatabaseEmptyState onCreate={handleAddDatabaseConnection} />
          )
        ) : activeSection === "tools" ? (
          activeTool === "api-tester" ? (
            <ApiTesterMockup
              view={apiTesterView}
              storageScopeId={selectedProject.id}
              onViewChange={setApiTesterView}
              onFeedback={showSnackbar}
              initialState={
                apiTesterDraftStateByScope[selectedProject.id] ?? null
              }
              onStateChange={(next) =>
                setApiTesterDraftStateByScope((current) => ({
                  ...current,
                  [selectedProject.id]: next,
                }))
              }
            />
          ) : activeTool === "comparing" ? (
            <CompareTool />
          ) : activeTool === "notebook" ? (
            <NotesTab
              projectId={STANDALONE_NOTEBOOK_PROJECT_ID}
              view={notebookView}
              addNoteRequestId={notebookAddRequestId}
              onFeedback={(message) => showSnackbar(message, "invalid")}
            />
          ) : activeTool === "ssh" ? (
            <SshTool
              selectedServer={selectedSshServer}
              activeTab={activeSshTab}
              disabled={!sshHasValidCredential}
              connectionStatus={sshConnectionStatus}
              reconnectAttempt={sshReconnectAttempt}
              reconnectMaxAttempts={
                selectedSshServer?.maxReconnectAttempts ?? 0
              }
              terminalConnectionEnabled={sshTerminalConnectionEnabled}
              terminalConnectionSignal={sshTerminalConnectionSignal}
              sshSessionId={sshActiveSessionId}
              remoteCwd={sshRemoteCwd}
              onConfigure={() => setSshSettingsOpen(true)}
              onCommandSubmit={handleSshCommandSubmit}
              onTerminalConnectionStatusChange={
                handleSshTerminalConnectionStatusChange
              }
              onTerminalHostChange={handleSshTerminalHostChange}
            />
          ) : (
            <CryptographicTool
              activeTab={cryptoActiveTab}
              onFeedback={showSnackbar}
            />
          )
        ) : activeSection === "project" ? (
          <>
            {activeTab === "dashboard" ? (
              <ProjectDashboardContent
                projectId={selectedProject.id}
                resetVersion={panelResetVersion}
                projectState={activeProjectState ?? createLoadingProjectState()}
              />
            ) : null}
            {activeTab === "monitor" ? (
              <MonitorTab
                resetVersion={panelResetVersion}
                projectState={activeProjectState ?? createLoadingProjectState()}
                projectId={selectedProject.id}
              />
            ) : null}
            {activeTab === "git-terminal" ? (
              activeProjectState ? (
                <GitTerminalTab
                  projectId={selectedProject.id}
                  gitStatus={activeProjectState.gitStatus}
                  onFeedback={showSnackbar}
                />
              ) : (
                <section className="resizable-panel-screen">
                  <div className="panel">
                    <div />
                  </div>
                </section>
              )
            ) : null}
            {activeTab === "notes" ? (
              <NotesTab
                projectId={selectedProject.id}
                view={notesView}
                addNoteRequestId={notesAddRequestId}
                onFeedback={(message) => showSnackbar(message, "invalid")}
              />
            ) : null}
          </>
        ) : null}
      </main>

      <SshSettingsModal
        open={sshSettingsOpen}
        servers={sshServers}
        selectedServerId={selectedSshServerId}
        connectionStatus={sshConnectionStatus}
        credentialRequired={sshSettingsRequired}
        onSave={saveSshServers}
        onClose={closeSshSettings}
      />

      <Modal
        open={settingsOpen && activeProjectState !== null}
        title="Settings"
        subtitle={selectedProject.name}
        size="xl"
        className="settings-modal"
        contentClassName="settings-modal-content"
        closeLabel="Close settings"
        onClose={closeSettings}
      >
        {activeProjectState ? (
          <SettingsContent
            key={selectedProject.id}
            selectedProject={selectedProject}
            settings={activeProjectState.settings}
            onSettingsSaved={(settings) => {
              setProjectState((current) =>
                current ? { ...current, settings } : current,
              );
              setSettingsDirty(false);
              setSettingsOpen(false);
              void refreshDashboardOverview();
            }}
            onProjectDeleted={() => {
              const remaining = projects.filter(
                (p) => p.id !== selectedProject.id,
              );
              setSettingsOpen(false);
              setSettingsDirty(false);
              setProjects(remaining);
              setSelectedProject(remaining[0] ?? null);
              setActiveSection("dashboard");
            }}
            onProjectUpdated={(updated) => {
              setProjects((current) =>
                current.map((p) => (p.id === updated.id ? updated : p)),
              );
              setSelectedProject(updated);
              void refreshDashboardOverview();
            }}
            onDirtyChange={setSettingsDirty}
            onCancel={() => {
              setSettingsDirty(false);
              setSettingsOpen(false);
            }}
          />
        ) : null}
      </Modal>

      <ProjectEnvFilesModal
        open={envFilesOpen && activeProjectState !== null}
        project={selectedProject}
        onClose={() => setEnvFilesOpen(false)}
        onFeedback={showSnackbar}
      />

      {addProjectOpen ? (
        <AddProjectDialog
          onCreate={handleCreateProject}
          onClose={() => setAddProjectOpen(false)}
        />
      ) : null}

      {databaseConnectionDialog}
      {cookieModal}
      {interfaceSettingsModal}

      {snackbar ? (
        <div
          className={`app-snackbar ${snackbar.tone}${snackbarClosing ? " closing" : ""}`}
          role="status"
          onClick={() => setSnackbar(null)}
        >
          {snackbar.message}
        </div>
      ) : null}

      {databaseDeleteDialog}
      {buildMiniPanel}

      {pendingNav ? (
        <ConfirmDialog
          title="Unsaved Changes"
          message="You have unsaved settings changes. Closing now will discard them."
          confirmLabel="Discard"
          cancelLabel="Stay"
          variant="warning"
          onClose={() => setPendingNav(null)}
          onConfirm={() => pendingNav()}
        />
      ) : null}

      {shutdownEntries !== null ? (
        <div className="shutdown-overlay">
          <div className="shutdown-dialog">
            <h2>Shutting down servers</h2>
            <div className="shutdown-service-list">
              {shutdownEntries.map((entry) => {
                const key = `${entry.projectId}:${entry.service}`;
                const stopped = stoppedServices.has(key);
                return (
                  <div
                    key={key}
                    className={`shutdown-service-item${stopped ? " stopped" : ""}`}
                  >
                    <div className="shutdown-service-label">
                      <strong>
                        {entry.service === "wildfly"
                          ? "WildFly"
                          : entry.service === "python"
                            ? "Python"
                            : "Frontend"}
                      </strong>
                      <span>{entry.projectName}</span>
                    </div>
                    <div className="shutdown-service-status">
                      {stopped ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <span className="shutdown-spinner" />
                      )}
                      <span>{stopped ? "Stopped" : "Stopping"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      {splashOverlay}
    </div>
  );
}

function InterfaceSettingsModal({
  open,
  theme,
  accentColor,
  onThemeChange,
  onAccentColorChange,
  onClose,
}: {
  open: boolean;
  theme: Theme;
  accentColor: AccentColor;
  onThemeChange: (theme: Theme) => void;
  onAccentColorChange: (color: AccentColor) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal
      open={open}
      title="Interface settings"
      size="sm"
      className="interface-settings-modal"
      contentClassName="interface-settings-modal-content"
      closeLabel="Close interface settings"
      onClose={onClose}
    >
      <div className="interface-settings-panel">
        <section className="interface-settings-section">
          <h3>Interface theme</h3>
          <div className="interface-theme-options" role="group">
            <button
              className={`interface-theme-option${theme === "light" ? " active" : ""}`}
              type="button"
              aria-pressed={theme === "light"}
              onClick={() => onThemeChange("light")}
            >
              <Sun size={16} />
              <span>Light</span>
            </button>
            <button
              className={`interface-theme-option${theme === "dark" ? " active" : ""}`}
              type="button"
              aria-pressed={theme === "dark"}
              onClick={() => onThemeChange("dark")}
            >
              <Moon size={16} />
              <span>Dark</span>
            </button>
          </div>
        </section>

        <section className="interface-settings-section">
          <h3>Accent color</h3>
          <div className="accent-color-grid" role="group">
            {ACCENT_OPTIONS.map((option) => {
              const selected = accentColor === option.value;
              return (
                <button
                  key={option.value}
                  className={`accent-color-option ${option.value}${selected ? " active" : ""}`}
                  type="button"
                  aria-label={`${option.label} accent`}
                  aria-pressed={selected}
                  title={option.label}
                  onClick={() => onAccentColorChange(option.value)}
                >
                  <span className="accent-color-swatch" />
                  <span>{option.label}</span>
                  {selected ? <Check size={15} /> : null}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function DatabaseHeaderActions({
  connection,
  databaseStatus,
  fontSizeMode,
  onFontSizeChange,
  onSettingsClick,
  disabled = false,
}: {
  connection: DatabaseConnection;
  databaseStatus: DatabaseRuntimeStatus;
  fontSizeMode: FontSizeMode;
  onFontSizeChange: (mode: FontSizeMode) => void;
  onSettingsClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div className="header-actions database-header-actions">
      <div className="database-header-context" aria-label="Database context">
        <span className={`database-status-dot ${databaseStatus}`} />
        <span>{databaseStatus}</span>
        <span>-</span>
        <span>{connection.user}</span>
        <span>-</span>
        <strong>{connection.name}</strong>
      </div>
      <HeaderUtilityActions
        fontSizeMode={fontSizeMode}
        onFontSizeChange={onFontSizeChange}
        onSettingsClick={onSettingsClick}
        disabled={disabled}
        settingsIcon="cog"
      />
    </div>
  );
}

function DatabaseEmptyState({
  onCreate,
}: {
  onCreate: () => void;
}): JSX.Element {
  return (
    <section className="database-empty-screen resizable-panel-screen">
      <div className="panel database-empty-panel">
        <DatabaseConnectionIcon />
        <h2>No database connections</h2>
        <p>Saved connections will appear in the database list.</p>
        <button
          className="button primary compact"
          type="button"
          onClick={onCreate}
        >
          New connection
        </button>
      </div>
    </section>
  );
}

function DatabaseConnectionIcon(): JSX.Element {
  return <span className="database-empty-icon">DB</span>;
}

function BuildMiniPanel({
  items,
  minimized,
  onMinimize,
  onRestore,
  onClearCompleted,
  onOpenProject,
  onDismissRecord,
}: {
  items: BuildMiniPanelItem[];
  minimized: boolean;
  onMinimize: () => void;
  onRestore: () => void;
  onClearCompleted: () => void;
  onOpenProject: (project: ProjectRecord) => void;
  onDismissRecord: (item: BuildMiniPanelItem) => void;
}): JSX.Element {
  const now = useAppNow(1000);
  const buildCount = items.length;
  const runningCount = items.filter(
    (item) => item.build.status === "Running",
  ).length;
  const showClearCompleted = buildCount > 0 && runningCount === 0;
  const restoreStatus = getBuildMiniRestoreStatus(items);

  return (
    <div
      className={`build-mini-dock${minimized ? " minimized" : " expanded"}`}
      aria-live="polite"
    >
      <button
        className={`build-mini-restore ${restoreStatus}`}
        type="button"
        aria-label="Show build progress"
        title="Show build progress"
        onClick={onRestore}
      >
        <Package size={18} />
      </button>
      <section className="build-mini-panel" aria-label="Build progress">
        <header className="build-mini-header">
          <span className="build-mini-icon">
            <Package size={18} />
          </span>
          <div>
            <h2>{runningCount > 0 ? "Build Running" : "Build Complete"}</h2>
            <p>{getBuildMiniSummary(buildCount, runningCount)}</p>
          </div>
          <div className="build-mini-actions">
            {showClearCompleted ? (
              <button
                className="build-mini-clear"
                type="button"
                onClick={onClearCompleted}
              >
                Clear
              </button>
            ) : null}
            <button
              className="build-mini-minimize"
              type="button"
              aria-label="Minimize build progress"
              title="Minimize"
              onClick={onMinimize}
            >
              <Minimize2 size={15} />
            </button>
          </div>
        </header>
        <div className="build-mini-list">
          {items.map((item) => {
            const elapsedLabel = formatBuildMiniElapsed(item.build, now);
            const title =
              item.build.outcomeType === "build-and-deploy"
                ? "Build & Deploy"
                : "WAR Build";

            return (
              <button
                className="build-mini-item"
                type="button"
                key={`${item.project.id}-${item.build.id}`}
                onClick={() => {
                  onDismissRecord(item);
                  onOpenProject(item.project);
                }}
              >
                <span
                  className={`build-mini-item-status ${getBuildMiniStatusClass(
                    item.build.status,
                  )}`}
                />
                <span className="build-mini-item-copy">
                  <strong>
                    {item.project.name}
                    {item.debug ? " (debug)" : ""}
                  </strong>
                  <span>
                    {title} - {item.build.profile}
                  </span>
                </span>
                <span className="build-mini-item-meta">
                  <strong>{elapsedLabel}</strong>
                  <span>{item.build.status}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function getBuildMiniSummary(buildCount: number, runningCount: number): string {
  if (runningCount > 0) {
    return `${runningCount} active ${runningCount === 1 ? "project" : "projects"}`;
  }
  return `${buildCount} recent ${buildCount === 1 ? "record" : "records"}`;
}

function getBuildMiniRecordKey(item: BuildMiniPanelItem): string {
  return `${item.project.id}:${item.build.id}`;
}

function getBuildMiniRestoreStatus(items: BuildMiniPanelItem[]): string {
  if (items.some((item) => item.build.status === "Running")) {
    return "running";
  }
  if (items.some((item) => item.build.status === "Failed")) {
    return "failed";
  }
  if (items.some((item) => item.build.status === "Stopped")) {
    return "stopped";
  }
  if (items.some((item) => item.build.status === "Success")) {
    return "success";
  }
  return "running";
}

function getBuildMiniStatusClass(status: RecentBuildRecord["status"]): string {
  if (status === "Failed") {
    return "failed";
  }
  if (status === "Stopped") {
    return "stopped";
  }
  if (status === "Success") {
    return "success";
  }
  return "running";
}

function useAppNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

function formatAppElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatBuildMiniElapsed(build: RecentBuildRecord, now: number): string {
  if (build.status !== "Running") {
    return build.duration;
  }

  const startedAt = new Date(build.startedAt).getTime();
  if (Number.isNaN(startedAt)) {
    return "--";
  }

  return formatAppElapsed(Math.max(0, Math.floor((now - startedAt) / 1000)));
}

function getSidebarProjectStatuses(
  summaries: ProjectDashboardSummary[],
  activeProjectState: ProjectRuntimeState | null,
  activeProjectId: string | null,
): Record<string, ServiceStatusRecord[]> {
  const statusesByProjectId: Record<string, ServiceStatusRecord[]> = {};

  summaries.forEach((summary) => {
    statusesByProjectId[summary.project.id] = summary.statuses;
  });

  if (activeProjectId && activeProjectState) {
    statusesByProjectId[activeProjectId] = activeProjectState.statuses;
  }

  return statusesByProjectId;
}

function getSidebarProjectFrontendEnabled(
  summaries: ProjectDashboardSummary[],
  activeProjectState: ProjectRuntimeState | null,
  activeProjectId: string | null,
): Record<string, boolean> {
  const enabledByProjectId: Record<string, boolean> = {};

  summaries.forEach((summary) => {
    enabledByProjectId[summary.project.id] = summary.frontendEnabled;
  });

  if (activeProjectId && activeProjectState) {
    enabledByProjectId[activeProjectId] = isProjectFrontendEnabled(
      activeProjectState.settings,
    );
  }

  return enabledByProjectId;
}

function getToolTitle(tool: ToolId): string {
  if (tool === "api-tester") {
    return "API Tester";
  }
  if (tool === "cryptographic") {
    return "Cryptographic";
  }
  return "Comparing";
}

function getToolDescription(tool: ToolId): string {
  if (tool === "api-tester") {
    return "Simple REST client for testing endpoints and inspecting JSON responses";
  }
  if (tool === "cryptographic") {
    return "Convert Base64, hash values, and translate Unicode code points.";
  }
  return "Compare two files or pasted text.";
}

function getBuildMiniPanelItems(
  summaries: ProjectDashboardSummary[],
  projects: Project[],
  dismissedRecordKeys: Set<string>,
  sessionStartedAt: number,
): BuildMiniPanelItem[] {
  const realItems = summaries
    .filter((summary) => summary.lastBuild)
    .map((summary) => ({
      project: summary.project,
      build: summary.lastBuild!,
    }));

  const debugItems = createDebugBuildMiniPanelItems(projects, summaries);
  const seen = new Set<string>();
  return [
    ...realItems,
    // ...debugItems
  ].filter((item) => {
    const key = getBuildMiniRecordKey(item);
    const startedAt = new Date(item.build.startedAt).getTime();
    if (
      item.build.status !== "Running" &&
      (Number.isNaN(startedAt) || startedAt < sessionStartedAt)
    ) {
      return false;
    }
    if (item.build.status !== "Running" && dismissedRecordKeys.has(key)) {
      return false;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createDebugBuildMiniPanelItems(
  projects: Project[],
  summaries: ProjectDashboardSummary[],
): BuildMiniPanelItem[] {
  const now = Date.now();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const candidates = [
    ...projects,
    ...summaries.map((summary) => summary.project),
  ].filter((project, index, allProjects) => {
    return allProjects.findIndex((item) => item.id === project.id) === index;
  });
  const debugProjects = candidates.slice(0, 2);

  return debugProjects.map((project, index) => {
    const normalizedProject = projectById.get(project.id) ?? project;
    const startedAt = new Date(now - (index + 2) * 73_000).toISOString();
    return {
      project: normalizedProject,
      debug: true,
      build: {
        id: `debug-running-build-${index + 1}`,
        branch: index === 0 ? "feature/api-tools" : "release/war-debug",
        commit: index === 0 ? "debug-a1b2c3" : "debug-d4e5f6",
        commitCleanliness: "clean",
        profile: index === 0 ? "local-war" : "sit-war",
        status: "Running",
        duration: "--:--",
        completed: "Running",
        startedAt,
        outcomeType: index === 0 ? "build-only" : "build-and-deploy",
      },
    };
  });
}

function applyDashboardEvent(
  current: ProjectRuntimeState | null,
  event: DashboardEvent,
): ProjectRuntimeState | null {
  if (!current) {
    return current;
  }

  if (event.type === "settings") {
    return { ...current, settings: event.settings };
  }

  if (event.type === "status") {
    return {
      ...current,
      statuses: [
        ...current.statuses.filter(
          (status) => status.service !== event.status.service,
        ),
        event.status,
      ],
    };
  }

  if (
    event.type === "log" ||
    event.type === "log-batch" ||
    event.type === "log-clear"
  ) {
    // Handled by the log store; never touch React state.
    return current;
  }
  if (event.type === "builds") {
    return { ...current, recentBuilds: event.builds };
  }

  if (event.type === "activity") {
    return { ...current, activityFeed: event.activityFeed };
  }

  return current;
}

function applyDashboardOverviewStatusEvent(
  current: ProjectDashboardSummary[],
  event: Extract<DashboardEvent, { type: "status" }>,
): ProjectDashboardSummary[] {
  let changed = false;
  const next = current.map((summary) => {
    if (summary.project.id !== event.projectId) {
      return summary;
    }

    changed = true;
    return {
      ...summary,
      statuses: [
        ...summary.statuses.filter(
          (status) => status.service !== event.status.service,
        ),
        event.status,
      ],
    };
  });

  return changed ? next : current;
}

function createLoadingProjectState(): ProjectRuntimeState {
  return {
    settings: {
      backendType: "wildfly",
      appLogFile: "",
      gitProjectDirectory: "",
      defaultBranch: "",
      remote: "",
      frontend: {
        enabled: false,
        path: "",
        installCommand: "",
        devCommand: "",
        buildCommand: "",
      },
      python: {
        enabled: true,
        serverType: "custom",
        directory: "",
        venvPath: "",
        installCommand: "pip install -r requirements.txt",
        startCommand: "",
        appUrl: "http://127.0.0.1:8000",
        healthCheckUrl: "",
        autoStart: false,
        buildCommand: "",
      },
      services: {
        frontend: {
          enabled: false,
          workingDirectory: "",
          command: "",
          healthUrl: "",
          appUrl: "",
          autoStart: false,
        },
        wildfly: {
          enabled: true,
          workingDirectory: "",
          command: "",
          healthUrl: "",
          appUrl: "",
          managementUrl: "",
          autoStart: false,
        },
        python: {
          enabled: true,
          workingDirectory: "",
          command: "",
          healthUrl: "",
          appUrl: "",
          autoStart: false,
        },
      },
      maven: {
        executable: "",
        settingsXml: "",
        pomXml: "",
        skipTests: false,
      },
      buildProfiles: [],
    },
    statuses: [],
    recentBuilds: [],
    activityFeed: [],
    pythonDependencies: [],
    gitStatus: {
      repository: "",
      branch: "",
      commit: "",
      status: "",
      lines: [],
    },
    logs: {
      frontend: [],
      wildfly: [],
      python: [],
      build: [],
      tail: [],
    },
  };
}

function ApiTesterHeaderTabs({
  activeView,
  onViewChange,
}: {
  activeView: ApiTesterView;
  onViewChange: (view: ApiTesterView) => void;
}): JSX.Element {
  return (
    <div
      className="tabs api-tester-header-tabs"
      role="tablist"
      aria-label="API tester sections"
    >
      <button
        className={`tab${activeView === "test" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "test"}
        onClick={() => onViewChange("test")}
      >
        API Test
      </button>
      <button
        className={`tab${activeView === "history" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "history"}
        onClick={() => onViewChange("history")}
      >
        History
      </button>
      <button
        className={`tab${activeView === "saved" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "saved"}
        onClick={() => onViewChange("saved")}
      >
        Saved
      </button>
    </div>
  );
}

function CompareHeaderTabs({
  activeView,
  onViewChange,
}: {
  activeView: CompareView;
  onViewChange: (view: CompareView) => void;
}): JSX.Element {
  return (
    <div
      className="tabs compare-header-tabs"
      role="tablist"
      aria-label="Compare sections"
    >
      <button
        className={`tab${activeView === "compare" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "compare"}
        onClick={() => onViewChange("compare")}
      >
        Compare
      </button>
    </div>
  );
}

function CryptographicHeaderTabs({
  activeView,
  onViewChange,
}: {
  activeView: CryptographicToolTab;
  onViewChange: (view: CryptographicToolTab) => void;
}): JSX.Element {
  return (
    <div
      className="tabs cryptographic-header-tabs"
      role="tablist"
      aria-label="Cryptographic sections"
    >
      <button
        className={`tab${activeView === "base64" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "base64"}
        onClick={() => onViewChange("base64")}
      >
        Base64
      </button>

      <button
        className={`tab${activeView === "hashing" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "hashing"}
        onClick={() => onViewChange("hashing")}
      >
        Hash
      </button>

      <button
        className={`tab${activeView === "unicode" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeView === "unicode"}
        onClick={() => onViewChange("unicode")}
      >
        Unicode
      </button>
    </div>
  );
}

function SingleToolHeaderTabs({ label }: { label: string }): JSX.Element {
  return (
    <div
      className="tabs single-tool-header-tabs"
      role="tablist"
      aria-label={label}
    >
      <button className="tab active" type="button" role="tab" aria-selected>
        {label}
      </button>
    </div>
  );
}

export default App;

function readStoredTheme(): Theme {
  const stored = window.localStorage.getItem("ivs-dashboard-theme");
  return stored === "dark" ? "dark" : "light";
}

function readStoredAccentColor(): AccentColor {
  const stored = window.localStorage.getItem("ivs-dashboard-accent");
  if (
    stored === "green" ||
    stored === "yellow" ||
    stored === "orange" ||
    stored === "purple" ||
    stored === "pink" ||
    stored === "black"
  ) {
    return stored;
  }

  return "blue";
}

function readStoredFontSizeMode(): FontSizeMode {
  const stored = window.localStorage.getItem("ivs-dashboard-font-size");
  if (
    stored === "50" ||
    stored === "70" ||
    stored === "90" ||
    stored === "100" ||
    stored === "120" ||
    stored === "140" ||
    stored === "160"
  ) {
    return stored;
  }

  if (stored === "180" || stored === "200") {
    return "160";
  }

  if (stored === "small") {
    return "90";
  }

  if (stored === "large") {
    return "120";
  }

  return "100";
}
