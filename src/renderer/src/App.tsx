import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import { AddProjectDialog } from "./components/dialogs/AddProjectDialog";
import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { InterfaceSettingsModal } from "./components/dialogs/InterfaceSettingsModal";
import { Modal } from "./components/dialogs/Modal";
import { AppHeader } from "./components/layout/AppHeader";
import {
  FontSizeDropdown,
  HeaderActions,
} from "./components/layout/HeaderActions";
import { AppSnackbar } from "./components/common/AppSnackbar";
import {
  BuildMiniPanel,
  getBuildMiniRecordKey,
  type BuildMiniPanelItem,
} from "./components/common/BuildMiniPanel";
import { NotesHeaderActions } from "./components/common/NotesHeaderActions";
import { ShutdownOverlay } from "./components/common/ShutdownOverlay";
import { SplashOverlay } from "./components/common/SplashOverlay";
import { Sidebar } from "./components/layout/Sidebar";
import {
  DatabaseConnectionModal,
  DatabaseEmptyState,
  DatabaseHeaderActions,
  DatabaseWorkspace,
  DatabaseWorkspaceTabs,
  useDatabaseController,
} from "./features/databases";
import { ProjectEnvFilesModal } from "./features/env/ProjectEnvFilesModal";
import {
  DashboardContent,
  ProjectDashboardContent,
} from "./features/dashboard/DashboardContent";
import {
  applyDashboardEvent,
  applyDashboardOverviewStatusEvent,
  createLoadingProjectState,
  getBuildMiniPanelItems,
  getSidebarProjectFrontendEnabled,
  getSidebarProjectStatuses,
} from "./features/dashboard/dashboardState";
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
  ApiTesterHeaderTabs,
  CompareHeaderTabs,
  CryptographicHeaderTabs,
  SingleToolHeaderTabs,
  type ApiTesterView,
  type CompareView,
} from "./features/tools/ToolHeaderTabs";
import { useSshController } from "./features/tools/useSshController";
import { ChatFeature } from "./features/chat/ChatDrawer";
import { usePreferences } from "./hooks/usePreferences";
import { appendLiveBatch, clearViewport } from "./hooks/useLogStore";
import { useSnackbar } from "./hooks/useSnackbar";
import { APP_FEATURE_FLAGS } from "../../shared/appFeatures";
import { MAX_PROJECTS } from "../../shared/appLimits";
import type {
  AppSection,
  BackendType,
  DashboardTab,
  LogChannel,
  Project,
  ProjectDashboardSummary,
  ProjectRecord,
  ProjectRuntimeState,
  PythonServerType,
  ShutdownEntry,
  ToolId,
} from "./types";

const SPLASH_READY_FRAME_MS = 800;
const SPLASH_EXIT_HOLD_MS = 800;
const SPLASH_FADE_OUT_MS = 420;
const SPLASH_LOGO_SIZE = "min(66px, 7vw)";
const INITIAL_STATE_LOAD_TIMEOUT_MS = 10000;
const PROJECT_STATE_LOAD_TIMEOUT_MS = 8000;
const PROJECT_DASHBOARD_EXIT_LOG_CHANNELS: LogChannel[] = [
  "frontend",
  "build",
  "wildfly",
  "python",
];
const STANDALONE_NOTEBOOK_PROJECT_ID = "__ivs_standalone_notebook__";

type SplashPhase = "visible" | "exiting" | "hidden";

const IS_MACOS =
  typeof navigator !== "undefined" &&
  navigator.platform.toLowerCase().includes("mac");

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [cookieModalOpen, setCookieModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
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
  const {
    theme,
    accentColor,
    fontSizeMode,
    setTheme,
    setAccentColor,
    setFontSizeMode,
  } = usePreferences();
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
  const { snackbar, snackbarClosing, showSnackbar, dismissSnackbar } =
    useSnackbar();
  const [chatEnabled, setChatEnabled] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [macosWindowFullscreen, setMacosWindowFullscreen] = useState(false);
  const [buildMiniPanelMinimized, setBuildMiniPanelMinimized] = useState(false);
  const [dismissedBuildMiniRecordKeys, setDismissedBuildMiniRecordKeys] =
    useState<Set<string>>(() => new Set());
  const projectLoadingTimerRef = useRef<number | null>(null);
  const projectSwitchStartedAtRef = useRef<number | null>(null);
  const splashSequenceStartedRef = useRef(false);
  const selectedProjectIdRef = useRef<string | null>(null);
  const dashboardOverviewRequestRef = useRef(0);
  const buildMiniPanelBuildIdRef = useRef<string | null>(null);
  const buildMiniPanelSessionStartedAtRef = useRef(Date.now());
  const appExitStartedRef = useRef(false);
  const appShellRef = useRef<HTMLDivElement>(null);
  const sidebarTransitionReadyRef = useRef(false);

  const handleUnavailableSshRoute = useCallback(() => {
    setActiveTool("comparing");
    setActiveSection("dashboard");
  }, []);
  const ssh = useSshController({
    enabled: APP_FEATURE_FLAGS.ssh,
    routeActive: activeSection === "tools" && activeTool === "ssh",
    onUnavailableRoute: handleUnavailableSshRoute,
  });
  const database = useDatabaseController({
    activeSection,
    settingsDirty,
    settingsOpen,
    setActiveSection,
    setPendingNav,
    setSettingsDirty,
    setSettingsOpen,
    showSnackbar,
  });

  useEffect(() => {
    if (!IS_MACOS) {
      return undefined;
    }

    void window.ivsDashboard.isWindowMaximized().then(setMacosWindowFullscreen);
    return window.ivsDashboard.onWindowMaximizedChange(
      setMacosWindowFullscreen,
    );
  }, []);

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
      setProjects(snapshot.projects);
      database.hydrateConnections(connections, executionHistory);
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
    if (tool === "ssh" && !APP_FEATURE_FLAGS.ssh) {
      setSettingsOpen(false);
      setActiveTool("comparing");
      setActiveSection("dashboard");
      showSnackbar("SSH is currently unavailable.", "warning");
      return;
    }

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
      <SplashOverlay phase={splashPhase} logoSize={SPLASH_LOGO_SIZE} />
    ) : null;

  const databaseConnectionDialog = (
    <DatabaseConnectionModal
      open={
        database.connectionModal !== null &&
        (database.connectionModal !== "edit" ||
          database.selectedConnection !== null)
      }
      mode={database.connectionModal ?? "add"}
      connection={
        database.connectionModal === "edit" ? database.selectedConnection : null
      }
      connections={database.connections}
      onClose={() => database.closeConnectionModal()}
      onSave={database.saveConnection}
      onTestStatus={showSnackbar}
      onDeleteRequest={database.requestDeleteConnection}
    />
  );

  const databaseDeleteDialog = database.deleteConnectionRequest ? (
    <ConfirmDialog
      title="Delete Database Connection?"
      message={`Deleting "${database.deleteConnectionRequest.name}" will remove its saved sheets, query results, metadata cache, and query history from this workspace. Other projects and database connections will not be changed.`}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      variant="danger"
      onClose={() => database.setDeleteConnectionRequest(null)}
      onConfirm={() => void database.confirmDeleteConnection()}
    />
  ) : null;
  const SshHeaderActionsComponent = ssh.featureModule?.SshHeaderActions;
  const SshHeaderTabsComponent = ssh.featureModule?.SshHeaderTabs;
  const SshSettingsModalComponent = ssh.featureModule?.SshSettingsModal;
  const SshToolComponent = ssh.featureModule?.SshTool;
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
  const sshSettingsModal =
    APP_FEATURE_FLAGS.ssh && SshSettingsModalComponent ? (
      <SshSettingsModalComponent
        open={ssh.settingsOpen}
        servers={ssh.servers}
        selectedServerId={ssh.selectedServerId}
        connectionStatus={ssh.connectionStatus}
        credentialRequired={ssh.settingsRequired}
        onSave={ssh.saveServers}
        onClose={ssh.closeSettings}
      />
    ) : null;
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
  const nativeWindowClass = IS_MACOS
    ? ` macos-native-window${macosWindowFullscreen ? " macos-window-fullscreen" : ""}`
    : "";
  if (!selectedProject && !initialStateLoaded) {
    return (
      <div
        ref={appShellRef}
        className={`app-shell no-sidebar${nativeWindowClass}`}
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
        className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${nativeWindowClass}`}
        data-theme={theme}
        data-accent={accentColor}
        data-font-size={fontSizeMode}
      >
        <Sidebar
          projects={projects}
          databaseConnections={database.connections}
          selectedProjectId=""
          selectedDatabaseConnectionId={database.selectedConnectionId}
          activeSection={
            activeSection === "project" ? "dashboard" : activeSection
          }
          activeTool={activeTool}
          collapsed={sidebarCollapsed}
          debugEnabled={debugEnabled}
          onProjectChange={switchProject}
          onDatabaseConnectionChange={database.switchConnection}
          onDatabaseConnect={database.connectConnection}
          onDatabaseDisconnect={database.disconnectConnection}
          onSectionChange={handleSectionChange}
          onToolChange={handleToolChange}
          onAddProject={openAddProjectDialog}
          onAddDatabaseConnection={database.openAddConnection}
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
                    <NotesHeaderActions
                      view={notebookView}
                      onAdd={() =>
                        setNotebookAddRequestId((current) => current + 1)
                      }
                      onToggleView={() =>
                        setNotebookView((current) =>
                          current === "grid" ? "list" : "grid",
                        )
                      }
                    />
                    <FontSizeDropdown
                      value={fontSizeMode}
                      onChange={setFontSizeMode}
                    />
                  </>
                ) : APP_FEATURE_FLAGS.ssh &&
                  activeSection === "tools" &&
                  activeTool === "ssh" &&
                  SshHeaderActionsComponent ? (
                  <SshHeaderActionsComponent
                    servers={ssh.servers}
                    selectedServerId={ssh.selectedServerId}
                    fontSizeMode={fontSizeMode}
                    disabled={!ssh.hasValidCredential}
                    connectionStatus={ssh.connectionStatus}
                    onServerChange={ssh.setSelectedServerId}
                    onConnectionToggle={ssh.handleConnectionToggle}
                    onSettingsClick={() => ssh.openSettings()}
                    onFontSizeChange={setFontSizeMode}
                  />
                ) : activeSection === "tools" ? (
                  <FontSizeDropdown
                    value={fontSizeMode}
                    onChange={setFontSizeMode}
                  />
                ) : activeSection === "database" &&
                  database.selectedConnection ? (
                  <DatabaseHeaderActions
                    connection={database.selectedConnection}
                    databaseStatus={database.runtimeStatus}
                    fontSizeMode={fontSizeMode}
                    onFontSizeChange={setFontSizeMode}
                    onSettingsClick={database.openConnectionSettings}
                  />
                ) : null}
                {chatFeature}
              </>
            }
          >
            {activeSection === "database" && database.selectedConnection ? (
              <DatabaseWorkspaceTabs
                connectionName={database.selectedConnection.name}
                activeTab={database.activeTab}
                onTabChange={database.setActiveTab}
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
            ) : APP_FEATURE_FLAGS.ssh &&
              activeSection === "tools" &&
              activeTool === "ssh" &&
              SshHeaderTabsComponent ? (
              <SshHeaderTabsComponent
                activeTab={ssh.activeTab}
                onTabChange={ssh.setActiveTab}
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
            ) : APP_FEATURE_FLAGS.ssh &&
              activeTool === "ssh" &&
              SshToolComponent ? (
              <SshToolComponent
                selectedServer={ssh.selectedServer}
                activeTab={ssh.activeTab}
                disabled={!ssh.hasValidCredential}
                connectionStatus={ssh.connectionStatus}
                reconnectAttempt={ssh.reconnectAttempt}
                reconnectMaxAttempts={
                  ssh.selectedServer?.maxReconnectAttempts ?? 0
                }
                terminalConnectionEnabled={ssh.terminalConnectionEnabled}
                terminalConnectionSignal={ssh.terminalConnectionSignal}
                sshSessionId={ssh.activeSessionId}
                remoteCwd={ssh.remoteCwd}
                sftpStatus={ssh.sftpConnectionStatus}
                sftpError={ssh.sftpConnectionError}
                onConfigure={() => ssh.openSettings()}
                onCommandSubmit={ssh.handleCommandSubmit}
                onTerminalConnectionStatusChange={
                  ssh.handleTerminalConnectionStatusChange
                }
                onTerminalHostChange={ssh.handleTerminalHostChange}
              />
            ) : (
              <CryptographicTool
                activeTab={cryptoActiveTab}
                onFeedback={showSnackbar}
              />
            )
          ) : activeSection === "database" ? (
            database.selectedConnection ? (
              <DatabaseWorkspace
                connection={database.selectedConnection}
                activeTab={database.activeTab}
                databaseStatus={database.runtimeStatus}
                onTabChange={database.setActiveTab}
                executionHistory={database.selectedExecutionHistory}
                queryCount={database.selectedExecutionHistory.length}
                lastRefreshTime={database.lastRefreshTime}
                onExecution={database.handleExecution}
                onRefresh={database.refreshMetadata}
                onSheetSaved={() => showSnackbar("Sheet saved", "valid")}
                deletedConnectionId={database.deletedConnectionId}
              />
            ) : (
              <DatabaseEmptyState onCreate={database.openAddConnection} />
            )
          ) : (
            <DashboardContent
              projects={dashboardOverview}
              databaseConnections={database.connections}
              loading={dashboardOverviewLoading}
            />
          )}
        </main>
        {snackbar ? (
          <AppSnackbar
            message={snackbar.message}
            tone={snackbar.tone}
            closing={snackbarClosing}
          />
        ) : null}
        {addProjectOpen ? (
          <AddProjectDialog
            onCreate={handleCreateProject}
            onClose={() => setAddProjectOpen(false)}
          />
        ) : null}
        {databaseConnectionDialog}
        {sshSettingsModal}
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
      className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${nativeWindowClass}`}
      data-theme={theme}
      data-accent={accentColor}
      data-font-size={fontSizeMode}
    >
      <Sidebar
        projects={projects}
        databaseConnections={database.connections}
        selectedProjectId={selectedProject.id}
        selectedDatabaseConnectionId={database.selectedConnectionId}
        activeSection={activeSection}
        activeTool={activeTool}
        collapsed={sidebarCollapsed}
        projectStatuses={sidebarProjectStatuses}
        projectFrontendEnabled={sidebarProjectFrontendEnabled}
        debugEnabled={debugEnabled}
        onProjectChange={switchProject}
        onDatabaseConnectionChange={database.switchConnection}
        onDatabaseConnect={database.connectConnection}
        onDatabaseDisconnect={database.disconnectConnection}
        onSectionChange={handleSectionChange}
        onToolChange={handleToolChange}
        onAddProject={openAddProjectDialog}
        onAddDatabaseConnection={database.openAddConnection}
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
                      <NotesHeaderActions
                        view={notesView}
                        disabled={projectLoading}
                        onAdd={() =>
                          setNotesAddRequestId((current) => current + 1)
                        }
                        onToggleView={() =>
                          setNotesView((current) =>
                            current === "grid" ? "list" : "grid",
                          )
                        }
                      />
                    ) : undefined
                  }
                  onServiceWarning={(message) =>
                    showSnackbar(message, "invalid")
                  }
                />
              ) : activeSection === "database" &&
                database.selectedConnection ? (
                <DatabaseHeaderActions
                  connection={database.selectedConnection}
                  databaseStatus={database.runtimeStatus}
                  fontSizeMode={fontSizeMode}
                  onFontSizeChange={setFontSizeMode}
                  onSettingsClick={database.openConnectionSettings}
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
                  <NotesHeaderActions
                    view={notebookView}
                    onAdd={() =>
                      setNotebookAddRequestId((current) => current + 1)
                    }
                    onToggleView={() =>
                      setNotebookView((current) =>
                        current === "grid" ? "list" : "grid",
                      )
                    }
                  />
                  <FontSizeDropdown
                    value={fontSizeMode}
                    onChange={setFontSizeMode}
                  />
                </>
              ) : APP_FEATURE_FLAGS.ssh &&
                activeSection === "tools" &&
                activeTool === "ssh" &&
                SshHeaderActionsComponent ? (
                <SshHeaderActionsComponent
                  servers={ssh.servers}
                  selectedServerId={ssh.selectedServerId}
                  fontSizeMode={fontSizeMode}
                  disabled={!ssh.hasValidCredential}
                  connectionStatus={ssh.connectionStatus}
                  onServerChange={ssh.setSelectedServerId}
                  onConnectionToggle={ssh.handleConnectionToggle}
                  onSettingsClick={() => ssh.openSettings()}
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
          {activeSection === "database" && database.selectedConnection ? (
            <DatabaseWorkspaceTabs
              connectionName={database.selectedConnection.name}
              activeTab={database.activeTab}
              onTabChange={database.setActiveTab}
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
          ) : APP_FEATURE_FLAGS.ssh &&
            activeSection === "tools" &&
            activeTool === "ssh" &&
            SshHeaderTabsComponent ? (
            <SshHeaderTabsComponent
              activeTab={ssh.activeTab}
              onTabChange={ssh.setActiveTab}
            />
          ) : null}
        </AppHeader>

        {activeSection === "dashboard" ? (
          <DashboardContent
            projects={dashboardOverview}
            databaseConnections={database.connections}
            loading={dashboardOverviewLoading}
          />
        ) : activeSection === "database" ? (
          database.selectedConnection ? (
            <DatabaseWorkspace
              connection={database.selectedConnection}
              activeTab={database.activeTab}
              databaseStatus={database.runtimeStatus}
              onTabChange={database.setActiveTab}
              executionHistory={database.selectedExecutionHistory}
              queryCount={database.selectedExecutionHistory.length}
              lastRefreshTime={database.lastRefreshTime}
              onExecution={database.handleExecution}
              onRefresh={database.refreshMetadata}
              onSheetSaved={() => showSnackbar("Sheet saved", "valid")}
              deletedConnectionId={database.deletedConnectionId}
            />
          ) : (
            <DatabaseEmptyState onCreate={database.openAddConnection} />
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
          ) : APP_FEATURE_FLAGS.ssh &&
            activeTool === "ssh" &&
            SshToolComponent ? (
            <SshToolComponent
              selectedServer={ssh.selectedServer}
              activeTab={ssh.activeTab}
              disabled={!ssh.hasValidCredential}
              connectionStatus={ssh.connectionStatus}
              reconnectAttempt={ssh.reconnectAttempt}
              reconnectMaxAttempts={
                ssh.selectedServer?.maxReconnectAttempts ?? 0
              }
              terminalConnectionEnabled={ssh.terminalConnectionEnabled}
              terminalConnectionSignal={ssh.terminalConnectionSignal}
              sshSessionId={ssh.activeSessionId}
              remoteCwd={ssh.remoteCwd}
              sftpStatus={ssh.sftpConnectionStatus}
              sftpError={ssh.sftpConnectionError}
              onConfigure={() => ssh.openSettings()}
              onCommandSubmit={ssh.handleCommandSubmit}
              onTerminalConnectionStatusChange={
                ssh.handleTerminalConnectionStatusChange
              }
              onTerminalHostChange={ssh.handleTerminalHostChange}
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

      {sshSettingsModal}

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
        <AppSnackbar
          message={snackbar.message}
          tone={snackbar.tone}
          closing={snackbarClosing}
          onClick={dismissSnackbar}
        />
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
        <ShutdownOverlay
          entries={shutdownEntries}
          stoppedServices={stoppedServices}
        />
      ) : null}
      {splashOverlay}
    </div>
  );
}

export default App;
