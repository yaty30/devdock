import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Panel } from "../../components/common/Panel";
import { ConfirmDialog } from "../../components/dialogs/ConfirmDialog";
import { buildProfiles } from "../../data/mockData";
import type { ConfirmDialogState, Project, SettingsTab } from "../../types";

function FieldRow({
  label,
  value,
  browse = false,
}: {
  label: string;
  value?: string;
  browse?: boolean;
}): JSX.Element {
  return (
    <label className="settings-field-row">
      <span>{label}</span>
      <input type="text" defaultValue={value ?? ""} />
      {browse ? <button type="button">Browse</button> : <span />}
    </label>
  );
}

export function SettingsContent({
  selectedProject,
}: {
  selectedProject: Project;
}): JSX.Element {
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<SettingsTab>("general");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(
    null,
  );

  return (
    <section className="settings-screen">
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings sections"
      >
        {(["general", "services", "git", "builders"] as SettingsTab[]).map(
          (tab) => (
            <button
              className={`settings-tab${activeSettingsTab === tab ? " active" : ""}`}
              type="button"
              key={tab}
              onClick={() => setActiveSettingsTab(tab)}
            >
              {tab === "git" ? "Git" : tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ),
        )}
      </div>

      <div className="settings-body">
        {activeSettingsTab === "general" ? (
          <div className="settings-grid">
            <Panel title="Current Project" className="settings-summary-panel">
              <div className="settings-summary">
                <span>Project</span>
                <strong>{selectedProject.name}</strong>
                <span>Project ID</span>
                <strong>{selectedProject.id}</strong>
                <span>Runtime</span>
                <strong>Stopped</strong>
                <span>Port</span>
                <strong>Not available</strong>
              </div>
            </Panel>
            <Panel title="Project Paths" className="settings-form-panel">
              <FieldRow
                label="Project Folder"
                value={`C:\\Users\\user\\Documents\\Codes\\ivs-dashboard\\.dashboard_data\\projects\\${selectedProject.id}`}
                browse
              />
              <FieldRow label="Application Log File" browse />
              <FieldRow
                label="Git Project Directory"
                value="C:\\Users\\yipsy1\\iap"
                browse
              />
            </Panel>
          </div>
        ) : null}

        {activeSettingsTab === "services" ? (
          <div className="services-settings-grid">
            <Panel title="Frontend" className="settings-form-panel">
              <FieldRow label="Display Name" value="Frontend" />
              <FieldRow
                label="Directory"
                value="C:\\Users\\yipsy1\\iap\\frontend"
                browse
              />
              <FieldRow label="Command" value="npm run dev" />
            </Panel>

            <Panel title="WildFly" className="settings-form-panel">
              <FieldRow label="Bin Directory" value="C:\\wildfly\\bin" browse />
              <FieldRow label="Start Command" value="start-rvdiap.bat" />
              <FieldRow label="Admin Console URL" />
              <FieldRow label="KMU URL" />
            </Panel>
          </div>
        ) : null}

        {activeSettingsTab === "git" ? (
          <Panel title="Git" className="settings-form-panel full">
            <FieldRow
              label="Git Project Directory"
              value="C:\\Users\\yipsy1\\iap"
              browse
            />
            <FieldRow label="Default Branch" value="main" />
            <FieldRow label="Remote" value="origin" />
            <p className="settings-note">
              Git commands are static in this prototype.
            </p>
          </Panel>
        ) : null}

        {activeSettingsTab === "builders" ? (
          <div className="builders-layout">
            <Panel title="Maven Config" className="settings-form-panel">
              <FieldRow label="mvn.cmd Location" value="mvn" browse />
              <FieldRow label="settings.xml Path" browse />
              <FieldRow
                label="pom.xml Path"
                value="C:\\Users\\yipsy1\\iap\\pom.xml"
                browse
              />
              <label className="skip-tests-row">
                <span />
                <span className="skip-tests-control">
                  <input type="checkbox" defaultChecked />
                  Skip tests (-D skipTests)
                </span>
              </label>
            </Panel>
            <Panel
              title="Build Profiles"
              action={
                <button
                  className="icon-button primary"
                  type="button"
                  aria-label="Add builder"
                  title="Add builder"
                >
                  <Plus size={16} />
                </button>
              }
              className="build-profiles-panel"
            >
              <table className="build-profiles-table">
                <thead>
                  <tr>
                    <th>Button name</th>
                    <th>Profile</th>
                    <th>Goal</th>
                    <th>Confirm</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {buildProfiles.map((profile) => (
                    <tr key={profile.buttonName}>
                      <td>
                        <input type="text" defaultValue={profile.buttonName} />
                      </td>
                      <td>
                        <input type="text" defaultValue={profile.profileName} />
                      </td>
                      <td>
                        <input type="text" defaultValue={profile.goal} />
                      </td>
                      <td>
                        <label className="builder-confirm">
                          <input
                            type="checkbox"
                            defaultChecked={profile.confirm}
                          />
                        </label>
                      </td>
                      <td>
                        <button
                          className="icon-button danger"
                          type="button"
                          aria-label={`Remove ${profile.buttonName} profile`}
                          title="Remove profile"
                          onClick={() =>
                            setConfirmDialog({
                              title: "Delete Builder Profile?",
                              message: `Deleting "${profile.buttonName}" is irreversible and will remove this build action from the profile list.`,
                              confirmLabel: "Continue",
                            })
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>
        ) : null}
      </div>

      <footer className="settings-footer">
        <button
          className="danger-button"
          type="button"
          onClick={() =>
            setConfirmDialog({
              title: "Delete Project?",
              message: `Deleting "${selectedProject.name}" is irreversible and will erase its saved dashboard configuration.`,
              confirmLabel: "Continue",
            })
          }
        >
          <Trash2 size={15} />
          Delete Project
        </button>
        <div>
          <button className="button secondary compact" type="button">
            Validate
          </button>
          <button className="button primary compact" type="button">
            Save
          </button>
          <button className="button secondary compact" type="button">
            Cancel
          </button>
        </div>
      </footer>

      {confirmDialog ? (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onClose={() => setConfirmDialog(null)}
        />
      ) : null}
    </section>
  );
}
