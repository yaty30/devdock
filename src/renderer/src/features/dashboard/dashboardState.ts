import { isProjectFrontendEnabled } from "../../../../shared/projectFrontend";
import type { BuildMiniPanelItem } from "../../components/common/BuildMiniPanel";
import type {
  DashboardEvent,
  Project,
  ProjectDashboardSummary,
  ProjectRuntimeState,
  ServiceStatusRecord,
} from "../../types";

export function getSidebarProjectStatuses(
  summaries: ProjectDashboardSummary[],
  activeProjectState: ProjectRuntimeState | null,
  activeProjectId: string | null,
): Record<string, ServiceStatusRecord[]> {
  const statusesByProjectId: Record<string, ServiceStatusRecord[]> = {};

  summaries.forEach((summary) => {
    statusesByProjectId[summary.project.id] = summary.statuses;
  });

  if (activeProjectId && activeProjectState) {
    statusesByProjectId[activeProjectId] = activeProjectState.statuses;
  }

  return statusesByProjectId;
}

export function getSidebarProjectFrontendEnabled(
  summaries: ProjectDashboardSummary[],
  activeProjectState: ProjectRuntimeState | null,
  activeProjectId: string | null,
): Record<string, boolean> {
  const enabledByProjectId: Record<string, boolean> = {};

  summaries.forEach((summary) => {
    enabledByProjectId[summary.project.id] = summary.frontendEnabled;
  });

  if (activeProjectId && activeProjectState) {
    enabledByProjectId[activeProjectId] = isProjectFrontendEnabled(
      activeProjectState.settings,
    );
  }

  return enabledByProjectId;
}

export function getBuildMiniPanelItems(
  summaries: ProjectDashboardSummary[],
  projects: Project[],
  dismissedRecordKeys: Set<string>,
  sessionStartedAt: number,
): BuildMiniPanelItem[] {
  const realItems = summaries
    .filter((summary) => summary.lastBuild)
    .map((summary) => ({
      project: summary.project,
      build: summary.lastBuild!,
    }));

  const debugItems = createDebugBuildMiniPanelItems(projects, summaries);
  const seen = new Set<string>();
  return [
    ...realItems,
    // ...debugItems
  ].filter((item) => {
    const key = `${item.project.id}:${item.build.id}`;
    const startedAt = new Date(item.build.startedAt).getTime();
    if (
      item.build.status !== "Running" &&
      (Number.isNaN(startedAt) || startedAt < sessionStartedAt)
    ) {
      return false;
    }
    if (item.build.status !== "Running" && dismissedRecordKeys.has(key)) {
      return false;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createDebugBuildMiniPanelItems(
  projects: Project[],
  summaries: ProjectDashboardSummary[],
): BuildMiniPanelItem[] {
  const now = Date.now();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const candidates = [
    ...projects,
    ...summaries.map((summary) => summary.project),
  ].filter((project, index, allProjects) => {
    return allProjects.findIndex((item) => item.id === project.id) === index;
  });
  const debugProjects = candidates.slice(0, 2);

  return debugProjects.map((project, index) => {
    const normalizedProject = projectById.get(project.id) ?? project;
    const startedAt = new Date(now - (index + 2) * 73_000).toISOString();
    return {
      project: normalizedProject,
      debug: true,
      build: {
        id: `debug-running-build-${index + 1}`,
        branch: index === 0 ? "feature/api-tools" : "release/war-debug",
        commit: index === 0 ? "debug-a1b2c3" : "debug-d4e5f6",
        commitCleanliness: "clean",
        profile: index === 0 ? "local-war" : "sit-war",
        status: "Running",
        duration: "--:--",
        completed: "Running",
        startedAt,
        outcomeType: index === 0 ? "build-only" : "build-and-deploy",
      },
    };
  });
}

export function applyDashboardEvent(
  current: ProjectRuntimeState | null,
  event: DashboardEvent,
): ProjectRuntimeState | null {
  if (!current) {
    return current;
  }

  if (event.type === "settings") {
    return { ...current, settings: event.settings };
  }

  if (event.type === "status") {
    return {
      ...current,
      statuses: [
        ...current.statuses.filter(
          (status) => status.service !== event.status.service,
        ),
        event.status,
      ],
    };
  }

  if (
    event.type === "log" ||
    event.type === "log-batch" ||
    event.type === "log-clear"
  ) {
    // Handled by the log store; never touch React state.
    return current;
  }
  if (event.type === "builds") {
    return { ...current, recentBuilds: event.builds };
  }

  if (event.type === "activity") {
    return { ...current, activityFeed: event.activityFeed };
  }

  return current;
}

export function applyDashboardOverviewStatusEvent(
  current: ProjectDashboardSummary[],
  event: Extract<DashboardEvent, { type: "status" }>,
): ProjectDashboardSummary[] {
  let changed = false;
  const next = current.map((summary) => {
    if (summary.project.id !== event.projectId) {
      return summary;
    }

    changed = true;
    return {
      ...summary,
      statuses: [
        ...summary.statuses.filter(
          (status) => status.service !== event.status.service,
        ),
        event.status,
      ],
    };
  });

  return changed ? next : current;
}

export function createLoadingProjectState(): ProjectRuntimeState {
  return {
    settings: {
      backendType: "wildfly",
      appLogFile: "",
      gitProjectDirectory: "",
      defaultBranch: "",
      remote: "",
      frontend: {
        enabled: false,
        path: "",
        installCommand: "",
        devCommand: "",
        buildCommand: "",
      },
      python: {
        enabled: true,
        serverType: "custom",
        directory: "",
        venvPath: "",
        installCommand: "pip install -r requirements.txt",
        startCommand: "",
        appUrl: "http://127.0.0.1:8000",
        healthCheckUrl: "",
        autoStart: false,
        buildCommand: "",
      },
      services: {
        frontend: {
          enabled: false,
          workingDirectory: "",
          command: "",
          healthUrl: "",
          appUrl: "",
          autoStart: false,
        },
        wildfly: {
          enabled: true,
          workingDirectory: "",
          command: "",
          healthUrl: "",
          appUrl: "",
          managementUrl: "",
          autoStart: false,
        },
        python: {
          enabled: true,
          workingDirectory: "",
          command: "",
          healthUrl: "",
          appUrl: "",
          autoStart: false,
        },
      },
      maven: {
        executable: "",
        settingsXml: "",
        pomXml: "",
        skipTests: false,
      },
      buildProfiles: [],
    },
    statuses: [],
    recentBuilds: [],
    activityFeed: [],
    pythonDependencies: [],
    gitStatus: {
      repository: "",
      branch: "",
      commit: "",
      status: "",
      lines: [],
    },
    logs: {
      frontend: [],
      wildfly: [],
      python: [],
      build: [],
      tail: [],
    },
  };
}
