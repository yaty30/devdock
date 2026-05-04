import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Trash2 } from "lucide-react";
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
  ...props
}: {
  label: string;
  value: string;
  browse?: boolean;
  onChange: (value: string) => void;
  onBrowse?: () => void;
} & Omit<ComponentProps<"input">, "value" | "onChange">): JSX.Element {
  return (
    <label className="settings-field-row">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...props}
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

const OUTCOME_OPTIONS: Array<{
  value: BuildOutcomeType;
  label: string;
  dotColor: string;
}> = [
  { value: "build-only", label: "Build only", dotColor: "var(--accent)" },
  {
    value: "build-and-deploy",
    label: "Build + deploy",
    dotColor: "var(--success)",
  },
];

const PROFILE_ROW_EXIT_MS = 180;

type BuildProfileField = "buttonName" | "profileName" | "goals";
type BuildProfileFieldErrors = Partial<
  Record<string, Partial<Record<BuildProfileField, boolean>>>
>;

function OutcomeSelect({
  value,
  onChange,
}: {
  value: BuildOutcomeType;
  onChange: (value: BuildOutcomeType) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>();
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const current =
    OUTCOME_OPTIONS.find((option) => option.value === value) ??
    OUTCOME_OPTIONS[0];

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function isOutsideSelect(target: EventTarget | null): boolean {
      if (!(target instanceof Node)) {
        return true;
      }

      return (
        !containerRef.current?.contains(target) &&
        !dropdownRef.current?.contains(target)
      );
    }

    function handleOutside(event: PointerEvent): void {
      if (isOutsideSelect(event.target)) {
        setOpen(false);
      }
    }

    function handleFocusOutside(event: FocusEvent): void {
      if (isOutsideSelect(event.target)) {
        setOpen(false);
      }
    }

    function handleWindowBlur(): void {
      setOpen(false);
    }

    document.addEventListener("pointerdown", handleOutside, true);
    document.addEventListener("focusin", handleFocusOutside);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", handleOutside, true);
      document.removeEventListener("focusin", handleFocusOutside);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    function positionDropdown(): void {
      const trigger = containerRef.current?.querySelector("button");
      if (!(trigger instanceof HTMLElement)) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const gap = 6;
      const dropdownHeight = OUTCOME_OPTIONS.length * 36 + 12;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const openUp = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

      setDropdownStyle({
        position: "fixed",
        top: openUp ? rect.top - dropdownHeight - gap : rect.bottom + gap,
        left: rect.left,
        right: "auto",
        width: Math.max(rect.width, 168),
        minWidth: Math.max(rect.width, 168),
        zIndex: 1000,
      });
    }

    positionDropdown();
    window.addEventListener("resize", positionDropdown);
    window.addEventListener("scroll", positionDropdown, true);

    return () => {
      window.removeEventListener("resize", positionDropdown);
      window.removeEventListener("scroll", positionDropdown, true);
    };
  }, [open]);

  const dropdown = open ? (
    <ul
      className="custom-select-dropdown custom-select-dropdown-portal"
      role="listbox"
      ref={dropdownRef}
      style={dropdownStyle}
    >
      {OUTCOME_OPTIONS.map((option) => (
        <li
          key={option.value}
          className={`custom-select-option${
            value === option.value ? " selected" : ""
          }`}
          role="option"
          aria-selected={value === option.value}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
          }}
        >
          <span
            className="custom-select-dot"
            style={{ background: option.dotColor }}
          />
          <span className="custom-select-option-label">{option.label}</span>
          {value === option.value ? (
            <Check size={13} className="custom-select-check" />
          ) : null}
        </li>
      ))}
    </ul>
  ) : null;

  return (
    <div className="custom-select build-outcome-select" ref={containerRef}>
      <button
        className="custom-select-trigger"
        type="button"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className="custom-select-dot"
          style={{ background: current.dotColor }}
        />
        <span className="custom-select-value">{current.label}</span>
        <ChevronDown
          size={13}
          className={`custom-select-chevron${open ? " open" : ""}`}
        />
      </button>
      {dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}

export function SettingsContent({
  selectedProject,
  settings,
  onSettingsSaved,
  onProjectDeleted,
  onProjectUpdated,
  onDirtyChange,
  onCancel,
}: {
  selectedProject: Project;
  settings: ProjectSettingsRecord;
  onSettingsSaved: (settings: ProjectSettingsRecord) => void;
  onProjectDeleted: () => void;
  onProjectUpdated: (project: Project) => void;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
}): JSX.Element {
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<SettingsTab>("general");
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(
    null,
  );
  const [draft, setDraft] = useState<ProjectSettingsRecord>(settings);
  const [projectNameDraft, setProjectNameDraft] = useState(
    selectedProject.name,
  );
  const [projectCodeDraft, setProjectCodeDraft] = useState(
    selectedProject.code,
  );
  const [saving, setSaving] = useState(false);
  const [validationBanner, setValidationBanner] = useState<{
    valid: boolean;
    errors: string[];
    message?: string;
  } | null>(null);
  const [validationClosing, setValidationClosing] = useState(false);
  const [profileFieldErrors, setProfileFieldErrors] =
    useState<BuildProfileFieldErrors>({});
  const [deletingProfileIds, setDeletingProfileIds] = useState<Set<string>>(
    () => new Set(),
  );
  const dismissTimerRef = useRef<number | null>(null);
  const closingTimerRef = useRef<number | null>(null);
  const profileScrollerRef = useRef<HTMLDivElement>(null);
  const profileDeleteTimersRef = useRef<Map<string, number>>(new Map());
  const previousProfileCountRef = useRef(settings.buildProfiles.length);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  const isDirty = useMemo(
    () =>
      JSON.stringify(draft) !== JSON.stringify(settings) ||
      projectNameDraft !== selectedProject.name ||
      projectCodeDraft !== selectedProject.code,
    [draft, settings, projectNameDraft, projectCodeDraft, selectedProject],
  );
  const savedProfileIds = useMemo(
    () => new Set(settings.buildProfiles.map((profile) => profile.id)),
    [settings.buildProfiles],
  );
  const mavenConfigComplete = useMemo(
    () =>
      Boolean(
        draft.maven.executable.trim() &&
        draft.maven.settingsXml.trim() &&
        draft.maven.pomXml.trim(),
      ),
    [draft.maven.executable, draft.maven.pomXml, draft.maven.settingsXml],
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
      profileDeleteTimersRef.current.forEach((timer) =>
        window.clearTimeout(timer),
      );
      profileDeleteTimersRef.current.clear();
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
    profileDeleteTimersRef.current.forEach((timer) =>
      window.clearTimeout(timer),
    );
    profileDeleteTimersRef.current.clear();
    setDraft(settings);
    setProjectNameDraft(selectedProject.name);
    setProjectCodeDraft(selectedProject.code);
    setProfileFieldErrors({});
    setDeletingProfileIds(new Set());
    previousProfileCountRef.current = settings.buildProfiles.length;
  }, [settings, selectedProject]);

  useEffect(() => {
    const currentProfileCount = draft.buildProfiles.length;
    const addedProfile = currentProfileCount > previousProfileCountRef.current;
    previousProfileCountRef.current = currentProfileCount;

    if (!addedProfile || activeSettingsTab !== "builders") {
      return undefined;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      const scroller = profileScrollerRef.current;
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeSettingsTab, draft.buildProfiles.length]);

  useEffect(() => {
    if (mavenConfigComplete || !draft.maven.skipTests) {
      return;
    }

    setDraft((current) => ({
      ...current,
      maven: { ...current.maven, skipTests: false },
    }));
  }, [draft.maven.skipTests, mavenConfigComplete]);

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

    (["buttonName", "profileName", "goals"] as BuildProfileField[]).forEach(
      (field) => {
        const value = patch[field];
        if (typeof value !== "string" || !value.trim()) {
          return;
        }

        setProfileFieldErrors((current) => {
          const profileErrors = current[profileId];
          if (!profileErrors?.[field]) {
            return current;
          }

          const nextProfileErrors = { ...profileErrors };
          delete nextProfileErrors[field];
          const next = { ...current };
          if (Object.keys(nextProfileErrors).length === 0) {
            delete next[profileId];
          } else {
            next[profileId] = nextProfileErrors;
          }
          return next;
        });
      },
    );
  }

  function addProfile(): void {
    const id = `profile-${Date.now()}`;
    setDraft((current) => ({
      ...current,
      buildProfiles: [
        ...current.buildProfiles,
        {
          id,
          buttonName: "",
          profileName: "",
          goals: "",
          confirm: false,
          outcomeType: "build-only",
        },
      ],
    }));
  }

  function removeProfile(profileId: string): void {
    if (profileDeleteTimersRef.current.has(profileId)) {
      return;
    }

    setDeletingProfileIds((current) => {
      const next = new Set(current);
      next.add(profileId);
      return next;
    });

    const timer = window.setTimeout(() => {
      setDraft((current) => ({
        ...current,
        buildProfiles: current.buildProfiles.filter(
          (profile) => profile.id !== profileId,
        ),
      }));
      setProfileFieldErrors((current) => {
        if (!current[profileId]) {
          return current;
        }
        const next = { ...current };
        delete next[profileId];
        return next;
      });
      setDeletingProfileIds((current) => {
        const next = new Set(current);
        next.delete(profileId);
        return next;
      });
      profileDeleteTimersRef.current.delete(profileId);
    }, PROFILE_ROW_EXIT_MS);

    profileDeleteTimersRef.current.set(profileId, timer);
  }

  function profileInputClass(
    profileId: string,
    field: BuildProfileField,
  ): string | undefined {
    return profileFieldErrors[profileId]?.[field] ? "field-error" : undefined;
  }

  function profileInputInvalid(
    profileId: string,
    field: BuildProfileField,
  ): boolean {
    return profileFieldErrors[profileId]?.[field] === true;
  }

  function profileRowClass(profile: BuildProfileRecord): string | undefined {
    const classes: string[] = [];
    if (!savedProfileIds.has(profile.id)) {
      classes.push("profile-row-new");
    }
    if (deletingProfileIds.has(profile.id)) {
      classes.push("profile-row-removing");
    }
    return classes.length > 0 ? classes.join(" ") : undefined;
  }

  function normalizeDraft(): ProjectSettingsRecord {
    return {
      ...draft,
      defaultBranch: draft.defaultBranch.trim() || "main",
      remote: draft.remote.trim() || "origin",
      maven: {
        ...draft.maven,
        skipTests: mavenConfigComplete ? draft.maven.skipTests : false,
      },
    };
  }

  function validateProfiles(): {
    errors: string[];
    profileErrors: BuildProfileFieldErrors;
  } {
    const errors: string[] = [];
    const profileErrors: BuildProfileFieldErrors = {};

    const seenNames = new Set<string>();
    const duplicateNames = new Set<string>();
    let missingProfileName = false;
    let missingButtonName = false;
    let missingGoals = false;

    draft.buildProfiles.forEach((profile) => {
      const name = profile.buttonName.trim().toLowerCase();
      if (!name) {
        missingButtonName = true;
        profileErrors[profile.id] = {
          ...profileErrors[profile.id],
          buttonName: true,
        };
      } else if (seenNames.has(name)) {
        duplicateNames.add(profile.buttonName.trim());
      } else {
        seenNames.add(name);
      }

      if (!profile.profileName.trim()) {
        missingProfileName = true;
        profileErrors[profile.id] = {
          ...profileErrors[profile.id],
          profileName: true,
        };
      }

      if (!profile.goals.trim()) {
        missingGoals = true;
        profileErrors[profile.id] = {
          ...profileErrors[profile.id],
          goals: true,
        };
      }
    });

    if (missingButtonName) {
      errors.push("Build Profiles: name is required");
    }

    if (missingProfileName) {
      errors.push("Build Profiles: profile is required");
    }

    if (missingGoals) {
      errors.push("Build Profiles: goal is required");
    }

    duplicateNames.forEach((name) =>
      errors.push(`Build Profiles: duplicate name "${name}"`),
    );

    return { errors, profileErrors };
  }

  async function validateAll(showResult: boolean): Promise<{
    valid: boolean;
    errors: string[];
    profileErrors: BuildProfileFieldErrors;
    settings: ProjectSettingsRecord;
    name: string;
    code: string;
  }> {
    const trimmedName = projectNameDraft.trim();
    const trimmedCode = projectCodeDraft.trim().toUpperCase();
    const normalizedSettings = normalizeDraft();
    const { errors: profileErrorsList, profileErrors } = validateProfiles();
    setProfileFieldErrors(profileErrors);
    let backendErrors: string[] = [];

    try {
      backendErrors = await window.ivsDashboard.validateProjectSettings(
        selectedProject.id,
        trimmedName,
        trimmedCode,
        normalizedSettings,
      );
    } catch (error) {
      backendErrors = [
        error instanceof Error ? error.message : "Validation failed",
      ];
    }

    const errors = [...backendErrors, ...profileErrorsList];
    if (showResult) {
      showBanner({ valid: errors.length === 0, errors });
    }

    return {
      valid: errors.length === 0,
      errors,
      profileErrors,
      settings: normalizedSettings,
      name: trimmedName,
      code: trimmedCode,
    };
  }

  async function save(): Promise<void> {
    const validation = await validateAll(false);
    if (!validation.valid) {
      showBanner({ valid: false, errors: validation.errors });
      return;
    }

    const {
      settings: normalizedSettings,
      name: trimmedName,
      code: trimmedCode,
    } = validation;

    setSaving(true);
    const settingsSave = window.ivsDashboard.saveProjectSettings(
      selectedProject.id,
      normalizedSettings,
    );
    const nameChanged =
      trimmedName !== selectedProject.name ||
      trimmedCode !== selectedProject.code;
    const projectSave = nameChanged
      ? window.ivsDashboard.updateProject(
          selectedProject.id,
          trimmedName,
          trimmedCode,
        )
      : Promise.resolve(null);

    Promise.all([settingsSave, projectSave])
      .then(([saved, updatedProject]) => {
        setSaving(false);
        setDraft(saved);
        if (updatedProject) {
          onProjectUpdated(updatedProject);
        }
        showBanner({ valid: true, errors: [], message: "Settings saved." });
        onSettingsSaved(saved);
      })
      .catch((error) => {
        console.error(error);
        setSaving(false);
        showBanner({
          valid: false,
          errors: [error instanceof Error ? error.message : "Save failed"],
        });
      });
  }

  function validateDraft(): void {
    void validateAll(true);
  }

  function cancel(): void {
    setDraft(settings);
    setProjectNameDraft(selectedProject.name);
    setProjectCodeDraft(selectedProject.code);
    setProfileFieldErrors({});
    onDirtyChangeRef.current(false);
    onCancel();
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
            : validationBanner.errors.map((e) => <div key={e}>{e}</div>)}
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
                <span>Name</span>
                <strong>{selectedProject.name}</strong>
                <span>Tag</span>
                <strong>{selectedProject.code}</strong>
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
            <Panel title="Project" className="settings-form-panel">
              <FieldRow
                label="Project name"
                value={projectNameDraft}
                onChange={(value) => setProjectNameDraft(value)}
                maxLength={20}
              />
              <FieldRow
                label="Project tag"
                value={projectCodeDraft}
                onChange={(value) => setProjectCodeDraft(value.toUpperCase())}
                maxLength={3}
              />
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
                    checked={mavenConfigComplete && draft.maven.skipTests}
                    disabled={!mavenConfigComplete}
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
              titleMeta={
                <span className="build-profiles-count-badge">
                  {draft.buildProfiles.length}
                </span>
              }
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
              <div
                className="build-profiles-table-wrap"
                ref={profileScrollerRef}
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
                      <tr key={profile.id} className={profileRowClass(profile)}>
                        <td>
                          <div className="build-profile-name-cell">
                            {!savedProfileIds.has(profile.id) ? (
                              <span
                                className="build-profile-new-dot"
                                aria-hidden="true"
                              />
                            ) : null}
                            <input
                              className={profileInputClass(
                                profile.id,
                                "buttonName",
                              )}
                              type="text"
                              value={profile.buttonName}
                              aria-invalid={profileInputInvalid(
                                profile.id,
                                "buttonName",
                              )}
                              onChange={(event) =>
                                updateProfile(profile.id, {
                                  buttonName: event.target.value,
                                })
                              }
                            />
                          </div>
                        </td>
                        <td>
                          <input
                            className={profileInputClass(
                              profile.id,
                              "profileName",
                            )}
                            type="text"
                            value={profile.profileName}
                            aria-invalid={profileInputInvalid(
                              profile.id,
                              "profileName",
                            )}
                            onChange={(event) =>
                              updateProfile(profile.id, {
                                profileName: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className={profileInputClass(profile.id, "goals")}
                            type="text"
                            value={profile.goals}
                            aria-invalid={profileInputInvalid(
                              profile.id,
                              "goals",
                            )}
                            onChange={(event) =>
                              updateProfile(profile.id, {
                                goals: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td>
                          <OutcomeSelect
                            value={profile.outcomeType}
                            onChange={(outcomeType) =>
                              updateProfile(profile.id, {
                                outcomeType,
                              })
                            }
                          />
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
                            aria-label={`Remove ${profile.buttonName || "profile"}`}
                            title="Remove profile"
                            disabled={deletingProfileIds.has(profile.id)}
                            onClick={() => removeProfile(profile.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              onClick={cancel}
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
