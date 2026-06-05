import { useEffect, useState } from "react";
import type { useDashboardController } from "../features/dashboard/useDashboardController";
import type { useDatabaseController } from "../features/databases";
import type { useProjectController } from "../features/projects/useProjectController";

const INITIAL_STATE_LOAD_TIMEOUT_MS = 10000;

type DashboardController = ReturnType<typeof useDashboardController>;
type DatabaseController = ReturnType<typeof useDatabaseController>;
type ProjectController = ReturnType<typeof useProjectController>;

export function useAppBootstrap({
  dashboard,
  database,
  project,
}: {
  dashboard: DashboardController;
  database: DatabaseController;
  project: ProjectController;
}): boolean {
  const [initialStateLoaded, setInitialStateLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const initialLoadTimeout = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      console.error("[renderer:startup] Initial state load timed out");
      setInitialStateLoaded(true);
      project.forceStopLoading();
      dashboard.stopDashboardOverviewLoading();
    }, INITIAL_STATE_LOAD_TIMEOUT_MS);

    async function loadInitialState(): Promise<void> {
      const snapshot = await window.ivsDashboard.getSnapshot();
      const connections = await window.ivsDashboard.getDatabaseConnections();
      const executionHistory =
        await window.ivsDashboard.getDatabaseExecutionHistory();
      if (cancelled) {
        return;
      }
      window.clearTimeout(initialLoadTimeout);
      project.hydrateProjects(snapshot.projects, snapshot.activeProjectId);
      database.hydrateConnections(connections, executionHistory);
      void dashboard.refreshDashboardOverview();
      setInitialStateLoaded(true);
    }

    void loadInitialState().catch((error) => {
      console.error(error);
      window.clearTimeout(initialLoadTimeout);
      setInitialStateLoaded(true);
      project.forceStopLoading();
      dashboard.stopDashboardOverviewLoading();
    });

    return () => {
      cancelled = true;
      window.clearTimeout(initialLoadTimeout);
    };
  }, []);

  return initialStateLoaded;
}
