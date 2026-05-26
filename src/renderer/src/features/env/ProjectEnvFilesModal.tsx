import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  AppSelect,
  type AppSelectOption,
} from "../../components/common/AppSelect";
import { ConfirmDialog } from "../../components/dialogs/ConfirmDialog";
import { Modal } from "../../components/dialogs/Modal";
import type {
  Project,
  ProjectEnvFileGroup,
  ProjectEnvFileRecord,
  ProjectEnvScope,
  ProjectEnvVariable,
} from "../../types";

type LoadState = "idle" | "loading" | "ready" | "error";

export function ProjectEnvFilesModal({
  open,
  project,
  onClose,
  onFeedback,
}: {
  open: boolean;
  project: Project;
  onClose: () => void;
  onFeedback: (message: string, tone: "valid" | "invalid") => void;
}): JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [groups, setGroups] = useState<ProjectEnvFileGroup[]>([]);
  const [activeScope, setActiveScope] = useState<ProjectEnvScope | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<
    Partial<Record<ProjectEnvScope, string>>
  >({});
  const [draftVariables, setDraftVariables] = useState<ProjectEnvVariable[]>(
    [],
  );
  const [saving, setSaving] = useState(false);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);

  const activeGroup = useMemo(
    () => groups.find((group) => group.scope === activeScope) ?? groups[0],
    [activeScope, groups],
  );
  const activeFile = useMemo(
    () => getActiveFile(activeGroup, selectedPaths),
    [activeGroup, selectedPaths],
  );
  const fileOptions = useMemo(
    () =>
      (activeGroup?.files ?? []).map<AppSelectOption<string>>((file) => ({
        value: file.path,
        label: file.name,
      })),
    [activeGroup],
  );
  const dirty =
    activeFile !== null &&
    JSON.stringify(draftVariables) !== JSON.stringify(activeFile.variables);

  useEffect(() => {
    if (!open) {
      setLoadState("idle");
      setSaving(false);
      setConfirmExitOpen(false);
      return undefined;
    }

    let cancelled = false;
    setLoadState("loading");
    window.ivsDashboard
      .getProjectEnvFiles(project.id)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setGroups(result.groups);
        setActiveScope(result.groups[0]?.scope ?? null);
        setSelectedPaths(
          Object.fromEntries(
            result.groups.map((group) => [
              group.scope,
              group.files[0]?.path ?? "",
            ]),
          ),
        );
        setLoadState("ready");
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setGroups([]);
          setActiveScope(null);
          setLoadState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, project.id]);

  useEffect(() => {
    setDraftVariables(activeFile?.variables ?? []);
  }, [activeFile]);

  function selectScope(scope: ProjectEnvScope): void {
    setActiveScope(scope);
  }

  function selectFile(filePath: string): void {
    if (!activeGroup) {
      return;
    }

    setSelectedPaths((current) => ({
      ...current,
      [activeGroup.scope]: filePath,
    }));
  }

  function updateVariable(lineIndex: number, value: string): void {
    setDraftVariables((current) =>
      current.map((variable) =>
        variable.lineIndex === lineIndex ? { ...variable, value } : variable,
      ),
    );
  }

  function requestClose(): void {
    if (dirty) {
      setConfirmExitOpen(true);
      return;
    }

    onClose();
  }

  function openCurrentFile(): void {
    if (!activeFile) {
      return;
    }

    window.ivsDashboard
      .openPath(activeFile.path)
      .catch((error) => {
        console.error(error);
        onFeedback("Environment file could not be opened", "invalid");
      });
  }

  function save(): void {
    if (!activeGroup || !activeFile || !dirty || saving) {
      return;
    }

    setSaving(true);
    window.ivsDashboard
      .saveProjectEnvFile(
        project.id,
        activeGroup.scope,
        activeFile.path,
        draftVariables,
      )
      .then((savedFile) => {
        setGroups((current) =>
          current.map((group) =>
            group.scope === activeGroup.scope
              ? {
                  ...group,
                  files: group.files.map((file) =>
                    file.path === savedFile.path ? savedFile : file,
                  ),
                }
              : group,
          ),
        );
        setDraftVariables(savedFile.variables);
        onFeedback("Environment file saved", "valid");
      })
      .catch((error) => {
        console.error(error);
        onFeedback("Environment file could not be saved", "invalid");
      })
      .finally(() => setSaving(false));
  }

  return (
    <Modal
      open={open}
      title="Environment Files"
      size="lg"
      className="env-files-modal"
      contentClassName="env-files-modal-content"
      closeLabel="Close environment files"
      onClose={requestClose}
    >
      <section className="env-files-panel">
        {loadState === "loading" ? (
          <div className="env-files-empty">Loading environment files.</div>
        ) : loadState === "error" ? (
          <div className="env-files-empty">Environment files could not be loaded.</div>
        ) : groups.length === 0 ? (
          <div className="env-files-empty">No configured project roots.</div>
        ) : (
          <>
            <div
              className="tabs env-files-tabs"
              role="tablist"
              aria-label="Environment file roots"
            >
              {groups.map((group) => (
                <button
                  className={`tab${activeGroup?.scope === group.scope ? " active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={activeGroup?.scope === group.scope}
                  key={group.scope}
                  onClick={() => selectScope(group.scope)}
                >
                  {group.label}
                </button>
              ))}
            </div>

            <div className="env-files-body">
              <div className="env-files-toolbar">
                <div>
                  <span>File</span>
                  <AppSelect
                    value={activeFile?.path ?? ""}
                    options={fileOptions}
                    onChange={selectFile}
                    ariaLabel="Environment file"
                    minDropdownWidth={220}
                    showDots={false}
                    disabled={!activeGroup || fileOptions.length === 0}
                  />
                  <button
                    className="icon-button secondary env-file-open-button"
                    type="button"
                    aria-label="Open environment file"
                    title="Open environment file"
                    disabled={!activeFile}
                    onClick={openCurrentFile}
                  >
                    <ExternalLink size={17} />
                  </button>
                </div>
                <strong title={activeGroup?.rootPath}>
                  {activeGroup?.rootPath ?? ""}
                </strong>
              </div>

              {!activeFile ? (
                <div className="env-files-empty">No .env files found.</div>
              ) : draftVariables.length === 0 ? (
                <div className="env-files-empty">No variables found in this file.</div>
              ) : (
                <div className="env-table-wrap">
                  <table className="env-table">
                    <thead>
                      <tr>
                        <th>Variable Name</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draftVariables.map((variable) => (
                        <tr key={`${variable.lineIndex}-${variable.name}`}>
                          <td>{variable.name}</td>
                          <td>
                            <input
                              type="text"
                              value={variable.value}
                              onChange={(event) =>
                                updateVariable(
                                  variable.lineIndex,
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <footer className="env-files-footer">
              <button
                className="button secondary compact"
                type="button"
                onClick={requestClose}
              >
                Cancel
              </button>
              <button
                className="button primary compact"
                type="button"
                disabled={!dirty || saving || !activeFile}
                onClick={save}
              >
                {saving ? "Saving" : "Save"}
              </button>
            </footer>
          </>
        )}
      </section>
      {confirmExitOpen ? (
        <ConfirmDialog
          title="Discard Env Changes?"
          message="This environment file has unsaved changes."
          confirmLabel="Discard"
          cancelLabel="Keep Editing"
          variant="warning"
          onClose={() => setConfirmExitOpen(false)}
          onConfirm={onClose}
        />
      ) : null}
    </Modal>
  );
}

function getActiveFile(
  group: ProjectEnvFileGroup | undefined,
  selectedPaths: Partial<Record<ProjectEnvScope, string>>,
): ProjectEnvFileRecord | null {
  if (!group) {
    return null;
  }

  const selectedPath = selectedPaths[group.scope];
  return (
    group.files.find((file) => file.path === selectedPath) ??
    group.files[0] ??
    null
  );
}
