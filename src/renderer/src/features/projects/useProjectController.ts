import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_PROJECTS } from "../../../../shared/appLimits";
import { applyDashboardEvent } from "../dashboard/dashboardState";
import type {
  BackendType,
  DashboardEvent,
  DashboardTab,
  Project,
  ProjectRecord,
  ProjectRuntimeState,
  ProjectSettingsRecord,
  PythonServerType,
  AppSection,
} from "../../types";
import type { SnackbarTone } from "../../types/snackbar";

const PROJECT_STATE_LOAD_TIMEOUT_MS = 8000;

export function useProjectController({
  activeSection,
  requestSettingsNavigation,
  refreshDashboardOverview,
  setActiveSection,
  setActiveTab,
  showSnackbar,
}: {
  activeSection: AppSection;
  requestSettingsNavigation: (action: () => void) => void;
  refreshDashboardOverview: () => Promise<void>;
  setActiveSection: (section: AppSection) => void;
  setActiveTab: (tab: DashboardTab) => void;
  showSnackbar: (message: string, tone: SnackbarTone) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectState, setProjectState] = useState<ProjectRuntimeState | null>(
    null,
  );
  const [projectStateProjectId, setProjectStateProjectId] = useState<
    string | null
  >(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const projectLoadingTimerRef = useRef<number | null>(null);
  const projectSwitchStartedAtRef = useRef<number | null>(null);
  const selectedProjectIdRef = useRef<string | null>(null);

  const activeProjectState =
    projectStateProjectId === selectedProject?.id ? projectState : null;

  useEffect(() => {
    if (!selectedProject) {
      return undefined;
    }

    selectedProjectIdRef.current = selectedProject.id;
    if (activeSection !== "project") {
      setProjectLoading(false);
      return undefined;
    }

    let cancelled = false;
    const loadingTimeout = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      console.error(
        `[renderer:project] Project state load timed out for ${selectedProject.id}`,
      );
      setProjectLoading(false);
      projectSwitchStartedAtRef.current = null;
    }, PROJECT_STATE_LOAD_TIMEOUT_MS);

    setProjectLoading(true);
    window.ivsDashboard
      .getProjectState(selectedProject.id)
      .then((nextState) => {
        if (!cancelled) {
          window.clearTimeout(loadingTimeout);
          setProjectState(nextState);
          setProjectStateProjectId(selectedProject.id);
          const switchStartedAt = projectSwitchStartedAtRef.current;
          const remainingDelay =
            switchStartedAt === null
              ? 0
              : Math.max(0, 1000 - (Date.now() - switchStartedAt));

          if (projectLoadingTimerRef.current !== null) {
            window.clearTimeout(projectLoadingTimerRef.current);
          }

          projectLoadingTimerRef.current = window.setTimeout(() => {
            setProjectLoading(false);
            projectLoadingTimerRef.current = null;
            projectSwitchStartedAtRef.current = null;
          }, remainingDelay);
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          window.clearTimeout(loadingTimeout);
          setProjectLoading(false);
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(loadingTimeout);
    };
  }, [selectedProject, activeSection]);

  useEffect(() => {
    return () => {
      if (projectLoadingTimerRef.current !== null) {
        window.clearTimeout(projectLoadingTimerRef.current);
      }
    };
  }, []);

  const hydrateProjects = useCallback(
    (nextProjects: Project[], activeProjectId: string | null): void => {
      setProjects(nextProjects);
      const active =
        nextProjects.find((project) => project.id === activeProjectId) ??
        nextProjects[0] ??
        null;
      selectedProjectIdRef.current = active?.id ?? null;
      setSelectedProject(active);
      if (active === null) {
        setProjectLoading(false);
      }
    },
    [],
  );

  const forceStopLoading = useCallback((): void => {
    setProjectLoading(false);
  }, []);

  const switchProject = useCallback(
    (project: Project): void => {
      if (project.id === selectedProject?.id) {
        requestSettingsNavigation(() => setActiveSection("project"));
        return;
      }

      const doSwitch = (): void => {
        if (projectLoadingTimerRef.current !== null) {
          window.clearTimeout(projectLoadingTimerRef.current);
        }
        selectedProjectIdRef.current = project.id;
        setSelectedProject(project);
        setProjectLoading(true);
        setProjectStateProjectId(null);
        projectSwitchStartedAtRef.current = Date.now();
        setActiveSection("project");
      };

      requestSettingsNavigation(doSwitch);
    },
    [requestSettingsNavigation, selectedProject?.id, setActiveSection],
  );

  const openProjectDashboard = useCallback(
    (project: ProjectRecord): void => {
      const targetProject: Project = {
        id: project.id,
        name: project.name,
        code: project.code,
        backendType: project.backendType,
      };

      const doOpen = (): void => {
        setActiveTab("dashboard");
        if (targetProject.id === selectedProject?.id) {
          setActiveSection("project");
          return;
        }

        if (projectLoadingTimerRef.current !== null) {
          window.clearTimeout(projectLoadingTimerRef.current);
        }
        selectedProjectIdRef.current = targetProject.id;
        setSelectedProject(targetProject);
        setProjectLoading(true);
        setProjectStateProjectId(null);
        projectSwitchStartedAtRef.current = Date.now();
        setActiveSection("project");
      };

      requestSettingsNavigation(doOpen);
    },
    [
      requestSettingsNavigation,
      selectedProject?.id,
      setActiveSection,
      setActiveTab,
    ],
  );

  const createProject = useCallback(
    async (
      name: string,
      code: string,
      backendType: BackendType,
      pythonServerType?: PythonServerType,
    ): Promise<boolean> => {
      const trimmedName = name.trim();
      const trimmedCode = code.trim().toUpperCase();
      const errors: string[] = [];

      if (!trimmedName) {
        errors.push("Project name is required");
      } else if (trimmedName.length > 16) {
        errors.push("Project name must be 16 characters or fewer");
      }

      if (!trimmedCode) {
        errors.push("Project tag is required");
      } else if (trimmedCode.length > 3) {
        errors.push("Project tag must be 3 characters or fewer");
      }

      if (errors.length > 0) {
        showSnackbar(errors.join(". "), "invalid");
        return false;
      }

      if (projects.length >= MAX_PROJECTS) {
        showSnackbar(
          `Project limit reached. You can create up to ${MAX_PROJECTS} projects.`,
          "invalid",
        );
        return false;
      }

      try {
        const created = await window.ivsDashboard.createProject(
          trimmedName,
          trimmedCode,
          backendType,
          pythonServerType,
        );
        if (projectLoadingTimerRef.current !== null) {
          window.clearTimeout(projectLoadingTimerRef.current);
        }
        selectedProjectIdRef.current = created.id;
        setProjects((current) => [...current, created]);
        setSelectedProject(created);
        setProjectStateProjectId(null);
        setProjectLoading(true);
        projectSwitchStartedAtRef.current = Date.now();
        setActiveSection("project");
        setActiveTab("dashboard");
        void refreshDashboardOverview();
        showSnackbar(`${created.name} created.`, "valid");
        return true;
      } catch (error) {
        console.error(error);
        showSnackbar(
          error instanceof Error
            ? error.message
            : "Project could not be created",
          "invalid",
        );
        return false;
      }
    },
    [
      projects.length,
      refreshDashboardOverview,
      setActiveSection,
      setActiveTab,
      showSnackbar,
    ],
  );

  const updateSettings = useCallback(
    (settings: ProjectSettingsRecord): void => {
      setProjectState((current) =>
        current ? { ...current, settings } : current,
      );
      void refreshDashboardOverview();
    },
    [refreshDashboardOverview],
  );

  const removeSelectedProject = useCallback((): void => {
    if (!selectedProject) {
      return;
    }

    const remaining = projects.filter(
      (project) => project.id !== selectedProject.id,
    );
    setProjects(remaining);
    setSelectedProject(remaining[0] ?? null);
    selectedProjectIdRef.current = remaining[0]?.id ?? null;
    setActiveSection("dashboard");
  }, [projects, selectedProject, setActiveSection]);

  const updateProject = useCallback(
    (updated: Project): void => {
      setProjects((current) =>
        current.map((project) =>
          project.id === updated.id ? updated : project,
        ),
      );
      setSelectedProject(updated);
      selectedProjectIdRef.current = updated.id;
      void refreshDashboardOverview();
    },
    [refreshDashboardOverview],
  );

  const clearProjectDashboardForAppExit = useCallback((): void => {
    setProjectState((current) =>
      current ? { ...current, recentBuilds: [] } : current,
    );
  }, []);

  const applyProjectRuntimeEvent = useCallback(
    (event: DashboardEvent): void => {
      setProjectState((current) => applyDashboardEvent(current, event));
    },
    [],
  );

  return {
    activeProjectState,
    applyProjectRuntimeEvent,
    clearProjectDashboardForAppExit,
    createProject,
    forceStopLoading,
    hydrateProjects,
    openProjectDashboard,
    projectLoading,
    projects,
    removeSelectedProject,
    selectedProject,
    selectedProjectIdRef,
    setProjectLoading,
    switchProject,
    updateProject,
    updateSettings,
  };
}
