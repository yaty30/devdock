import { useCallback, useEffect, useRef, useState } from "react";
import { BuildMiniPanel } from "../components/common/BuildMiniPanel";
import { SplashOverlay } from "../components/common/SplashOverlay";
import { AppHeader } from "../components/layout/AppHeader";
import { Sidebar } from "../components/layout/Sidebar";
import { HeaderHost } from "./HeaderHost";
import { AppModalHost } from "./AppModalHost";
import { MainRouteRenderer } from "./MainRouteRenderer";
import { useDatabaseController } from "../features/databases";
import { useDashboardController } from "../features/dashboard/useDashboardController";
import { useProjectController } from "../features/projects/useProjectController";
import { useToolsController } from "../features/tools/useToolsController";
import { useSshController } from "../features/tools/useSshController";
import { ChatFeature } from "../features/chat/ChatDrawer";
import { useAppDispatch, useAppSelector } from "./reduxHooks";
import { useAppBootstrap } from "./useAppBootstrap";
import { useFeatureFlags } from "./useFeatureFlags";
import { useMacosWindowState } from "./useMacosWindowState";
import { usePreferences } from "../hooks/usePreferences";
import { useRuntimeEvents } from "./useRuntimeEvents";
import { useSidebarResizeSync } from "./useSidebarResizeSync";
import { useSnackbar } from "../hooks/useSnackbar";
import { useSplashPhase } from "./useSplashPhase";
import { navigationActions } from "../navigation/navigationSlice";
import { useNavigationGuard } from "../navigation/useNavigationGuard";
import { APP_FEATURE_FLAGS } from "../../../shared/appFeatures";
import { MAX_PROJECTS } from "../../../shared/appLimits";
import type {
  BackendType,
  AppSection,
  DashboardTab,
  PythonServerType,
  ToolId,
} from "../types";

const SPLASH_LOGO_SIZE = "min(66px, 7vw)";
function AppShell(): JSX.Element {
  const dispatch = useAppDispatch();
  const activeTab = useAppSelector(
    (state) => state.navigation.activeProjectTab,
  );
  const activeSection = useAppSelector(
    (state) => state.navigation.activeSection,
  );
  const activeTool = useAppSelector((state) => state.navigation.activeTool);
  const setActiveTab = useCallback(
    (tab: DashboardTab) => dispatch(navigationActions.setActiveProjectTab(tab)),
    [dispatch],
  );
  const setActiveSection = useCallback(
    (section: AppSection) =>
      dispatch(navigationActions.setActiveSection(section)),
    [dispatch],
  );
  const setActiveTool = useCallback(
    (tool: ToolId) => dispatch(navigationActions.setActiveTool(tool)),
    [dispatch],
  );
  const tools = useToolsController();
  const {
    apiTesterDraftStateByScope,
    apiTesterView,
    comparingView,
    cookieModalOpen,
    cryptoActiveTab,
    notebookAddRequestId,
    notebookView,
    notesAddRequestId,
    notesView,
    setApiTesterDraftStateByScope,
    setApiTesterView,
    setComparingView,
    setCookieModalOpen,
    setCryptoActiveTab,
    setNotebookAddRequestId,
    setNotebookView,
    setNotesAddRequestId,
    setNotesView,
  } = tools;
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
  const [envFilesOpen, setEnvFilesOpen] = useState(false);
  const [panelResetVersion, setPanelResetVersion] = useState(0);
  const { snackbar, snackbarClosing, showSnackbar, dismissSnackbar } =
    useSnackbar();
  const { chatEnabled, debugEnabled } = useFeatureFlags();
  const { nativeWindowClass } = useMacosWindowState();
  const {
    settingsOpen,
    pendingNavigation,
    setSettingsOpen,
    setSettingsDirty,
    requestSettingsNavigation,
    closeSettings,
    confirmPendingNavigation,
    cancelPendingNavigation,
  } = useNavigationGuard();
  const dashboardRefreshRef = useRef<() => Promise<void>>(() =>
    Promise.resolve(),
  );
  const appShellRef = useRef<HTMLDivElement>(null);

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
    setActiveSection,
    requestSettingsNavigation,
    showSnackbar,
  });
  const project = useProjectController({
    activeSection,
    requestSettingsNavigation,
    refreshDashboardOverview: () => dashboardRefreshRef.current(),
    setActiveSection,
    setActiveTab,
    showSnackbar,
  });
  const { activeProjectState, projectLoading, projects, selectedProject } =
    project;
  const dashboard = useDashboardController({
    activeProjectState,
    activeSection,
    projects,
    selectedProjectId: selectedProject?.id ?? null,
  });
  dashboardRefreshRef.current = dashboard.refreshDashboardOverview;
  const { shutdownEntries, stoppedServices } = useRuntimeEvents({
    dashboard,
    project,
  });
  const initialStateLoaded = useAppBootstrap({
    dashboard,
    database,
    project,
  });
  useSidebarResizeSync(sidebarCollapsed, appShellRef);
  const splashPhase = useSplashPhase(
    initialStateLoaded && (selectedProject === null || !projectLoading),
  );

  useEffect(() => {
    dashboard.syncBuildMiniPanelForRoute();
  }, [dashboard.syncBuildMiniPanelForRoute]);

  useEffect(() => {
    dashboard.dismissCompletedBuildMiniRecordsForProjectRoute();
  }, [dashboard.dismissCompletedBuildMiniRecordsForProjectRoute]);

  function handleSectionChange(section: AppSection): void {
    requestSettingsNavigation(() => setActiveSection(section));
  }

  function handleToolChange(tool: ToolId): void {
    if (tool === "ssh" && !APP_FEATURE_FLAGS.ssh) {
      setSettingsOpen(false);
      setActiveTool("comparing");
      setActiveSection("dashboard");
      showSnackbar("SSH is currently unavailable.", "warning");
      return;
    }

    requestSettingsNavigation(() => {
      setActiveSection("tools");
      setActiveTool(tool);
    });
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
    const created = await project.createProject(
      name,
      code,
      backendType,
      pythonServerType,
    );
    if (created) {
      setSettingsDirty(false);
      setSettingsOpen(true);
    }
    return created;
  }

  const splashOverlay =
    splashPhase !== "hidden" ? (
      <SplashOverlay phase={splashPhase} logoSize={SPLASH_LOGO_SIZE} />
    ) : null;

  const chatFeature = chatEnabled ? (
    <ChatFeature onToast={showSnackbar} />
  ) : null;
  const buildMiniPanel =
    activeSection !== "project" && dashboard.runningBuildItems.length > 0 ? (
      <BuildMiniPanel
        items={dashboard.runningBuildItems}
        minimized={dashboard.buildMiniPanelMinimized}
        onMinimize={() => dashboard.setBuildMiniPanelMinimized(true)}
        onRestore={() => dashboard.setBuildMiniPanelMinimized(false)}
        onClearCompleted={dashboard.clearCompletedBuildMiniRecords}
        onOpenProject={project.openProjectDashboard}
        onDismissRecord={dashboard.dismissBuildMiniRecord}
      />
    ) : null;
  const appModalHost = (
    <AppModalHost
      accentColor={accentColor}
      activeProjectState={activeProjectState}
      activeSection={activeSection}
      addProjectOpen={addProjectOpen}
      buildMiniPanel={buildMiniPanel}
      cancelPendingNavigation={cancelPendingNavigation}
      closeSettings={closeSettings}
      confirmPendingNavigation={confirmPendingNavigation}
      cookieModalOpen={cookieModalOpen}
      database={database}
      dismissSnackbar={dismissSnackbar}
      envFilesOpen={envFilesOpen}
      handleCreateProject={handleCreateProject}
      interfaceSettingsOpen={interfaceSettingsOpen}
      pendingNavigation={pendingNavigation}
      project={project}
      selectedProject={selectedProject}
      setAccentColor={setAccentColor}
      setAddProjectOpen={setAddProjectOpen}
      setCookieModalOpen={setCookieModalOpen}
      setEnvFilesOpen={setEnvFilesOpen}
      setInterfaceSettingsOpen={setInterfaceSettingsOpen}
      setSettingsDirty={setSettingsDirty}
      setSettingsOpen={setSettingsOpen}
      setTheme={setTheme}
      settingsOpen={settingsOpen}
      showSnackbar={showSnackbar}
      shutdownEntries={shutdownEntries}
      snackbar={snackbar}
      snackbarClosing={snackbarClosing}
      splashOverlay={splashOverlay}
      ssh={ssh}
      stoppedServices={stoppedServices}
      theme={theme}
    />
  );
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
          onProjectChange={project.switchProject}
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
          <HeaderHost
            activeProjectState={activeProjectState}
            activeSection={activeSection}
            activeTab={activeTab}
            activeTool={activeTool}
            apiTesterView={apiTesterView}
            chatFeature={chatFeature}
            comparingView={comparingView}
            cryptoActiveTab={cryptoActiveTab}
            database={database}
            fontSizeMode={fontSizeMode}
            notebookView={notebookView}
            notesView={notesView}
            projectLoading={projectLoading}
            selectedProject={selectedProject}
            setActiveTab={setActiveTab}
            setApiTesterView={setApiTesterView}
            setComparingView={setComparingView}
            setCookieModalOpen={setCookieModalOpen}
            setCryptoActiveTab={setCryptoActiveTab}
            setEnvFilesOpen={setEnvFilesOpen}
            setFontSizeMode={setFontSizeMode}
            setNotebookAddRequestId={setNotebookAddRequestId}
            setNotebookView={setNotebookView}
            setNotesAddRequestId={setNotesAddRequestId}
            setNotesView={setNotesView}
            setSettingsOpen={setSettingsOpen}
            showSnackbar={showSnackbar}
            ssh={ssh}
          />

          <MainRouteRenderer
            activeProjectState={activeProjectState}
            activeSection={activeSection}
            activeTab={activeTab}
            activeTool={activeTool}
            apiTesterDraftStateByScope={apiTesterDraftStateByScope}
            apiTesterView={apiTesterView}
            cryptoActiveTab={cryptoActiveTab}
            dashboard={dashboard}
            database={database}
            notesAddRequestId={notesAddRequestId}
            notesView={notesView}
            notebookAddRequestId={notebookAddRequestId}
            notebookView={notebookView}
            panelResetVersion={panelResetVersion}
            selectedProject={selectedProject}
            setApiTesterDraftStateByScope={setApiTesterDraftStateByScope}
            setApiTesterView={setApiTesterView}
            showSnackbar={showSnackbar}
            ssh={ssh}
          />
        </main>
        {appModalHost}
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
        projectStatuses={dashboard.sidebarProjectStatuses}
        projectFrontendEnabled={dashboard.sidebarProjectFrontendEnabled}
        debugEnabled={debugEnabled}
        onProjectChange={project.switchProject}
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
        <HeaderHost
          activeProjectState={activeProjectState}
          activeSection={activeSection}
          activeTab={activeTab}
          activeTool={activeTool}
          apiTesterView={apiTesterView}
          chatFeature={chatFeature}
          comparingView={comparingView}
          cryptoActiveTab={cryptoActiveTab}
          database={database}
          fontSizeMode={fontSizeMode}
          notebookView={notebookView}
          notesView={notesView}
          projectLoading={projectLoading}
          selectedProject={selectedProject}
          setActiveTab={setActiveTab}
          setApiTesterView={setApiTesterView}
          setComparingView={setComparingView}
          setCookieModalOpen={setCookieModalOpen}
          setCryptoActiveTab={setCryptoActiveTab}
          setEnvFilesOpen={setEnvFilesOpen}
          setFontSizeMode={setFontSizeMode}
          setNotebookAddRequestId={setNotebookAddRequestId}
          setNotebookView={setNotebookView}
          setNotesAddRequestId={setNotesAddRequestId}
          setNotesView={setNotesView}
          setSettingsOpen={setSettingsOpen}
          showSnackbar={showSnackbar}
          ssh={ssh}
        />

        <MainRouteRenderer
          activeProjectState={activeProjectState}
          activeSection={activeSection}
          activeTab={activeTab}
          activeTool={activeTool}
          apiTesterDraftStateByScope={apiTesterDraftStateByScope}
          apiTesterView={apiTesterView}
          cryptoActiveTab={cryptoActiveTab}
          dashboard={dashboard}
          database={database}
          notesAddRequestId={notesAddRequestId}
          notesView={notesView}
          notebookAddRequestId={notebookAddRequestId}
          notebookView={notebookView}
          panelResetVersion={panelResetVersion}
          selectedProject={selectedProject}
          setApiTesterDraftStateByScope={setApiTesterDraftStateByScope}
          setApiTesterView={setApiTesterView}
          showSnackbar={showSnackbar}
          ssh={ssh}
        />
      </main>

      {appModalHost}
    </div>
  );
}

export { AppShell };
