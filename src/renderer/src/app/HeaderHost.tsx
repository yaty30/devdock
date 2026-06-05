import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Send } from "lucide-react";
import { AppHeader } from "../components/layout/AppHeader";
import {
  FontSizeDropdown,
  HeaderActions,
} from "../components/layout/HeaderActions";
import { NotesHeaderActions } from "../components/common/NotesHeaderActions";
import { GitRepositorySelector } from "../features/git/GitTerminalTab";
import {
  DatabaseHeaderActions,
  DatabaseWorkspaceTabs,
  type useDatabaseController,
} from "../features/databases";
import { ApiTesterCookieButton } from "../features/tools/ApiTesterMockup";
import {
  ApiTesterHeaderTabs,
  CompareHeaderTabs,
  CryptographicHeaderTabs,
  SingleToolHeaderTabs,
  type ApiTesterView,
  type CompareView,
} from "../features/tools/ToolHeaderTabs";
import type { CryptographicToolTab } from "../features/tools/ConversionTools";
import type { useSshController } from "../features/tools/useSshController";
import { APP_FEATURE_FLAGS } from "../../../shared/appFeatures";
import type {
  AppSection,
  DashboardTab,
  FontSizeMode,
  Project,
  ProjectGitContext,
  ProjectRuntimeState,
  ToolId,
} from "../types";
import type { NotesView } from "../features/notes/NotesTab";
import type { SnackbarTone } from "../types/snackbar";

type DatabaseController = ReturnType<typeof useDatabaseController>;
type SshController = ReturnType<typeof useSshController>;

export function HeaderHost({
  activeProjectState,
  activeSection,
  activeTab,
  activeTool,
  apiTesterView,
  chatFeature,
  comparingView,
  cryptoActiveTab,
  database,
  fontSizeMode,
  gitTerminalContext,
  notebookView,
  notesView,
  projectLoading,
  selectedProject,
  setActiveTab,
  setApiTesterView,
  setComparingView,
  setCookieModalOpen,
  setCryptoActiveTab,
  setEnvFilesOpen,
  setFontSizeMode,
  setGitTerminalContext,
  setNotebookAddRequestId,
  setNotebookView,
  setNotesAddRequestId,
  setNotesView,
  setSettingsOpen,
  showSnackbar,
  ssh,
}: {
  activeProjectState: ProjectRuntimeState | null;
  activeSection: AppSection;
  activeTab: DashboardTab;
  activeTool: ToolId;
  apiTesterView: ApiTesterView;
  chatFeature: ReactNode;
  comparingView: CompareView;
  cryptoActiveTab: CryptographicToolTab;
  database: DatabaseController;
  fontSizeMode: FontSizeMode;
  gitTerminalContext: ProjectGitContext;
  notebookView: NotesView;
  notesView: NotesView;
  projectLoading: boolean;
  selectedProject: Project | null;
  setActiveTab: (tab: DashboardTab) => void;
  setApiTesterView: (view: ApiTesterView) => void;
  setComparingView: (view: CompareView) => void;
  setCookieModalOpen: (open: boolean) => void;
  setCryptoActiveTab: (tab: CryptographicToolTab) => void;
  setEnvFilesOpen: (open: boolean) => void;
  setFontSizeMode: (fontSizeMode: FontSizeMode) => void;
  setGitTerminalContext: (context: ProjectGitContext) => void;
  setNotebookAddRequestId: Dispatch<SetStateAction<number>>;
  setNotebookView: Dispatch<SetStateAction<NotesView>>;
  setNotesAddRequestId: Dispatch<SetStateAction<number>>;
  setNotesView: Dispatch<SetStateAction<NotesView>>;
  setSettingsOpen: (open: boolean) => void;
  showSnackbar: (message: string, tone: SnackbarTone) => void;
  ssh: SshController;
}): JSX.Element {
  const SshHeaderActionsComponent = ssh.featureModule?.SshHeaderActions;
  const SshHeaderTabsComponent = ssh.featureModule?.SshHeaderTabs;
  const storageScopeId = selectedProject?.id ?? "global";

  return (
    <AppHeader
      activeTab={
        activeSection === "project" && selectedProject ? activeTab : undefined
      }
      onTabChange={
        activeSection === "project" && selectedProject
          ? setActiveTab
          : undefined
      }
      projectTabLabel={selectedProject?.name}
      actions={
        <>
          {activeSection === "project" &&
          activeProjectState &&
          selectedProject ? (
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
                activeTab === "git-terminal" ? (
                  <GitRepositorySelector
                    projectId={selectedProject.id}
                    settings={activeProjectState.settings}
                    value={gitTerminalContext}
                    disabled={projectLoading}
                    onChange={setGitTerminalContext}
                  />
                ) : activeTab === "notes" ? (
                  <NotesHeaderActions
                    view={notesView}
                    disabled={projectLoading}
                    onAdd={() => setNotesAddRequestId((current) => current + 1)}
                    onToggleView={() =>
                      setNotesView((current) =>
                        current === "grid" ? "list" : "grid",
                      )
                    }
                  />
                ) : undefined
              }
              onServiceWarning={(message) => showSnackbar(message, "invalid")}
            />
          ) : activeSection === "database" && database.selectedConnection ? (
            <DatabaseHeaderActions
              connection={database.selectedConnection}
              databaseStatus={database.runtimeStatus}
              fontSizeMode={fontSizeMode}
              onFontSizeChange={setFontSizeMode}
              onSettingsClick={database.openConnectionSettings}
            />
          ) : activeSection === "tools" && activeTool === "api-tester" ? (
            <>
              {!selectedProject && apiTesterView === "test" ? (
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
                storageScopeId={storageScopeId}
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
                onAdd={() => setNotebookAddRequestId((current) => current + 1)}
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
            <FontSizeDropdown value={fontSizeMode} onChange={setFontSizeMode} />
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
  );
}
