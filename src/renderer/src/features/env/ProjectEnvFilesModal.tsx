import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
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
  const tableWrapRef = useRef<HTMLDivElement | null>(null);

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
  const validationMessage = getVariablesValidationMessage(draftVariables);

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

  function updateVariableName(lineIndex: number, name: string): void {
    setDraftVariables((current) =>
      current.map((variable) =>
        variable.lineIndex === lineIndex ? { ...variable, name } : variable,
      ),
    );
  }

  function updateVariableValue(lineIndex: number, value: string): void {
    setDraftVariables((current) =>
      current.map((variable) =>
        variable.lineIndex === lineIndex ? { ...variable, value } : variable,
      ),
    );
  }

  function addVariable(): void {
    setDraftVariables((current) => {
      const nextLineIndex =
        Math.min(0, ...current.map((variable) => variable.lineIndex)) - 1;
      return [...current, { lineIndex: nextLineIndex, name: "", value: "" }];
    });
    window.requestAnimationFrame(() => {
      const tableWrap = tableWrapRef.current;
      if (tableWrap) {
        tableWrap.scrollTop = tableWrap.scrollHeight;
      }
    });
  }

  function deleteVariable(lineIndex: number): void {
    setDraftVariables((current) =>
      current.filter((variable) => variable.lineIndex !== lineIndex),
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

    if (validationMessage) {
      onFeedback(validationMessage, "invalid");
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
                <div className="env-files-empty">
                  <span>No variables found in this file.</span>
                </div>
              ) : (
                <div className="env-table-wrap" ref={tableWrapRef}>
                  <table className="env-table">
                    <thead>
                      <tr>
                        <th>Variable Name</th>
                        <th>Value</th>
                        <th aria-label="Row actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {draftVariables.map((variable) => (
                        <tr key={variable.lineIndex}>
                          <td>
                            <input
                              type="text"
                              value={variable.name}
                              aria-label="Variable name"
                              aria-invalid={!isValidEnvVariableName(variable.name)}
                              required
                              onChange={(event) =>
                                updateVariableName(
                                  variable.lineIndex,
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={variable.value}
                              aria-label={`${variable.name || "New variable"} value`}
                              aria-invalid={variable.value.trim().length === 0}
                              required
                              onChange={(event) =>
                                updateVariableValue(
                                  variable.lineIndex,
                                  event.target.value,
                                )
                              }
                            />
                          </td>
                          <td>
                            <button
                              className="icon-button secondary env-variable-delete-button"
                              type="button"
                              aria-label={`Delete ${variable.name || "new variable"}`}
                              title="Delete variable"
                              onClick={() => deleteVariable(variable.lineIndex)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <footer className="env-files-footer">
              <div className="env-files-footer-left">
                <button
                  className="button secondary compact"
                  type="button"
                  disabled={!activeFile}
                  onClick={addVariable}
                >
                  <Plus size={14} />
                  Add Variable
                </button>
              </div>
              <div className="env-files-footer-right">
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
                  disabled={
                    !dirty || saving || !activeFile || Boolean(validationMessage)
                  }
                  onClick={save}
                  title={validationMessage ?? undefined}
                >
                  {saving ? "Saving" : "Save"}
                </button>
              </div>
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

function getVariablesValidationMessage(
  variables: ProjectEnvVariable[],
): string | null {
  if (variables.some((variable) => variable.name.trim().length === 0)) {
    return "Variable name is required.";
  }

  if (variables.some((variable) => variable.value.trim().length === 0)) {
    return "Variable value is required.";
  }

  if (variables.some((variable) => !isValidEnvVariableName(variable.name))) {
    return "Variable name must be a valid .env key.";
  }

  return null;
}

function isValidEnvVariableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim());
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
