import { useState } from "react";
import {
  BarChart3,
  Boxes,
  ChevronDown,
  FolderKanban,
  Moon,
  Plus,
  Settings,
  Sun,
} from "lucide-react";
import { projects } from "../../data/mockData";
import type { AppSection, Project, Theme } from "../../types";

export function Sidebar({
  selectedProjectId,
  activeSection,
  theme,
  onProjectChange,
  onSectionChange,
  onAddProject,
  onThemeToggle,
}: {
  selectedProjectId: string;
  activeSection: AppSection;
  theme: Theme;
  onProjectChange: (project: Project) => void;
  onSectionChange: (section: AppSection) => void;
  onAddProject: () => void;
  onThemeToggle: () => void;
}): JSX.Element {
  const [projectsOpen, setProjectsOpen] = useState(true);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Boxes size={27} strokeWidth={2.2} />
        </div>
        <span>IVS Dashboard</span>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <button
          className={`nav-item project-toggle${projectsOpen ? " open" : ""}`}
          type="button"
          onClick={() => setProjectsOpen((current) => !current)}
          aria-expanded={projectsOpen}
        >
          <FolderKanban size={18} />
          <span>Projects</span>
          <ChevronDown className="chevron" size={16} />
        </button>

        <div
          className={`project-list${projectsOpen ? " open" : ""}`}
          aria-hidden={!projectsOpen}
        >
          {projects.map((project) => (
            <button
              className={`project-item${project.id === selectedProjectId ? " active" : ""}`}
              type="button"
              key={project.id}
              tabIndex={projectsOpen ? 0 : -1}
              onClick={() => {
                onProjectChange(project);
                onSectionChange("dashboard");
              }}
            >
              <span className="project-code">{project.code}</span>
              <span>{project.name}</span>
            </button>
          ))}
          <button
            className="project-item add-project-item"
            type="button"
            tabIndex={projectsOpen ? 0 : -1}
            onClick={onAddProject}
          >
            <Plus className="add-project-icon" size={16} />
            <span>Add Project</span>
          </button>
        </div>

        <button
          className={`nav-item${activeSection === "dashboard" ? " active" : ""}`}
          type="button"
          onClick={() => onSectionChange("dashboard")}
        >
          <BarChart3 size={18} />
          <span>Dashboards</span>
        </button>
        <button
          className={`nav-item${activeSection === "settings" ? " active" : ""}`}
          type="button"
          onClick={() => onSectionChange("settings")}
        >
          <Settings size={18} />
          <span>Settings</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <span className="sidebar-version">v0.5.0</span>
        <button
          className="theme-toggle"
          type="button"
          onClick={onThemeToggle}
          aria-label="Toggle theme"
        >
          {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>
    </aside>
  );
}
