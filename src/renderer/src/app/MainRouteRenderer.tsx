import type { Dispatch, SetStateAction } from "react";
import {
  DashboardContent,
  ProjectDashboardContent,
} from "../features/dashboard/DashboardContent";
import { createLoadingProjectState } from "../features/dashboard/dashboardState";
import {
  DatabaseEmptyState,
  DatabaseWorkspace,
  type useDatabaseController,
} from "../features/databases";
import { GitTerminalTab } from "../features/git/GitTerminalTab";
import { MonitorTab } from "../features/monitor/MonitorTab";
import { NotesTab, type NotesView } from "../features/notes/NotesTab";
import {
  type ApiTesterDraftState,
  ApiTesterMockup,
} from "../features/tools/ApiTesterMockup";
import { CompareTool } from "../features/tools/CompareTool";
import {
  CryptographicTool,
  type CryptographicToolTab,
} from "../features/tools/ConversionTools";
import type { useDashboardController } from "../features/dashboard/useDashboardController";
import type { useSshController } from "../features/tools/useSshController";
import { APP_FEATURE_FLAGS } from "../../../shared/appFeatures";
import type {
  AppSection,
  DashboardTab,
  Project,
  ProjectGitContext,
  ProjectRuntimeState,
  ToolId,
} from "../types";
import type { SnackbarTone } from "../types/snackbar";

const STANDALONE_NOTEBOOK_PROJECT_ID = "__ivs_standalone_notebook__";

type DatabaseController = ReturnType<typeof useDatabaseController>;
type DashboardController = ReturnType<typeof useDashboardController>;
type SshController = ReturnType<typeof useSshController>;

export function MainRouteRenderer({
  activeProjectState,
  activeSection,
  activeTab,
  activeTool,
  apiTesterDraftStateByScope,
  apiTesterView,
  cryptoActiveTab,
  dashboard,
  database,
  gitTerminalContext,
  notesAddRequestId,
  notesView,
  notebookAddRequestId,
  notebookView,
  panelResetVersion,
  selectedProject,
  setApiTesterDraftStateByScope,
  setApiTesterView,
  showSnackbar,
  ssh,
}: {
  activeProjectState: ProjectRuntimeState | null;
  activeSection: AppSection;
  activeTab: DashboardTab;
  activeTool: ToolId;
  apiTesterDraftStateByScope: Record<string, ApiTesterDraftState>;
  apiTesterView: "test" | "history" | "saved";
  cryptoActiveTab: CryptographicToolTab;
  dashboard: DashboardController;
  database: DatabaseController;
  gitTerminalContext: ProjectGitContext;
  notesAddRequestId: number;
  notesView: NotesView;
  notebookAddRequestId: number;
  notebookView: NotesView;
  panelResetVersion: number;
  selectedProject: Project | null;
  setApiTesterDraftStateByScope: Dispatch<
    SetStateAction<Record<string, ApiTesterDraftState>>
  >;
  setApiTesterView: (view: "test" | "history" | "saved") => void;
  showSnackbar: (message: string, tone: SnackbarTone) => void;
  ssh: SshController;
}): JSX.Element | null {
  const SshToolComponent = ssh.featureModule?.SshTool;
  const apiTesterScopeId = selectedProject?.id ?? "global";

  if (
    activeSection === "dashboard" ||
    (!selectedProject && activeSection === "project")
  ) {
    return (
      <DashboardContent
        projects={dashboard.dashboardOverview}
        databaseConnections={database.connections}
        loading={dashboard.dashboardOverviewLoading}
      />
    );
  }

  if (activeSection === "database") {
    return database.selectedConnection ? (
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
    );
  }

  if (activeSection === "tools") {
    if (activeTool === "api-tester") {
      return (
        <ApiTesterMockup
          view={apiTesterView}
          storageScopeId={apiTesterScopeId}
          onViewChange={setApiTesterView}
          onFeedback={showSnackbar}
          initialState={apiTesterDraftStateByScope[apiTesterScopeId] ?? null}
          onStateChange={(next) =>
            setApiTesterDraftStateByScope((current) => ({
              ...current,
              [apiTesterScopeId]: next,
            }))
          }
        />
      );
    }

    if (activeTool === "comparing") {
      return <CompareTool />;
    }

    if (activeTool === "notebook") {
      return (
        <NotesTab
          projectId={STANDALONE_NOTEBOOK_PROJECT_ID}
          view={notebookView}
          addNoteRequestId={notebookAddRequestId}
          onFeedback={(message) => showSnackbar(message, "invalid")}
        />
      );
    }

    if (APP_FEATURE_FLAGS.ssh && activeTool === "ssh" && SshToolComponent) {
      return (
        <SshToolComponent
          selectedServer={ssh.selectedServer}
          activeTab={ssh.activeTab}
          disabled={!ssh.hasValidCredential}
          connectionStatus={ssh.connectionStatus}
          reconnectAttempt={ssh.reconnectAttempt}
          reconnectMaxAttempts={ssh.selectedServer?.maxReconnectAttempts ?? 0}
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
      );
    }

    return (
      <CryptographicTool
        activeTab={cryptoActiveTab}
        onFeedback={showSnackbar}
      />
    );
  }

  if (activeSection === "project" && selectedProject) {
    if (activeTab === "dashboard") {
      return (
        <ProjectDashboardContent
          projectId={selectedProject.id}
          resetVersion={panelResetVersion}
          projectState={activeProjectState ?? createLoadingProjectState()}
        />
      );
    }

    if (activeTab === "monitor") {
      return (
        <MonitorTab
          resetVersion={panelResetVersion}
          projectState={activeProjectState ?? createLoadingProjectState()}
          projectId={selectedProject.id}
        />
      );
    }

    if (activeTab === "git-terminal") {
      return activeProjectState ? (
        <GitTerminalTab
          projectId={selectedProject.id}
          gitStatus={activeProjectState.gitStatus}
          settings={activeProjectState.settings}
          gitContext={gitTerminalContext}
          onFeedback={showSnackbar}
        />
      ) : (
        <section className="resizable-panel-screen">
          <div className="panel">
            <div />
          </div>
        </section>
      );
    }

    if (activeTab === "notes") {
      return (
        <NotesTab
          projectId={selectedProject.id}
          view={notesView}
          addNoteRequestId={notesAddRequestId}
          onFeedback={(message) => showSnackbar(message, "invalid")}
        />
      );
    }
  }

  return null;
}
