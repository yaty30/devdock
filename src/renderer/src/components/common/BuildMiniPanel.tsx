import { useEffect, useState } from "react";
import { Minimize2, Package } from "lucide-react";
import type { ProjectRecord, RecentBuildRecord } from "../../types";

export type BuildMiniPanelItem = {
  project: ProjectRecord;
  build: RecentBuildRecord;
  debug?: boolean;
};

export function BuildMiniPanel({
  items,
  minimized,
  onMinimize,
  onRestore,
  onClearCompleted,
  onOpenProject,
  onDismissRecord,
}: {
  items: BuildMiniPanelItem[];
  minimized: boolean;
  onMinimize: () => void;
  onRestore: () => void;
  onClearCompleted: () => void;
  onOpenProject: (project: ProjectRecord) => void;
  onDismissRecord: (item: BuildMiniPanelItem) => void;
}): JSX.Element {
  const now = useAppNow(1000);
  const buildCount = items.length;
  const runningCount = items.filter(
    (item) => item.build.status === "Running",
  ).length;
  const showClearCompleted = buildCount > 0 && runningCount === 0;
  const restoreStatus = getBuildMiniRestoreStatus(items);

  return (
    <div
      className={`build-mini-dock${minimized ? " minimized" : " expanded"}`}
      aria-live="polite"
    >
      <button
        className={`build-mini-restore ${restoreStatus}`}
        type="button"
        aria-label="Show build progress"
        title="Show build progress"
        onClick={onRestore}
      >
        <Package size={18} />
      </button>
      <section className="build-mini-panel" aria-label="Build progress">
        <header className="build-mini-header">
          <span className="build-mini-icon">
            <Package size={18} />
          </span>
          <div>
            <h2>{runningCount > 0 ? "Build Running" : "Build Complete"}</h2>
            <p>{getBuildMiniSummary(buildCount, runningCount)}</p>
          </div>
          <div className="build-mini-actions">
            {showClearCompleted ? (
              <button
                className="build-mini-clear"
                type="button"
                onClick={onClearCompleted}
              >
                Clear
              </button>
            ) : null}
            <button
              className="build-mini-minimize"
              type="button"
              aria-label="Minimize build progress"
              title="Minimize"
              onClick={onMinimize}
            >
              <Minimize2 size={15} />
            </button>
          </div>
        </header>
        <div className="build-mini-list">
          {items.map((item) => {
            const elapsedLabel = formatBuildMiniElapsed(item.build, now);
            const title =
              item.build.outcomeType === "build-and-deploy"
                ? "Build & Deploy"
                : "WAR Build";

            return (
              <button
                className="build-mini-item"
                type="button"
                key={`${item.project.id}-${item.build.id}`}
                onClick={() => {
                  onDismissRecord(item);
                  onOpenProject(item.project);
                }}
              >
                <span
                  className={`build-mini-item-status ${getBuildMiniStatusClass(
                    item.build.status,
                  )}`}
                />
                <span className="build-mini-item-copy">
                  <strong>
                    {item.project.name}
                    {item.debug ? " (debug)" : ""}
                  </strong>
                  <span>
                    {title} - {item.build.profile}
                  </span>
                </span>
                <span className="build-mini-item-meta">
                  <strong>{elapsedLabel}</strong>
                  <span>{item.build.status}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function getBuildMiniRecordKey(item: BuildMiniPanelItem): string {
  return `${item.project.id}:${item.build.id}`;
}

function getBuildMiniSummary(buildCount: number, runningCount: number): string {
  if (runningCount > 0) {
    return `${runningCount} active ${runningCount === 1 ? "project" : "projects"}`;
  }
  return `${buildCount} recent ${buildCount === 1 ? "record" : "records"}`;
}

function getBuildMiniRestoreStatus(items: BuildMiniPanelItem[]): string {
  if (items.some((item) => item.build.status === "Running")) {
    return "running";
  }
  if (items.some((item) => item.build.status === "Failed")) {
    return "failed";
  }
  if (items.some((item) => item.build.status === "Stopped")) {
    return "stopped";
  }
  if (items.some((item) => item.build.status === "Success")) {
    return "success";
  }
  return "running";
}

function getBuildMiniStatusClass(status: RecentBuildRecord["status"]): string {
  if (status === "Failed") {
    return "failed";
  }
  if (status === "Stopped") {
    return "stopped";
  }
  if (status === "Success") {
    return "success";
  }
  return "running";
}

function useAppNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

function formatAppElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatBuildMiniElapsed(build: RecentBuildRecord, now: number): string {
  if (build.status !== "Running") {
    return build.duration;
  }

  const startedAt = new Date(build.startedAt).getTime();
  if (Number.isNaN(startedAt)) {
    return "--";
  }

  return formatAppElapsed(Math.max(0, Math.floor((now - startedAt) / 1000)));
}
