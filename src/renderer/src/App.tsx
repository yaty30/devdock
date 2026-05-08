import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { AddProjectDialog } from "./components/dialogs/AddProjectDialog";
import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { Modal } from "./components/dialogs/Modal";
import {
  HeaderActions,
  HeaderUtilityActions,
} from "./components/layout/HeaderActions";
import { Sidebar } from "./components/layout/Sidebar";
import { SegmentedTabs } from "./components/navigation/SegmentedTabs";
import {
  DatabaseConnectionModal,
  DatabaseWorkspace,
  DatabaseWorkspaceTabs,
} from "./features/databases";
import {
  DashboardContent,
  ProjectDashboardContent,
} from "./features/dashboard/DashboardContent";
import { GitTerminalTab } from "./features/git/GitTerminalTab";
import { MonitorTab } from "./features/monitor/MonitorTab";
import { NotesTab } from "./features/notes/NotesTab";
import { SettingsContent } from "./features/settings/SettingsContent";
import { appendLiveBatch, clearViewport } from "./hooks/useLogStore";
import closeMouthLogo from "./assets/close-mouth-logo.png";
import openMouthLogo from "./assets/open-mouth-logo.png";
import { MAX_PROJECTS } from "../../shared/appLimits";
import type {
  AppSection,
  DashboardTab,
  DashboardEvent,
  DatabaseConnection,
  DatabaseExecutionRecord,
  DatabaseWorkspaceTab,
  FontSizeMode,
  Project,
  ProjectDashboardSummary,
  ProjectRuntimeState,
  ShutdownEntry,
  Theme,
} from "./types";

const SPLASH_READY_FRAME_MS = 800;
const SPLASH_FADE_OUT_MS = 1100;
const SPLASH_LOGO_SIZE = "min(90px, 11vw)";
const DATABASE_IDLE_DISCONNECT_MS = 2 * 60 * 1000;

type SplashFrame = "open" | "close";
type SplashPhase = "visible" | "exiting" | "hidden";
type SnackbarState = {
  message: string;
  tone: "valid" | "invalid" | "warning";
};
type DatabaseRuntimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "sleeping"
  | "disconnected"
  | "reconnecting"
  | "error";

function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<DashboardTab>("dashboard");
  const [activeSection, setActiveSection] = useState<AppSection>("dashboard");
  const [projects, setProjects] = useState<Project[]>([]);
  const [databaseConnections, setDatabaseConnections] = useState<
    DatabaseConnection[]
  >([]);
  const [databaseConnectionModal, setDatabaseConnectionModal] = useState<
    "add" | "edit" | null
  >(null);
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
  const [fontSizeMode, setFontSizeMode] = useState<FontSizeMode>(() =>
    readStoredFontSizeMode(),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [splashFrame, setSplashFrame] = useState<SplashFrame>("close");
  const [splashPhase, setSplashPhase] = useState<SplashPhase>("visible");
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const [snackbarClosing, setSnackbarClosing] = useState(false);
  const projectLoadingTimerRef = useRef<number | null>(null);
  const projectSwitchStartedAtRef = useRef<number | null>(null);
  const splashSequenceStartedRef = useRef(false);
  const selectedProjectIdRef = useRef<string | null>(null);
  const dashboardOverviewRequestRef = useRef(0);
  const snackbarDismissTimerRef = useRef<number | null>(null);
  const snackbarCloseTimerRef = useRef<number | null>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const sidebarTransitionReadyRef = useRef(false);
  const databaseSleepTimerRef = useRef<number | null>(null);
  const hadDatabaseConnectionRef = useRef(false);

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
    async function loadInitialState(): Promise<void> {
      const snapshot = await window.ivsDashboard.getSnapshot();
      const connections = await window.ivsDashboard.getDatabaseConnections();
      const executionHistory =
        await window.ivsDashboard.getDatabaseExecutionHistory();
      if (cancelled) {
        return;
      }
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
      setInitialStateLoaded(true);
      setProjectLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("ivs-dashboard-theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
    setProjectLoading(true);
    window.ivsDashboard
      .getProjectState(selectedProject.id)
      .then((nextState) => {
        if (!cancelled) {
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
          setProjectLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProject, activeSection]);

  useEffect(() => {
    const unsubscribe = window.ivsDashboard.onEvent((event) => {
      if (
        event.type === "status" ||
        event.type === "builds" ||
        event.type === "settings"
      ) {
        void refreshDashboardOverview();
      }

      if (event.projectId !== selectedProjectIdRef.current) {
        return;
      }
      // Log events go to the log store; they never touch React project state.
      if (event.type === "log-batch") {
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

    return () => {
      unsubscribe();
      unsubShutdownStarted();
      unsubShutdownStopped();
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
    setSplashFrame("open");

    const timers = [
      window.setTimeout(() => setSplashFrame("close"), SPLASH_READY_FRAME_MS),
      window.setTimeout(
        () => setSplashPhase("exiting"),
        SPLASH_READY_FRAME_MS * 2,
      ),
      window.setTimeout(
        () => setSplashPhase("hidden"),
        SPLASH_READY_FRAME_MS * 2 + SPLASH_FADE_OUT_MS,
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

  function switchDatabaseConnection(connection: DatabaseConnection): void {
    const doSwitch = (): void => {
      setSelectedDatabaseConnectionId(connection.id);
      setDatabaseConnections((current) =>
        current.map((item) =>
          item.id === connection.id ? { ...item, status: "connected" } : item,
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
    hadDatabaseConnectionRef.current = true;
    setDatabaseConnections((current) =>
      current.map((item) =>
        item.id === connection.id ? { ...item, status: "connected" } : item,
      ),
    );
    setSelectedDatabaseConnectionId(connection.id);
    setActiveDatabaseTab("connection");
    setActiveSection("database");
    setDatabaseRuntimeStatus("connected");
    showSnackbar(`${connection.name} connected.`, "valid");
    void window.ivsDashboard
      .updateDatabaseConnectionSettings(connection.id, {
        autoConnect: true,
        status: "connected",
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
  ): Promise<boolean> {
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    const errors: string[] = [];

    if (!trimmedName) {
      errors.push("Project name is required");
    } else if (trimmedName.length > 20) {
      errors.push("Project name must be 20 characters or fewer");
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
        <div
          className={`splash-logo-stack showing-${splashFrame}`}
          style={{ width: SPLASH_LOGO_SIZE }}
        >
          <img
            className="splash-logo splash-logo-open"
            src={openMouthLogo}
            alt=""
          />
          <img
            className="splash-logo splash-logo-close"
            src={closeMouthLogo}
            alt=""
          />
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

  if (!selectedProject && !initialStateLoaded) {
    return (
      <div
        ref={appShellRef}
        className="app-shell"
        data-theme={theme}
        data-font-size={fontSizeMode}
      >
        <main className="main-content project-loading">
          <header className="main-header">
            <div>
              <h1>IVS Dashboard</h1>
              <p>Loading project configuration.</p>
            </div>
          </header>
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
          theme={theme}
          collapsed={sidebarCollapsed}
          onProjectChange={switchProject}
          onDatabaseConnectionChange={switchDatabaseConnection}
          onDatabaseConnect={connectDatabaseConnection}
          onDatabaseDisconnect={disconnectDatabaseConnection}
          onSectionChange={handleSectionChange}
          onAddProject={openAddProjectDialog}
          onAddDatabaseConnection={handleAddDatabaseConnection}
          onCollapseToggle={() => setSidebarCollapsed((current) => !current)}
          onThemeToggle={() =>
            setTheme((current) => (current === "light" ? "dark" : "light"))
          }
        />
        <main className="main-content">
          <header className="main-header">
            {activeSection === "database" && selectedDatabaseConnection ? (
              <div className="database-header-title">
                <DatabaseWorkspaceTabs
                  connectionName={selectedDatabaseConnection.name}
                  activeTab={activeDatabaseTab}
                  onTabChange={setActiveDatabaseTab}
                />
              </div>
            ) : activeSection === "database" ? (
              <div>
                <h1>Databases</h1>
                <p>Create a connection to browse objects and run SQL.</p>
              </div>
            ) : (
              <div>
                <h1>Overview</h1>
                <p>All project server status and last build results.</p>
              </div>
            )}
            {activeSection === "database" && selectedDatabaseConnection ? (
              <DatabaseHeaderActions
                connection={selectedDatabaseConnection}
                databaseStatus={databaseRuntimeStatus}
                fontSizeMode={fontSizeMode}
                onFontSizeChange={setFontSizeMode}
                onSettingsClick={openDatabaseConnectionSettings}
              />
            ) : null}
          </header>

          {activeSection === "database" ? (
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
        {databaseDeleteDialog}
        {splashOverlay}
      </div>
    );
  }

  return (
    <div
      ref={appShellRef}
      className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      data-theme={theme}
      data-font-size={fontSizeMode}
    >
      <Sidebar
        projects={projects}
        databaseConnections={databaseConnections}
        selectedProjectId={selectedProject.id}
        selectedDatabaseConnectionId={selectedDatabaseConnectionId}
        activeSection={activeSection}
        theme={theme}
        collapsed={sidebarCollapsed}
        onProjectChange={switchProject}
        onDatabaseConnectionChange={switchDatabaseConnection}
        onDatabaseConnect={connectDatabaseConnection}
        onDatabaseDisconnect={disconnectDatabaseConnection}
        onSectionChange={handleSectionChange}
        onAddProject={openAddProjectDialog}
        onAddDatabaseConnection={handleAddDatabaseConnection}
        onCollapseToggle={() => setSidebarCollapsed((current) => !current)}
        onThemeToggle={() =>
          setTheme((current) => (current === "light" ? "dark" : "light"))
        }
      />
      <main
        className={`main-content${
          activeSection === "project" && projectLoading
            ? " project-loading"
            : ""
        }`}
      >
        <header className="main-header">
          {activeSection === "dashboard" ? (
            <div>
              <h1>Overview</h1>
              <p>All project server status and last build results.</p>
            </div>
          ) : activeSection === "database" && selectedDatabaseConnection ? (
            <div className="database-header-title">
              <DatabaseWorkspaceTabs
                connectionName={selectedDatabaseConnection.name}
                activeTab={activeDatabaseTab}
                onTabChange={setActiveDatabaseTab}
              />
            </div>
          ) : activeSection === "database" ? (
            <div>
              <h1>Databases</h1>
              <p>Create a connection to browse objects and run SQL.</p>
            </div>
          ) : (
            <SegmentedTabs activeTab={activeTab} onTabChange={setActiveTab} />
          )}
          {activeSection === "project" ? (
            activeProjectState ? (
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
                onServiceWarning={(message) => showSnackbar(message, "invalid")}
              />
            ) : null
          ) : activeSection === "database" && selectedDatabaseConnection ? (
            <DatabaseHeaderActions
              connection={selectedDatabaseConnection}
              databaseStatus={databaseRuntimeStatus}
              fontSizeMode={fontSizeMode}
              onFontSizeChange={setFontSizeMode}
              onSettingsClick={openDatabaseConnectionSettings}
            />
          ) : null}
        </header>

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
              <NotesTab projectId={selectedProject.id} />
            ) : null}
          </>
        ) : null}
      </main>

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

      {addProjectOpen ? (
        <AddProjectDialog
          onCreate={handleCreateProject}
          onClose={() => setAddProjectOpen(false)}
        />
      ) : null}

      {databaseConnectionDialog}

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
                        {entry.service === "wildfly" ? "WildFly" : "Frontend"}
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

function createLoadingProjectState(): ProjectRuntimeState {
  return {
    settings: {
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
          autoStart: false,
        },
        wildfly: {
          workingDirectory: "",
          command: "",
          healthUrl: "",
          appUrl: "",
          managementUrl: "",
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
      build: [],
      tail: [],
    },
  };
}

export default App;

function readStoredTheme(): Theme {
  const stored = window.localStorage.getItem("ivs-dashboard-theme");
  return stored === "dark" ? "dark" : "light";
}

function readStoredFontSizeMode(): FontSizeMode {
  const stored = window.localStorage.getItem("ivs-dashboard-font-size");
  return stored === "large" || stored === "small" ? stored : "regular";
}
