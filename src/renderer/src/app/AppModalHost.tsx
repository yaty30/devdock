import type { ReactNode } from "react";
import { AddProjectDialog } from "../components/dialogs/AddProjectDialog";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { InterfaceSettingsModal } from "../components/dialogs/InterfaceSettingsModal";
import { Modal } from "../components/dialogs/Modal";
import { AppSnackbar } from "../components/common/AppSnackbar";
import { ShutdownOverlay } from "../components/common/ShutdownOverlay";
import {
  DatabaseConnectionModal,
  type useDatabaseController,
} from "../features/databases";
import { ProjectEnvFilesModal } from "../features/env/ProjectEnvFilesModal";
import { SettingsContent } from "../features/settings/SettingsContent";
import { ApiTesterCookieModal } from "../features/tools/ApiTesterMockup";
import type { useProjectController } from "../features/projects/useProjectController";
import type { useSshController } from "../features/tools/useSshController";
import type { AccentColor } from "../types/preferences";
import type {
  AppSection,
  BackendType,
  Project,
  ProjectRuntimeState,
  PythonServerType,
  ShutdownEntry,
  Theme,
} from "../types";
import type { SnackbarState, SnackbarTone } from "../types/snackbar";

type DatabaseController = ReturnType<typeof useDatabaseController>;
type ProjectController = ReturnType<typeof useProjectController>;
type SshController = ReturnType<typeof useSshController>;

export function AppModalHost({
  accentColor,
  activeProjectState,
  activeSection,
  addProjectOpen,
  buildMiniPanel,
  cancelPendingNavigation,
  closeSettings,
  confirmPendingNavigation,
  cookieModalOpen,
  database,
  dismissSnackbar,
  envFilesOpen,
  handleCreateProject,
  interfaceSettingsOpen,
  pendingNavigation,
  project,
  selectedProject,
  setAccentColor,
  setAddProjectOpen,
  setCookieModalOpen,
  setEnvFilesOpen,
  setInterfaceSettingsOpen,
  setSettingsDirty,
  setSettingsOpen,
  setTheme,
  settingsOpen,
  showSnackbar,
  shutdownEntries,
  snackbar,
  snackbarClosing,
  splashOverlay,
  ssh,
  stoppedServices,
  theme,
}: {
  accentColor: AccentColor;
  activeProjectState: ProjectRuntimeState | null;
  activeSection: AppSection;
  addProjectOpen: boolean;
  buildMiniPanel: ReactNode;
  cancelPendingNavigation: () => void;
  closeSettings: () => void;
  confirmPendingNavigation: () => void;
  cookieModalOpen: boolean;
  database: DatabaseController;
  dismissSnackbar: () => void;
  envFilesOpen: boolean;
  handleCreateProject: (
    name: string,
    code: string,
    backendType: BackendType,
    pythonServerType?: PythonServerType,
  ) => Promise<boolean>;
  interfaceSettingsOpen: boolean;
  pendingNavigation: (() => void) | null;
  project: ProjectController;
  selectedProject: Project | null;
  setAccentColor: (accentColor: AccentColor) => void;
  setAddProjectOpen: (open: boolean) => void;
  setCookieModalOpen: (open: boolean) => void;
  setEnvFilesOpen: (open: boolean) => void;
  setInterfaceSettingsOpen: (open: boolean) => void;
  setSettingsDirty: (dirty: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setTheme: (theme: Theme) => void;
  settingsOpen: boolean;
  showSnackbar: (message: string, tone: SnackbarTone) => void;
  shutdownEntries: ShutdownEntry[] | null;
  snackbar: SnackbarState | null;
  snackbarClosing: boolean;
  splashOverlay: ReactNode;
  ssh: SshController;
  stoppedServices: Set<string>;
  theme: Theme;
}): JSX.Element {
  const SshSettingsModalComponent = ssh.featureModule?.SshSettingsModal;
  const sshSettingsModal = SshSettingsModalComponent ? (
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

  return (
    <>
      {sshSettingsModal}

      {selectedProject ? (
        <>
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
                  project.updateSettings(settings);
                  setSettingsDirty(false);
                  setSettingsOpen(false);
                }}
                onProjectDeleted={() => {
                  setSettingsOpen(false);
                  setSettingsDirty(false);
                  project.removeSelectedProject();
                }}
                onProjectUpdated={(updated) => {
                  project.updateProject(updated);
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
        </>
      ) : null}

      {addProjectOpen ? (
        <AddProjectDialog
          onCreate={handleCreateProject}
          onClose={() => setAddProjectOpen(false)}
        />
      ) : null}

      <DatabaseConnectionModal
        open={
          database.connectionModal !== null &&
          (database.connectionModal !== "edit" ||
            database.selectedConnection !== null)
        }
        mode={database.connectionModal ?? "add"}
        connection={
          database.connectionModal === "edit"
            ? database.selectedConnection
            : null
        }
        connections={database.connections}
        onClose={() => database.closeConnectionModal()}
        onSave={database.saveConnection}
        onTestStatus={showSnackbar}
        onDeleteRequest={database.requestDeleteConnection}
      />

      <ApiTesterCookieModal
        open={cookieModalOpen}
        storageScopeId={
          activeSection === "tools" && selectedProject
            ? selectedProject.id
            : "global"
        }
        onClose={() => setCookieModalOpen(false)}
      />

      <InterfaceSettingsModal
        open={interfaceSettingsOpen}
        theme={theme}
        accentColor={accentColor}
        onThemeChange={setTheme}
        onAccentColorChange={setAccentColor}
        onClose={() => setInterfaceSettingsOpen(false)}
      />

      {snackbar ? (
        <AppSnackbar
          message={snackbar.message}
          tone={snackbar.tone}
          closing={snackbarClosing}
          onClick={dismissSnackbar}
        />
      ) : null}

      {database.deleteConnectionRequest ? (
        <ConfirmDialog
          title="Delete Database Connection?"
          message={`Deleting "${database.deleteConnectionRequest.name}" will remove its saved sheets, query results, metadata cache, and query history from this workspace. Other projects and database connections will not be changed.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onClose={() => database.setDeleteConnectionRequest(null)}
          onConfirm={() => void database.confirmDeleteConnection()}
        />
      ) : null}

      {buildMiniPanel}

      {pendingNavigation ? (
        <ConfirmDialog
          title="Unsaved Changes"
          message="You have unsaved settings changes. Closing now will discard them."
          confirmLabel="Discard"
          cancelLabel="Stay"
          variant="warning"
          onClose={cancelPendingNavigation}
          onConfirm={confirmPendingNavigation}
        />
      ) : null}

      {shutdownEntries !== null ? (
        <ShutdownOverlay
          entries={shutdownEntries}
          stoppedServices={stoppedServices}
        />
      ) : null}

      {splashOverlay}
    </>
  );
}
