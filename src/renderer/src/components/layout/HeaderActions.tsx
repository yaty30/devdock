import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Cog,
  LoaderCircle,
  Play,
  RotateCcw,
  Settings,
  Square,
} from "lucide-react";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import type {
  BuildProfileRecord,
  FontSizeMode,
  GitStatusRecord,
  ProjectSettingsRecord,
  RecentBuildRecord,
  ServiceName,
  ServiceStatusRecord,
} from "../../types";
import { RUNNING_SERVER_LIMIT_MESSAGE } from "../../../../shared/appLimits";

const BUILD_PROFILE_LABEL_MAX_LENGTH = 20;

export function HeaderActions({
  projectId,
  settings,
  statuses,
  recentBuilds,
  gitStatus,
  fontSizeMode,
  onFontSizeChange,
  onSettingsClick,
  onServiceWarning,
  disabled = false,
}: {
  projectId: string;
  settings: ProjectSettingsRecord;
  statuses: ServiceStatusRecord[];
  recentBuilds: RecentBuildRecord[];
  gitStatus: GitStatusRecord;
  fontSizeMode: FontSizeMode;
  onFontSizeChange: (mode: FontSizeMode) => void;
  onSettingsClick: () => void;
  onServiceWarning: (message: string) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div className="header-actions">
      <ServiceControlGroup
        projectId={projectId}
        statuses={statuses}
        onServiceWarning={onServiceWarning}
        disabled={disabled}
      />
      <BuildActionsDropdown
        projectId={projectId}
        settings={settings}
        statuses={statuses}
        recentBuilds={recentBuilds}
        gitStatus={gitStatus}
        disabled={disabled}
      />
      <HeaderUtilityActions
        fontSizeMode={fontSizeMode}
        onFontSizeChange={onFontSizeChange}
        onSettingsClick={onSettingsClick}
        disabled={disabled}
      />
    </div>
  );
}

export function HeaderUtilityActions({
  fontSizeMode,
  onFontSizeChange,
  onSettingsClick,
  disabled = false,
  settingsIcon = "settings",
}: {
  fontSizeMode: FontSizeMode;
  onFontSizeChange: (mode: FontSizeMode) => void;
  onSettingsClick: () => void;
  disabled?: boolean;
  settingsIcon?: "settings" | "cog";
}): JSX.Element {
  const SettingsButtonIcon = settingsIcon === "cog" ? Cog : Settings;

  return (
    <>
      <FontSizeDropdown
        value={fontSizeMode}
        onChange={onFontSizeChange}
        disabled={disabled}
      />
      <button
        className="icon-button secondary header-settings-button"
        type="button"
        aria-label="Settings"
        title="Settings"
        disabled={disabled}
        onClick={onSettingsClick}
      >
        <SettingsButtonIcon size={18} />
      </button>
    </>
  );
}

const FONT_SIZE_OPTIONS: Array<{ value: FontSizeMode; label: string }> = [
  { value: "large", label: "Large" },
  { value: "regular", label: "Regular" },
  { value: "small", label: "Small" },
];

function FontSizeDropdown({
  value,
  onChange,
  disabled = false,
}: {
  value: FontSizeMode;
  onChange: (mode: FontSizeMode) => void;
  disabled?: boolean;
}): JSX.Element {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [openMode, setOpenMode] = useState<"hover" | "click" | null>(null);
  const open = openMode !== null;

  useEffect(() => {
    if (openMode !== "click") {
      return undefined;
    }

    function closeOnOutsideClick(event: MouseEvent): void {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpenMode(null);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [openMode]);

  useEffect(() => {
    if (disabled) {
      setOpenMode(null);
    }
  }, [disabled]);

  return (
    <div
      className="build-dropdown font-size-dropdown"
      ref={dropdownRef}
      onMouseEnter={() => {
        if (!disabled && openMode !== "click") {
          setOpenMode("hover");
        }
      }}
      onMouseLeave={() => {
        if (openMode === "hover") {
          setOpenMode(null);
        }
      }}
    >
      <button
        className={`icon-button secondary header-settings-button font-size-dropdown-trigger${
          open ? " open" : ""
        }`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Font size"
        title="Font size"
        disabled={disabled}
        onClick={() =>
          setOpenMode((current) => (current === "click" ? null : "click"))
        }
      >
        <FontSizeIcon />
      </button>

      <div
        className={`build-dropdown-popover${open ? " open" : ""}`}
        aria-hidden={!open}
      >
        <div className="build-dropdown-menu" role="menu">
          {FONT_SIZE_OPTIONS.map((option) => (
            <button
              className={value === option.value ? "active" : undefined}
              type="button"
              role="menuitemradio"
              aria-checked={value === option.value}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpenMode(null);
              }}
            >
              <span className={`font-size-option-swatch ${option.value}`}>
                A
              </span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function FontSizeIcon(): JSX.Element {
  return (
    <svg
      focusable="false"
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="currentColor"
    >
      <path d="M9.93 13.5h4.14L12 7.98zM20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m-4.29 15.88-.9-2.38H9.17l-.89 2.37c-.14.38-.5.63-.91.63-.68 0-1.15-.69-.9-1.32l4.25-10.81c.22-.53.72-.87 1.28-.87s1.06.34 1.27.87l4.25 10.81c.25.63-.22 1.32-.9 1.32-.4 0-.76-.25-.91-.62" />
    </svg>
  );
}

function BuildActionsDropdown({
  projectId,
  settings,
  statuses,
  recentBuilds,
  gitStatus,
  disabled = false,
}: {
  projectId: string;
  settings: ProjectSettingsRecord;
  statuses: ServiceStatusRecord[];
  recentBuilds: RecentBuildRecord[];
  gitStatus: GitStatusRecord;
  disabled?: boolean;
}): JSX.Element {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const confirmRequestRef = useRef(0);
  const [openMode, setOpenMode] = useState<"hover" | "click" | null>(null);
  const [runningProfileId, setRunningProfileId] = useState<string | null>(null);
  const [runningProfileName, setRunningProfileName] = useState<string | null>(
    null,
  );
  const [pendingBuild, setPendingBuild] = useState<BuildProfileRecord | null>(
    null,
  );
  const [confirmGitStatus, setConfirmGitStatus] =
    useState<GitStatusRecord>(gitStatus);
  const [confirmGitLoading, setConfirmGitLoading] = useState(false);
  const [stoppingBuild, setStoppingBuild] = useState(false);
  const latestBuild = recentBuilds[0];
  const latestBuildRunning = latestBuild?.status === "Running";
  const open = openMode !== null;
  const buildRunning = runningProfileId !== null || latestBuildRunning;
  const wildflyStatus = statuses.find((status) => status.service === "wildfly");
  const wildflyAvailable = wildflyStatus?.state === "running";
  const buildDisabled = disabled || (!buildRunning && !wildflyAvailable);
  const latestProfileUsedToday = findLatestBuildProfileUsedToday(
    recentBuilds,
    settings.buildProfiles,
  );

  useEffect(() => {
    if (openMode !== "click") {
      return undefined;
    }

    function closeOnOutsideClick(event: MouseEvent): void {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpenMode(null);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [openMode]);

  useEffect(() => {
    if (buildDisabled || buildRunning) {
      setOpenMode(null);
    }
  }, [buildDisabled, buildRunning]);

  useEffect(() => {
    if (!latestBuildRunning) {
      setRunningProfileId(null);
      setRunningProfileName(null);
      setStoppingBuild(false);
    }
  }, [latestBuildRunning]);

  useEffect(() => {
    function handleBuildHotkey(event: KeyboardEvent): void {
      if (
        buildDisabled ||
        buildRunning ||
        isEditableHotkeyTarget(event.target)
      ) {
        return;
      }

      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }

      const profileIndex = Number(event.key) - 1;
      if (
        Number.isInteger(profileIndex) &&
        profileIndex >= 0 &&
        profileIndex < settings.buildProfiles.length
      ) {
        event.preventDefault();
        triggerBuild(settings.buildProfiles[profileIndex]);
      }
    }

    window.addEventListener("keydown", handleBuildHotkey);
    return () => {
      window.removeEventListener("keydown", handleBuildHotkey);
    };
  }, [
    buildDisabled,
    buildRunning,
    projectId,
    settings.buildProfiles,
    gitStatus,
  ]);

  function stopBuild(): void {
    setStoppingBuild(true);
    setOpenMode(null);
    window.ivsDashboard
      .stopBuild(projectId)
      .catch((error) => console.error(error))
      .finally(() => setStoppingBuild(false));
  }

  function runBuild(profile: BuildProfileRecord): void {
    setRunningProfileId(profile.id);
    setRunningProfileName(profile.buttonName);
    window.ivsDashboard
      .runBuild(projectId, profile.id)
      .catch((error) => console.error(error))
      .finally(() => {
        setRunningProfileId(null);
        setRunningProfileName(null);
      });
  }

  function triggerBuild(profile: BuildProfileRecord): void {
    setOpenMode(null);
    if (profile.confirm) {
      openBuildConfirmation(profile);
      return;
    }
    runBuild(profile);
  }

  function openBuildConfirmation(profile: BuildProfileRecord): void {
    const requestId = confirmRequestRef.current + 1;
    confirmRequestRef.current = requestId;
    setPendingBuild(profile);
    setConfirmGitStatus(gitStatus);
    setConfirmGitLoading(true);
    window.ivsDashboard
      .getGitStatus(projectId)
      .then((status) => {
        if (confirmRequestRef.current === requestId) {
          setConfirmGitStatus(status);
        }
      })
      .catch((error) => console.error(error))
      .finally(() => {
        if (confirmRequestRef.current === requestId) {
          setConfirmGitLoading(false);
        }
      });
  }

  function closeBuildConfirmation(): void {
    confirmRequestRef.current += 1;
    setConfirmGitLoading(false);
    setPendingBuild(null);
  }

  function confirmBuildTitle(profile: BuildProfileRecord): string {
    const name = `${profile.buttonName} ${profile.profileName}`.toLowerCase();
    return name.includes("prod") || name.includes("production")
      ? "Run Production Build?"
      : `Run ${profile.buttonName} Build?`;
  }

  function formatRunBuildLabel(profile: BuildProfileRecord): string {
    return `Run ${truncateBuildProfileLabel(profile.buttonName)} Build`;
  }

  return (
    <>
      <div
        className="build-dropdown"
        ref={dropdownRef}
        onMouseEnter={() => {
          if (!buildDisabled && !buildRunning && openMode !== "click") {
            setOpenMode("hover");
          }
        }}
        onMouseLeave={() => {
          if (openMode === "hover") {
            setOpenMode(null);
          }
        }}
      >
        <button
          className={`button primary build-dropdown-trigger${
            open ? " open" : ""
          }${buildRunning ? " stop-build-trigger" : ""}`}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          title={
            buildDisabled && !buildRunning
              ? "Start WildFly before running a build"
              : latestProfileUsedToday
                ? `Run ${latestProfileUsedToday.buttonName} Build`
              : undefined
          }
          disabled={buildDisabled || stoppingBuild}
          onClick={() => {
            if (buildRunning) {
              stopBuild();
              return;
            }
            if (latestProfileUsedToday) {
              triggerBuild(latestProfileUsedToday);
              return;
            }
            setOpenMode((current) => (current === "click" ? null : "click"));
          }}
        >
          {buildRunning ? (
            <Square size={15} fill="currentColor" strokeWidth={2.5} />
          ) : (
            <Play size={15} />
          )}
          <span className="build-dropdown-trigger-label">
            {buildRunning
              ? "Stop Build"
              : latestProfileUsedToday
                ? formatRunBuildLabel(latestProfileUsedToday)
                : "Run Build"}
          </span>
          {stoppingBuild ? (
            <LoaderCircle className="button-spinner" size={16} />
          ) : buildRunning ? (
            <LoaderCircle className="button-spinner" size={16} />
          ) : (
            <ChevronDown size={16} />
          )}
        </button>

        <div
          className={`build-dropdown-popover${open ? " open" : ""}`}
          aria-hidden={!open}
        >
          <div className="build-dropdown-menu" role="menu">
            {settings.buildProfiles.map((profile, index) => (
              <button
                type="button"
                role="menuitem"
                key={profile.buttonName}
                title={profile.buttonName}
                disabled={buildDisabled || buildRunning}
                onClick={() => {
                  triggerBuild(profile);
                }}
              >
                <Play size={14} />
                <span>
                  {runningProfileId === profile.id
                    ? "Running..."
                    : truncateBuildProfileLabel(profile.buttonName)}
                </span>
                <kbd>Ctrl+{index + 1}</kbd>
              </button>
            ))}
          </div>
        </div>
      </div>

      {pendingBuild ? (
        <ConfirmDialog
          title={confirmBuildTitle(pendingBuild)}
          message={
            confirmGitLoading
              ? "Refreshing Git status before running this build."
              : "Review the target before running this build."
          }
          details={
            <BuildConfirmDetails
              profile={pendingBuild}
              gitStatus={confirmGitStatus}
            />
          }
          confirmLabel={confirmGitLoading ? "Checking Git" : "Run Build"}
          cancelLabel="Cancel"
          variant="warning"
          onClose={closeBuildConfirmation}
          confirmDisabled={confirmGitLoading}
          onConfirm={() => runBuild(pendingBuild)}
        />
      ) : null}
    </>
  );
}

function BuildConfirmDetails({
  profile,
  gitStatus,
}: {
  profile: BuildProfileRecord;
  gitStatus: GitStatusRecord;
}): JSX.Element {
  const changeLines = gitChangeLines(gitStatus);
  const hasChanges = gitStatus.status !== "Clean" || changeLines.length > 0;
  const statusLabel =
    gitStatus.branch === "unavailable" || gitStatus.commit === "unavailable"
      ? gitStatus.status
      : hasChanges
        ? `${changeLines.length} uncommitted change${
            changeLines.length === 1 ? "" : "s"
          }`
        : "Clean";
  const rows = [
    ["Branch", gitStatus.branch || "unavailable"],
    ["Commit", gitStatus.commit ? `@${gitStatus.commit}` : "unavailable"],
    ["Git status", statusLabel],
    ["Profile", profile.profileName],
    ["Goal", profile.goals],
  ];

  return (
    <>
      {rows.map(([label, value]) => (
        <div className="confirm-dialog-detail-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </>
  );
}

function findLatestBuildProfileUsedToday(
  builds: RecentBuildRecord[],
  profiles: BuildProfileRecord[],
): BuildProfileRecord | null {
  const todayBuild = builds.find((build) => isLocalToday(build.startedAt));
  if (!todayBuild) {
    return null;
  }

  const normalizedBuildProfile = todayBuild.profile.trim().toLowerCase();
  return (
    profiles.find((profile) =>
      [
        profile.buttonName,
        profile.profileName,
        `${profile.buttonName} ${profile.profileName}`,
      ]
        .map((value) => value.trim().toLowerCase())
        .includes(normalizedBuildProfile),
    ) ?? null
  );
}

function truncateBuildProfileLabel(label: string): string {
  return label.length > BUILD_PROFILE_LABEL_MAX_LENGTH
    ? `${label.slice(0, BUILD_PROFILE_LABEL_MAX_LENGTH - 3)}...`
    : label;
}

function isLocalToday(value: string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isEditableHotkeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable ||
    target.closest(".cm-editor") !== null
  );
}

function gitChangeLines(gitStatus: GitStatusRecord): string[] {
  return gitStatus.lines
    .map((line) => line.replace(/^\d{2}:\d{2}:\d{2}\s+/, "").trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("Repository:") &&
        !line.startsWith("Branch:") &&
        !line.startsWith("Commit:") &&
        line !== "Working tree clean",
    );
}

function ServiceControlGroup({
  projectId,
  statuses,
  onServiceWarning,
  disabled = false,
}: {
  projectId: string;
  statuses: ServiceStatusRecord[];
  onServiceWarning: (message: string) => void;
  disabled?: boolean;
}): JSX.Element {
  const [busyService, setBusyService] = useState<ServiceName | null>(null);
  const [busyAction, setBusyAction] = useState<
    "start" | "stop" | "restart" | null
  >(null);
  const serviceStates = new Map(
    statuses.map((status) => [status.service, status.state]),
  );

  function runAction(
    service: ServiceName,
    action: "start" | "stop" | "restart",
  ): void {
    setBusyService(service);
    setBusyAction(action);
    window.ivsDashboard
      .serviceAction(projectId, service, action)
      .then((status) => {
        if (status.message === RUNNING_SERVER_LIMIT_MESSAGE) {
          onServiceWarning(status.message);
        }
      })
      .catch((error) => console.error(error))
      .finally(() => {
        setBusyService(null);
        setBusyAction(null);
      });
  }

  return (
    <div className="service-controls" aria-label="Service controls">
      {(
        [
          ["frontend", "Frontend"],
          ["wildfly", "WildFly"],
        ] as const
      ).map(([service, label]) => {
        const serviceName = service as ServiceName;
        const state = serviceStates.get(serviceName);
        const isRunning = state === "running";
        const isServerStarting = state === "starting";
        const isServerStopping = state === "stopping";
        const isBusy = busyService === serviceName;
        const isStopping =
          isServerStopping ||
          (isBusy &&
            (busyAction === "stop" ||
              (busyAction === "restart" && !isServerStarting)));
        const isStarting =
          isServerStarting || (isBusy && busyAction === "start");

        // Slot 1 shows Terminate when running or in the middle of starting;
        // otherwise shows Start.
        const showTerminate = isRunning || isStarting || isStopping;

        // Restart is only useful when the service is up or coming up.
        const restartEnabled = isRunning || isStarting;

        // Dot reflects local transitions optimistically; otherwise mirrors
        // the server-reported state.
        const dotClass = isStopping
          ? "stopping"
          : isStarting
            ? "starting"
            : (state ?? "unknown");

        return (
          <div className="service-control-card" key={service}>
            <span className="service-control-label">
              <span className={`service-status-dot ${dotClass}`} />
              <span>{label}</span>
            </span>
            <div className="service-action-group">
              <button
                className={`service-action-button ${showTerminate ? "terminate" : "start"}`}
                type="button"
                aria-label={
                  showTerminate ? `Terminate ${label}` : `Start ${label}`
                }
                title={showTerminate ? `Terminate ${label}` : `Start ${label}`}
                disabled={disabled || isBusy}
                onClick={() =>
                  runAction(serviceName, showTerminate ? "stop" : "start")
                }
              >
                {showTerminate ? (
                  <Square size={14} fill="currentColor" strokeWidth={2.5} />
                ) : (
                  <Play size={14} fill="currentColor" strokeWidth={2.5} />
                )}
              </button>
              <button
                className="service-action-button restart"
                type="button"
                aria-label={`Restart ${label}`}
                title={`Restart ${label}`}
                disabled={disabled || isBusy || !restartEnabled}
                onClick={() => runAction(serviceName, "restart")}
              >
                <RotateCcw size={14} strokeWidth={3} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
