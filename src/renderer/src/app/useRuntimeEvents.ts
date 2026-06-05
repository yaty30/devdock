import { useEffect, useRef, useState } from "react";
import { appendLiveBatch, clearViewport } from "../hooks/useLogStore";
import type { useDashboardController } from "../features/dashboard/useDashboardController";
import type { useProjectController } from "../features/projects/useProjectController";
import type { LogChannel, ShutdownEntry } from "../types";

const PROJECT_DASHBOARD_EXIT_LOG_CHANNELS: LogChannel[] = [
  "frontend",
  "build",
  "wildfly",
  "python",
];

type DashboardController = ReturnType<typeof useDashboardController>;
type ProjectController = ReturnType<typeof useProjectController>;

export function useRuntimeEvents({
  dashboard,
  project,
}: {
  dashboard: DashboardController;
  project: ProjectController;
}): {
  shutdownEntries: ShutdownEntry[] | null;
  stoppedServices: Set<string>;
} {
  const [shutdownEntries, setShutdownEntries] = useState<
    ShutdownEntry[] | null
  >(null);
  const [stoppedServices, setStoppedServices] = useState<Set<string>>(
    new Set(),
  );
  const appExitStartedRef = useRef(false);

  useEffect(() => {
    function clearProjectDashboardForAppExit(): void {
      appExitStartedRef.current = true;
      const projectId = project.selectedProjectIdRef.current;
      if (projectId) {
        PROJECT_DASHBOARD_EXIT_LOG_CHANNELS.forEach((channel) => {
          clearViewport(projectId, channel);
        });
      }
      project.clearProjectDashboardForAppExit();
    }

    const unsubscribe = window.ivsDashboard.onEvent((event) => {
      if (event.type === "status") {
        dashboard.applyOverviewStatusEvent(event);
      }

      if (event.type === "builds" || event.type === "settings") {
        void dashboard.refreshDashboardOverview();
      }

      if (event.projectId !== project.selectedProjectIdRef.current) {
        return;
      }

      if (event.type === "log-batch") {
        if (appExitStartedRef.current) {
          return;
        }
        appendLiveBatch(event.projectId, event.channel, event.lines);
        return;
      }
      if (event.type === "log-clear") {
        clearViewport(event.projectId, event.channel);
        return;
      }
      project.applyProjectRuntimeEvent(event);
    });

    const unsubShutdownStarted = window.ivsDashboard.onShutdownStarted(
      (entries) => {
        setShutdownEntries(entries);
        setStoppedServices(new Set());
      },
    );

    const unsubShutdownStopped = window.ivsDashboard.onShutdownServiceStopped(
      (projectId, service) => {
        setStoppedServices((prev) => {
          const next = new Set(prev);
          next.add(`${projectId}:${service}`);
          return next;
        });
      },
    );

    const unsubAppExit = window.ivsDashboard.onAppExit(
      clearProjectDashboardForAppExit,
    );

    return () => {
      unsubscribe();
      unsubShutdownStarted();
      unsubShutdownStopped();
      unsubAppExit();
    };
  }, []);

  return { shutdownEntries, stoppedServices };
}
