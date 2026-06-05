import { useCallback, useMemo, useRef, useState } from "react";
import type {
  DashboardEvent,
  Project,
  ProjectDashboardSummary,
  ProjectRuntimeState,
} from "../../types";
import {
  applyDashboardOverviewStatusEvent,
  getBuildMiniPanelItems,
  getSidebarProjectFrontendEnabled,
  getSidebarProjectStatuses,
} from "./dashboardState";
import {
  getBuildMiniRecordKey,
  type BuildMiniPanelItem,
} from "../../components/common/BuildMiniPanel";

export function useDashboardController({
  activeProjectState,
  activeSection,
  projects,
  selectedProjectId,
}: {
  activeProjectState: ProjectRuntimeState | null;
  activeSection: string;
  projects: Project[];
  selectedProjectId: string | null;
}) {
  const [dashboardOverview, setDashboardOverview] = useState<
    ProjectDashboardSummary[]
  >([]);
  const [dashboardOverviewLoading, setDashboardOverviewLoading] =
    useState(true);
  const [buildMiniPanelMinimized, setBuildMiniPanelMinimized] = useState(false);
  const [dismissedBuildMiniRecordKeys, setDismissedBuildMiniRecordKeys] =
    useState<Set<string>>(() => new Set());
  const dashboardOverviewRequestRef = useRef(0);
  const buildMiniPanelBuildIdRef = useRef<string | null>(null);
  const buildMiniPanelSessionStartedAtRef = useRef(Date.now());

  const sidebarProjectStatuses = getSidebarProjectStatuses(
    dashboardOverview,
    activeProjectState,
    selectedProjectId,
  );
  const sidebarProjectFrontendEnabled = getSidebarProjectFrontendEnabled(
    dashboardOverview,
    activeProjectState,
    selectedProjectId,
  );
  const runningBuildItems = useMemo(
    () =>
      getBuildMiniPanelItems(
        dashboardOverview,
        projects,
        dismissedBuildMiniRecordKeys,
        buildMiniPanelSessionStartedAtRef.current,
      ),
    [dashboardOverview, dismissedBuildMiniRecordKeys, projects],
  );
  const runningBuildKey = useMemo(
    () =>
      runningBuildItems
        .map((item) => `${item.project.id}:${item.build.id}`)
        .join("|"),
    [runningBuildItems],
  );
  const completedBuildMiniRecordKeys = useMemo(
    () =>
      runningBuildItems
        .filter((item) => item.build.status !== "Running")
        .map(getBuildMiniRecordKey),
    [runningBuildItems],
  );

  const refreshDashboardOverview = useCallback((): Promise<void> => {
    const requestId = dashboardOverviewRequestRef.current + 1;
    dashboardOverviewRequestRef.current = requestId;
    setDashboardOverviewLoading(true);

    return window.ivsDashboard
      .getDashboardOverview()
      .then((overview) => setDashboardOverview(overview))
      .catch((error) => console.error(error))
      .finally(() => {
        if (dashboardOverviewRequestRef.current === requestId) {
          setDashboardOverviewLoading(false);
        }
      });
  }, []);

  const stopDashboardOverviewLoading = useCallback((): void => {
    setDashboardOverviewLoading(false);
  }, []);

  const applyOverviewStatusEvent = useCallback(
    (event: Extract<DashboardEvent, { type: "status" }>): void => {
      setDashboardOverview((current) =>
        applyDashboardOverviewStatusEvent(current, event),
      );
    },
    [],
  );

  const syncBuildMiniPanelForRoute = useCallback((): void => {
    if (buildMiniPanelBuildIdRef.current === runningBuildKey) {
      return;
    }

    buildMiniPanelBuildIdRef.current = runningBuildKey;
    if (runningBuildKey && activeSection !== "project") {
      setBuildMiniPanelMinimized(false);
    }
  }, [activeSection, runningBuildKey]);

  const dismissCompletedBuildMiniRecordsForProjectRoute =
    useCallback((): void => {
      if (
        activeSection !== "project" ||
        completedBuildMiniRecordKeys.length === 0
      ) {
        return;
      }

      setDismissedBuildMiniRecordKeys((current) => {
        let changed = false;
        const next = new Set(current);
        completedBuildMiniRecordKeys.forEach((key) => {
          if (!next.has(key)) {
            next.add(key);
            changed = true;
          }
        });
        return changed ? next : current;
      });
    }, [activeSection, completedBuildMiniRecordKeys]);

  const dismissBuildMiniRecord = useCallback(
    (item: BuildMiniPanelItem): void => {
      if (item.build.status === "Running") {
        return;
      }

      setDismissedBuildMiniRecordKeys((current) => {
        const next = new Set(current);
        next.add(getBuildMiniRecordKey(item));
        return next;
      });
    },
    [],
  );

  const clearCompletedBuildMiniRecords = useCallback((): void => {
    setDismissedBuildMiniRecordKeys((current) => {
      const next = new Set(current);
      runningBuildItems.forEach((item) => {
        next.add(getBuildMiniRecordKey(item));
      });
      return next;
    });
  }, [runningBuildItems]);

  return {
    applyOverviewStatusEvent,
    buildMiniPanelMinimized,
    clearCompletedBuildMiniRecords,
    dashboardOverview,
    dashboardOverviewLoading,
    dismissBuildMiniRecord,
    dismissCompletedBuildMiniRecordsForProjectRoute,
    refreshDashboardOverview,
    runningBuildItems,
    setBuildMiniPanelMinimized,
    sidebarProjectFrontendEnabled,
    sidebarProjectStatuses,
    stopDashboardOverviewLoading,
    syncBuildMiniPanelForRoute,
  };
}
