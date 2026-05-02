import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Panel } from "../../components/common/Panel";
import { ConfirmDialog } from "../../components/dialogs/ConfirmDialog";
import type {
  BuildOutcomeType,
  BuildProfileRecord,
  ConfirmDialogState,
  Project,
  ProjectSettingsRecord,
  ServiceName,
  SettingsTab,
} from "../../types";

function FieldRow({
  label,
  value,
  browse = false,
  onChange,
  onBrowse,
}: {
  label: string;
  value: string;
  browse?: boolean;
  onChange: (value: string) => void;
  onBrowse?: () => void;
}): JSX.Element {
  return (
    <label className="settings-field-row">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {browse ? (
        <button type="button" onClick={onBrowse}>
          Browse
        </button>
      ) : (
        <span />
      )}
    </label>
  );
}

export function SettingsContent({
  selectedProject,
  settings,
  onSettingsSaved,
  onProjectDeleted,
  onDirtyChange,
}: {
  selectedProject: Project;
  settings: ProjectSettingsRecord;
  onSettingsSaved: (settings: ProjectSettingsRecord) => void;
  onProjectDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
}): JSX.Element {
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<SettingsTab>("general");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(
    null,
  );
  const [draft, setDraft] = useState<ProjectSettingsRecord>(settings);
  const [saving, setSaving] = useState(false);
  const [validationBanner, setValidationBanner] = useState<{
    valid: boolean;
    errors: string[];
    message?: string;
  } | null>(null);
  const [validationClosing, setValidationClosing] = useState(false);
  const dismissTimerRef = useRef<number | null>(null);
  const closingTimerRef = useRef<number | null>(null);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(settings),
    [draft, settings],
  );

  useEffect(() => {
    onDirtyChangeRef.current(isDirty);
  }, [isDirty]);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null)
        window.clearTimeout(dismissTimerRef.current);
      if (closingTimerRef.current !== null)
        window.clearTimeout(closingTimerRef.current);
    };
  }, []);

  function showBanner(banner: {
    valid: boolean;
    errors: string[];
    message?: string;
  }): void {
    if (dismissTimerRef.current !== null)
      window.clearTimeout(dismissTimerRef.current);
    if (closingTimerRef.current !== null)
      window.clearTimeout(closingTimerRef.current);
    setValidationClosing(false);
    setValidationBanner(banner);
    dismissTimerRef.current = window.setTimeout(() => {
      setValidationClosing(true);
      closingTimerRef.current = window.setTimeout(() => {
        setValidationBanner(null);
        setValidationClosing(false);
      }, 190);
    }, 4000);
  }

  function dismissBanner(): void {
    if (dismissTimerRef.current !== null)
      window.clearTimeout(dismissTimerRef.current);
    if (closingTimerRef.current !== null)
      window.clearTimeout(closingTimerRef.current);
    setValidationClosing(true);
    closingTimerRef.current = window.setTimeout(() => {
      setValidationBanner(null);
      setValidationClosing(false);
    }, 190);
  }

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  function updateService(
    service: ServiceName,
    field: keyof ProjectSettingsRecord["services"][ServiceName],
    value: string | boolean,
  ): void {
    setDraft((current) => ({
      ...current,
      services: {
        ...current.services,
        [service]: {
          ...current.services[service],
          [field]: value,
        },
      },
    }));
  }

  function updateProfile(
    profileId: string,
    patch: Partial<BuildProfileRecord>,
  ): void {
    setDraft((current) => ({
      ...current,
      buildProfiles: current.buildProfiles.map((profile) =>
        profile.id === profileId ? { ...profile, ...patch } : profile,
      ),
    }));
  }

  function addProfile(): void {
    const id = `profile-${Date.now()}`;
    setDraft((current) => ({
      ...current,
      buildProfiles: [
        ...current.buildProfiles,
        {
          id,
          buttonName: "New",
          profileName: "local",
          goals: "clean package",
          confirm: false,
          outcomeType: "build-only",
        },
      ],
    }));
  }

  function removeProfile(profileId: string): void {
    setDraft((current) => ({
      ...current,
      buildProfiles: current.buildProfiles.filter(
        (profile) => profile.id !== profileId,
      ),
    }));
  }

  function save(): void {
    setSaving(true);
    window.ivsDashboard
      .saveProjectSettings(selectedProject.id, draft)
      .then((saved) => {
        onSettingsSaved(saved);
        showBanner({ valid: true, errors: [], message: "Settings saved." });
      })
      .catch((error) => console.error(error))
      .finally(() => setSaving(false));
  }

  function validateDraft(): void {
    const errors: string[] = [];
    if (!draft.maven.executable.trim())
      errors.push("Maven: executable path is required");
    if (!draft.maven.pomXml.trim())
      errors.push("Maven: pom.xml path is required");
    if (!draft.services.frontend.workingDirectory.trim())
      errors.push("Frontend: working directory is required");
    if (!draft.services.frontend.command.trim())
      errors.push("Frontend: start command is required");
    if (!draft.services.frontend.healthUrl.trim())
      errors.push("Frontend: health URL is required");
    if (!draft.services.wildfly.workingDirectory.trim())
      errors.push("WildFly: bin directory is required");
    if (!draft.services.wildfly.command.trim())
      errors.push("WildFly: start command is required");
    if (!draft.services.wildfly.healthUrl.trim())
      errors.push("WildFly: health URL is required");
    showBanner({ valid: errors.length === 0, errors });
  }

  function browseDirectory(
    title: string,
    currentPath: string,
    onSelected: (value: string) => void,
  ): void {
    window.ivsDashboard
      .browsePath({
        kind: "directory",
        title,
        defaultPath: currentPath || undefined,
      })
      .then((path) => {
        if (path) {
          onSelected(path);
        }
      })
      .catch((error) => console.error(error));
  }

  function browseFile(
    title: string,
    currentPath: string,
    onSelected: (value: string) => void,
    filters?: Array<{ name: string; extensions: string[] }>,
  ): void {
    window.ivsDashboard
      .browsePath({
        kind: "file",
        title,
        defaultPath: currentPath || undefined,
        filters,
      })
      .then((path) => {
        if (path) {
          onSelected(path);
        }
      })
      .catch((error) => console.error(error));
  }

  return (
    <section className="settings-screen">
      {validationBanner ? (
        <div
          className={`validation-banner${validationBanner.valid ? " valid" : " invalid"}${validationClosing ? " closing" : ""}`}
          role="status"
          onClick={dismissBanner}
        >
          {validationBanner.valid
            ? (validationBanner.message ?? "Configuration looks valid.")
            : validationBanner.errors.map((e) => <div key={e}>• {e}</div>)}
        </div>
      ) : null}
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
                <strong>Configured</strong>
                <span>Log File</span>
                <strong>{draft.appLogFile || "Not set"}</strong>
                <span>Auto start</span>
                <div className="auto-start-checks">
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.services.wildfly.autoStart ?? false}
                      onChange={(e) =>
                        updateService("wildfly", "autoStart", e.target.checked)
                      }
                    />
                    WildFly
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.services.frontend.autoStart ?? false}
                      onChange={(e) =>
                        updateService("frontend", "autoStart", e.target.checked)
                      }
                    />
                    Frontend
                  </label>
                </div>
              </div>
            </Panel>
            <Panel title="Project Paths" className="settings-form-panel">
              <FieldRow
                label="Application Log File"
                value={draft.appLogFile}
                browse
                onChange={(value) =>
                  setDraft((current) => ({ ...current, appLogFile: value }))
                }
                onBrowse={() =>
                  browseFile(
                    "Select application log file",
                    draft.appLogFile,
                    (value) =>
                      setDraft((current) => ({
                        ...current,
                        appLogFile: value,
                      })),
                  )
                }
              />
              <FieldRow
                label="Git Project Directory"
                value={draft.gitProjectDirectory}
                browse
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    gitProjectDirectory: value,
                  }))
                }
                onBrowse={() =>
                  browseDirectory(
                    "Select Git project directory",
                    draft.gitProjectDirectory,
                    (value) =>
                      setDraft((current) => ({
                        ...current,
                        gitProjectDirectory: value,
                      })),
                  )
                }
              />
            </Panel>
          </div>
        ) : null}

        {activeSettingsTab === "services" ? (
          <div className="services-settings-grid">
            <Panel title="Frontend" className="settings-form-panel">
              <FieldRow
                label="Directory"
                value={draft.services.frontend.workingDirectory}
                browse
                onChange={(value) =>
                  updateService("frontend", "workingDirectory", value)
                }
                onBrowse={() =>
                  browseDirectory(
                    "Select frontend directory",
                    draft.services.frontend.workingDirectory,
                    (value) =>
                      updateService("frontend", "workingDirectory", value),
                  )
                }
              />
              <FieldRow
                label="Command"
                value={draft.services.frontend.command}
                onChange={(value) =>
                  updateService("frontend", "command", value)
                }
              />
              <FieldRow
                label="Health URL"
                value={draft.services.frontend.healthUrl}
                onChange={(value) =>
                  updateService("frontend", "healthUrl", value)
                }
              />
              <FieldRow
                label="App URL"
                value={draft.services.frontend.appUrl ?? ""}
                onChange={(value) => updateService("frontend", "appUrl", value)}
              />
            </Panel>

            <Panel title="WildFly" className="settings-form-panel">
              <FieldRow
                label="Bin Directory"
                value={draft.services.wildfly.workingDirectory}
                browse
                onChange={(value) =>
                  updateService("wildfly", "workingDirectory", value)
                }
                onBrowse={() =>
                  browseDirectory(
                    "Select WildFly directory",
                    draft.services.wildfly.workingDirectory,
                    (value) =>
                      updateService("wildfly", "workingDirectory", value),
                  )
                }
              />
              <FieldRow
                label="Start Command"
                value={draft.services.wildfly.command}
                onChange={(value) => updateService("wildfly", "command", value)}
              />
              <FieldRow
                label="Health URL"
                value={draft.services.wildfly.healthUrl}
                onChange={(value) =>
                  updateService("wildfly", "healthUrl", value)
                }
              />
              <FieldRow
                label="Admin Console URL"
                value={draft.services.wildfly.managementUrl ?? ""}
                onChange={(value) =>
                  updateService("wildfly", "managementUrl", value)
                }
              />
              <FieldRow
                label="KMU URL"
                value={draft.services.wildfly.appUrl ?? ""}
                onChange={(value) => updateService("wildfly", "appUrl", value)}
              />
            </Panel>
          </div>
        ) : null}

        {activeSettingsTab === "git" ? (
          <Panel title="Git" className="settings-form-panel full">
            <FieldRow
              label="Git Project Directory"
              value={draft.gitProjectDirectory}
              browse
              onChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  gitProjectDirectory: value,
                }))
              }
              onBrowse={() =>
                browseDirectory(
                  "Select Git project directory",
                  draft.gitProjectDirectory,
                  (value) =>
                    setDraft((current) => ({
                      ...current,
                      gitProjectDirectory: value,
                    })),
                )
              }
            />
            <FieldRow
              label="Default Branch"
              value={draft.defaultBranch}
              onChange={(value) =>
                setDraft((current) => ({ ...current, defaultBranch: value }))
              }
            />
            <FieldRow
              label="Remote"
              value={draft.remote}
              onChange={(value) =>
                setDraft((current) => ({ ...current, remote: value }))
              }
            />
          </Panel>
        ) : null}

        {activeSettingsTab === "builders" ? (
          <div className="builders-layout">
            <Panel title="Maven Config" className="settings-form-panel">
              <FieldRow
                label="mvn.cmd Location"
                value={draft.maven.executable}
                browse
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    maven: { ...current.maven, executable: value },
                  }))
                }
                onBrowse={() =>
                  browseFile(
                    "Select Maven executable",
                    draft.maven.executable,
                    (value) =>
                      setDraft((current) => ({
                        ...current,
                        maven: { ...current.maven, executable: value },
                      })),
                    [
                      {
                        name: "Executables",
                        extensions: ["cmd", "bat", "exe"],
                      },
                      { name: "All files", extensions: ["*"] },
                    ],
                  )
                }
              />
              <FieldRow
                label="settings.xml Path"
                value={draft.maven.settingsXml}
                browse
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    maven: { ...current.maven, settingsXml: value },
                  }))
                }
                onBrowse={() =>
                  browseFile(
                    "Select Maven settings.xml",
                    draft.maven.settingsXml,
                    (value) =>
                      setDraft((current) => ({
                        ...current,
                        maven: { ...current.maven, settingsXml: value },
                      })),
                    [
                      { name: "XML", extensions: ["xml"] },
                      { name: "All files", extensions: ["*"] },
                    ],
                  )
                }
              />
              <FieldRow
                label="pom.xml Path"
                value={draft.maven.pomXml}
                browse
                onChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    maven: { ...current.maven, pomXml: value },
                  }))
                }
                onBrowse={() =>
                  browseFile(
                    "Select pom.xml",
                    draft.maven.pomXml,
                    (value) =>
                      setDraft((current) => ({
                        ...current,
                        maven: { ...current.maven, pomXml: value },
                      })),
                    [
                      { name: "Maven POM", extensions: ["xml"] },
                      { name: "All files", extensions: ["*"] },
                    ],
                  )
                }
              />
              <label className="skip-tests-row">
                <span />
                <span className="skip-tests-control">
                  <input
                    type="checkbox"
                    checked={draft.maven.skipTests}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        maven: {
                          ...current.maven,
                          skipTests: event.target.checked,
                        },
                      }))
                    }
                  />
                  Skip tests (-DskipTests)
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
                  onClick={addProfile}
                >
                  <Plus size={16} />
                </button>
              }
              className="build-profiles-panel"
            >
              <table className="build-profiles-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Profile</th>
                    <th>Goal</th>
                    <th>Outcome</th>
                    <th>Confirm</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {draft.buildProfiles.map((profile) => (
                    <tr key={profile.id}>
                      <td>
                        <input
                          type="text"
                          value={profile.buttonName}
                          onChange={(event) =>
                            updateProfile(profile.id, {
                              buttonName: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={profile.profileName}
                          onChange={(event) =>
                            updateProfile(profile.id, {
                              profileName: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={profile.goals}
                          onChange={(event) =>
                            updateProfile(profile.id, {
                              goals: event.target.value,
                            })
                          }
                        />
                      </td>
                      <td>
                        <select
                          value={profile.outcomeType}
                          onChange={(event) =>
                            updateProfile(profile.id, {
                              outcomeType: event.target
                                .value as BuildOutcomeType,
                            })
                          }
                        >
                          <option value="build-only">Build only</option>
                          <option value="build-and-deploy">
                            Build + deploy
                          </option>
                        </select>
                      </td>
                      <td>
                        <label className="builder-confirm">
                          <input
                            type="checkbox"
                            checked={profile.confirm}
                            onChange={(event) =>
                              updateProfile(profile.id, {
                                confirm: event.target.checked,
                              })
                            }
                          />
                        </label>
                      </td>
                      <td>
                        <button
                          className="icon-button danger"
                          type="button"
                          aria-label={`Remove ${profile.buttonName} profile`}
                          title="Remove profile"
                          onClick={() => removeProfile(profile.id)}
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
        <div className="settings-footer-row">
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
            <button
              className="button secondary compact"
              type="button"
              onClick={validateDraft}
            >
              Validate
            </button>
            <button
              className="button primary compact"
              type="button"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving" : "Save"}
            </button>
            <button
              className="button secondary compact"
              type="button"
              onClick={() => setDraft(settings)}
            >
              Cancel
            </button>
          </div>
        </div>
      </footer>

      {confirmDialog ? (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onClose={() => setConfirmDialog(null)}
          onConfirm={() => {
            window.ivsDashboard
              .deleteProject(selectedProject.id)
              .then(() => onProjectDeleted())
              .catch((error) => console.error(error));
          }}
        />
      ) : null}
    </section>
  );
}
