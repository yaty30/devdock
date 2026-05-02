import { useEffect, useRef, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { AddProjectDialog } from "./components/dialogs/AddProjectDialog";
import { ConfirmDialog } from "./components/dialogs/ConfirmDialog";
import { HeaderActions } from "./components/layout/HeaderActions";
import { Sidebar } from "./components/layout/Sidebar";
import { SegmentedTabs } from "./components/navigation/SegmentedTabs";
import {
  DashboardContent,
  ProjectDashboardContent,
} from "./features/dashboard/DashboardContent";
import { GitTerminalTab } from "./features/git/GitTerminalTab";
import { MonitorTab } from "./features/monitor/MonitorTab";
import { SettingsContent } from "./features/settings/SettingsContent";
import { appendLiveBatch, clearViewport } from "./hooks/useLogStore";
import closeMouthLogo from "./assets/close-mouth-logo.png";
import openMouthLogo from "./assets/open-mouth-logo.png";
import type {
  AppSection,
  DashboardTab,
  DashboardEvent,
  Project,
  ProjectDashboardSummary,
  ProjectRuntimeState,
  ShutdownEntry,
  Theme,
} from "./types";

const SPLASH_READY_FRAME_MS = 800;
const SPLASH_FADE_OUT_MS = 1100;
const SPLASH_LOGO_SIZE = "min(90px, 11vw)";

type SplashFrame = "open" | "close";
type SplashPhase = "visible" | "exiting" | "hidden";

function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<DashboardTab>("dashboard");
  const [activeSection, setActiveSection] = useState<AppSection>("dashboard");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectState, setProjectState] = useState<ProjectRuntimeState | null>(
    null,
  );
  const [dashboardOverview, setDashboardOverview] = useState<
    ProjectDashboardSummary[]
  >([]);
  const [projectStateProjectId, setProjectStateProjectId] = useState<
    string | null
  >(null);
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
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
  const projectLoadingTimerRef = useRef<number | null>(null);
  const projectSwitchStartedAtRef = useRef<number | null>(null);
  const splashSequenceStartedRef = useRef(false);
  const selectedProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadInitialState(): Promise<void> {
      const snapshot = await window.ivsDashboard.getSnapshot();
      if (cancelled) {
        return;
      }
      setProjects(snapshot.projects);
      void refreshDashboardOverview();
      const active =
        snapshot.projects.find(
          (project) => project.id === snapshot.activeProjectId,
        ) ??
        snapshot.projects[0] ??
        null;
      setSelectedProject(active);
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
  }, [theme]);

  useEffect(() => {
    if (!selectedProject) {
      return undefined;
    }

    selectedProjectIdRef.current = selectedProject.id;
    if (activeSection === "dashboard") {
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
    };
  }, []);

  const activeProjectState =
    projectStateProjectId === selectedProject?.id ? projectState : null;

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
      if (settingsDirty && activeSection === "settings") {
        setPendingNav(() => () => {
          setActiveSection("project");
          setSettingsDirty(false);
        });
        return;
      }
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
      setSettingsDirty(false);
      setActiveSection("project");
    };

    if (settingsDirty && activeSection === "settings") {
      setPendingNav(() => doSwitch);
      return;
    }

    doSwitch();
  }

  function handleSectionChange(section: AppSection): void {
    if (
      settingsDirty &&
      activeSection === "settings" &&
      section !== "settings"
    ) {
      setPendingNav(() => () => {
        setActiveSection(section);
        setSettingsDirty(false);
      });
      return;
    }
    setActiveSection(section);
  }

  function refreshDashboardOverview(): Promise<void> {
    return window.ivsDashboard
      .getDashboardOverview()
      .then((overview) => setDashboardOverview(overview))
      .catch((error) => console.error(error));
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

  if (!selectedProject) {
    return (
      <div className="app-shell" data-theme={theme}>
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

  return (
    <div
      className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      data-theme={theme}
    >
      <Sidebar
        projects={projects}
        selectedProjectId={selectedProject.id}
        activeSection={activeSection}
        theme={theme}
        collapsed={sidebarCollapsed}
        onProjectChange={switchProject}
        onSectionChange={handleSectionChange}
        onAddProject={() => setAddProjectOpen(true)}
        onCollapseToggle={() => setSidebarCollapsed((current) => !current)}
        onThemeToggle={() =>
          setTheme((current) => (current === "light" ? "dark" : "light"))
        }
      />
      <main
        className={`main-content${projectLoading ? " project-loading" : ""}`}
      >
        <header className="main-header">
          <div>
            <h1>
              {activeSection === "dashboard"
                ? "Overview"
                : activeSection === "project"
                  ? selectedProject.name
                  : "Settings"}
            </h1>
            <p>
              {activeSection === "dashboard"
                ? "All project server status and last build results."
                : activeSection === "project"
                  ? "Monitor services, run builds, and review deployment status."
                  : "Configure project paths, services, Git, and build profiles."}
            </p>
          </div>
          {activeSection === "project" ? (
            activeProjectState ? (
              <HeaderActions
                disabled={projectLoading}
                projectId={selectedProject.id}
                settings={activeProjectState.settings}
                statuses={activeProjectState.statuses}
                recentBuilds={activeProjectState.recentBuilds}
                gitStatus={activeProjectState.gitStatus}
              />
            ) : null
          ) : null}
        </header>

        {activeSection === "dashboard" ? (
          <DashboardContent projects={dashboardOverview} />
        ) : !activeProjectState ? (
          <section className="resizable-panel-screen">
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title-group">
                  <h2>Loading Project</h2>
                </div>
              </div>
            </div>
          </section>
        ) : activeSection === "project" ? (
          <>
            <div className="tab-toolbar">
              <SegmentedTabs activeTab={activeTab} onTabChange={setActiveTab} />
              {activeTab === "dashboard" || activeTab === "monitor" ? (
                <button
                  className="reset-panels-button"
                  type="button"
                  onClick={() => setPanelResetVersion((version) => version + 1)}
                >
                  <RotateCcw size={14} />
                  Reset panels
                </button>
              ) : null}
            </div>
            {activeTab === "dashboard" ? (
              <ProjectDashboardContent
                projectId={selectedProject.id}
                resetVersion={panelResetVersion}
                projectState={activeProjectState}
              />
            ) : null}
            {activeTab === "monitor" ? (
              <MonitorTab
                resetVersion={panelResetVersion}
                projectState={activeProjectState}
                projectId={selectedProject.id}
              />
            ) : null}
            {activeTab === "git-terminal" ? (
              <GitTerminalTab
                projectId={selectedProject.id}
                gitStatus={activeProjectState.gitStatus}
              />
            ) : null}
          </>
        ) : (
          <SettingsContent
            selectedProject={selectedProject}
            settings={activeProjectState.settings}
            onSettingsSaved={(settings) =>
              setProjectState((current) =>
                current ? { ...current, settings } : current,
              )
            }
            onProjectDeleted={() => {
              const remaining = projects.filter(
                (p) => p.id !== selectedProject.id,
              );
              setProjects(remaining);
              setSelectedProject(remaining[0] ?? null);
              setActiveSection("dashboard");
            }}
            onDirtyChange={setSettingsDirty}
          />
        )}
      </main>

      {addProjectOpen ? (
        <AddProjectDialog onClose={() => setAddProjectOpen(false)} />
      ) : null}

      {pendingNav ? (
        <ConfirmDialog
          title="Unsaved Changes"
          message="You have unsaved settings changes. Leaving now will discard them."
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

export default App;

function readStoredTheme(): Theme {
  const stored = window.localStorage.getItem("ivs-dashboard-theme");
  return stored === "dark" ? "dark" : "light";
}
