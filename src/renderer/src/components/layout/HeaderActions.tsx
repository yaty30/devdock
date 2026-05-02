import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  LoaderCircle,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { ConfirmDialog } from "../dialogs/ConfirmDialog";
import type {
  BuildProfileRecord,
  GitStatusRecord,
  ProjectSettingsRecord,
  RecentBuildRecord,
  ServiceName,
  ServiceStatusRecord,
} from "../../types";

export function HeaderActions({
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
  return (
    <div className="header-actions">
      <ServiceControlGroup
        projectId={projectId}
        statuses={statuses}
        disabled={disabled}
      />
      <BuildActionsDropdown
        projectId={projectId}
        settings={settings}
        recentBuilds={recentBuilds}
        gitStatus={gitStatus}
        disabled={disabled}
      />
    </div>
  );
}

function BuildActionsDropdown({
  projectId,
  settings,
  recentBuilds,
  gitStatus,
  disabled = false,
}: {
  projectId: string;
  settings: ProjectSettingsRecord;
  recentBuilds: RecentBuildRecord[];
  gitStatus: GitStatusRecord;
  disabled?: boolean;
}): JSX.Element {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [openMode, setOpenMode] = useState<"hover" | "click" | null>(null);
  const [runningProfileId, setRunningProfileId] = useState<string | null>(null);
  const [runningProfileName, setRunningProfileName] = useState<string | null>(
    null,
  );
  const [pendingBuild, setPendingBuild] = useState<BuildProfileRecord | null>(
    null,
  );
  const [stoppingBuild, setStoppingBuild] = useState(false);
  const latestBuild = recentBuilds[0];
  const latestBuildRunning = latestBuild?.status === "Running";
  const open = openMode !== null;
  const buildRunning = runningProfileId !== null || latestBuildRunning;

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
    if (disabled || buildRunning) {
      setOpenMode(null);
    }
  }, [disabled, buildRunning]);

  useEffect(() => {
    if (!latestBuildRunning) {
      setRunningProfileId(null);
      setRunningProfileName(null);
      setStoppingBuild(false);
    }
  }, [latestBuildRunning]);

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

  function confirmBuildTitle(profile: BuildProfileRecord): string {
    const name = `${profile.buttonName} ${profile.profileName}`.toLowerCase();
    return name.includes("prod") || name.includes("production")
      ? "Run Production Build?"
      : `Run ${profile.buttonName} Build?`;
  }

  return (
    <>
      <div
        className="build-dropdown"
        ref={dropdownRef}
        onMouseEnter={() => {
          if (!disabled && !buildRunning && openMode !== "click") {
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
          disabled={disabled || stoppingBuild}
          onClick={() => {
            if (buildRunning) {
              stopBuild();
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
            {buildRunning ? "Stop Build" : (runningProfileName ?? "Run Build")}
          </span>
          {stoppingBuild ? (
            <LoaderCircle className="button-spinner" size={16} />
          ) : buildRunning ? (
            <span className="build-running-profile">
              {runningProfileName ?? latestBuild?.profile ?? ""}
            </span>
          ) : (
            <ChevronDown size={16} />
          )}
        </button>

        <div
          className={`build-dropdown-popover${open ? " open" : ""}`}
          aria-hidden={!open}
        >
          <div className="build-dropdown-menu" role="menu">
            {settings.buildProfiles.map((profile) => (
              <button
                type="button"
                role="menuitem"
                key={profile.buttonName}
                disabled={disabled || buildRunning}
                onClick={() => {
                  setOpenMode(null);
                  if (profile.confirm) {
                    setPendingBuild(profile);
                    return;
                  }
                  runBuild(profile);
                }}
              >
                <Play size={14} />
                <span>
                  {runningProfileId === profile.id
                    ? "Running..."
                    : profile.buttonName}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {pendingBuild ? (
        <ConfirmDialog
          title={confirmBuildTitle(pendingBuild)}
          message="Review the target before running this build."
          details={
            <BuildConfirmDetails profile={pendingBuild} gitStatus={gitStatus} />
          }
          confirmLabel="Run Build"
          cancelLabel="Cancel"
          variant="warning"
          onClose={() => setPendingBuild(null)}
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
  const rows = [
    ["Branch", gitStatus.branch || "unavailable"],
    ["Commit", gitStatus.commit ? `@${gitStatus.commit}` : "unavailable"],
    ["Git status", gitStatus.status === "Clean" ? "Clean" : "Dirty"],
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

function ServiceControlGroup({
  projectId,
  statuses,
  disabled = false,
}: {
  projectId: string;
  statuses: ServiceStatusRecord[];
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
          isServerStarting ||
          (isBusy && busyAction === "start");

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
