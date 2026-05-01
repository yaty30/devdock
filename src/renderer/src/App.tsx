import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { AddProjectDialog } from "./components/dialogs/AddProjectDialog";
import { HeaderActions } from "./components/layout/HeaderActions";
import { Sidebar } from "./components/layout/Sidebar";
import { SegmentedTabs } from "./components/navigation/SegmentedTabs";
import { projects } from "./data/mockData";
import { DashboardContent } from "./features/dashboard/DashboardContent";
import { GitTerminalTab } from "./features/git/GitTerminalTab";
import { MonitorTab } from "./features/monitor/MonitorTab";
import { SettingsContent } from "./features/settings/SettingsContent";
import type { AppSection, DashboardTab, Project, Theme } from "./types";

function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<DashboardTab>("dashboard");
  const [activeSection, setActiveSection] = useState<AppSection>("dashboard");
  const [selectedProject, setSelectedProject] = useState<Project>(projects[0]);
  const [theme, setTheme] = useState<Theme>("light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [panelResetVersion, setPanelResetVersion] = useState(0);
  const [projectLoading, setProjectLoading] = useState(false);
  const projectLoadingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (projectLoadingTimerRef.current !== null) {
        window.clearTimeout(projectLoadingTimerRef.current);
      }
    };
  }, []);

  function switchProject(project: Project): void {
    if (project.id === selectedProject.id) {
      return;
    }

    if (projectLoadingTimerRef.current !== null) {
      window.clearTimeout(projectLoadingTimerRef.current);
    }

    setSelectedProject(project);
    setProjectLoading(true);
    projectLoadingTimerRef.current = window.setTimeout(() => {
      setProjectLoading(false);
      projectLoadingTimerRef.current = null;
    }, 1000);
  }

  return (
    <div
      className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      data-theme={theme}
    >
      <Sidebar
        selectedProjectId={selectedProject.id}
        activeSection={activeSection}
        theme={theme}
        collapsed={sidebarCollapsed}
        onProjectChange={switchProject}
        onSectionChange={setActiveSection}
        onAddProject={() => setAddProjectOpen(true)}
        onCollapseToggle={() => setSidebarCollapsed((current) => !current)}
        onThemeToggle={() =>
          setTheme((current) => (current === "light" ? "dark" : "light"))
        }
      />
      <main className={`main-content${projectLoading ? " project-loading" : ""}`}>
        <header className="main-header">
          <div>
            <h1>
              {activeSection === "dashboard"
                ? selectedProject.name
                : "Settings"}
            </h1>
            <p>
              {activeSection === "dashboard"
                ? "Monitor services, run builds, and review deployment status."
                : "Configure project paths, services, Git, and build profiles."}
            </p>
          </div>
          {activeSection === "dashboard" ? (
            <HeaderActions disabled={projectLoading} />
          ) : null}
        </header>

        {activeSection === "dashboard" ? (
          <>
            <div className="tab-toolbar">
              <SegmentedTabs activeTab={activeTab} onTabChange={setActiveTab} />
              {activeTab === "dashboard" || activeTab === "monitor" ? (
                <button
                  className="reset-panels-button"
                  type="button"
                  onClick={() => setPanelResetVersion((version) => version + 1)}
                >
                  <RotateCcw size={14} />
                  Reset panels
                </button>
              ) : null}
            </div>
            {activeTab === "dashboard" ? (
              <DashboardContent resetVersion={panelResetVersion} />
            ) : null}
            {activeTab === "monitor" ? (
              <MonitorTab resetVersion={panelResetVersion} />
            ) : null}
            {activeTab === "git-terminal" ? <GitTerminalTab /> : null}
          </>
        ) : (
          <SettingsContent selectedProject={selectedProject} />
        )}
      </main>

      {addProjectOpen ? (
        <AddProjectDialog onClose={() => setAddProjectOpen(false)} />
      ) : null}
    </div>
  );
}

export default App;
