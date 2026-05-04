import { useState } from "react";
import {
  BarChart3,
  Boxes,
  ChevronDown,
  FolderKanban,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sun,
} from "lucide-react";
import { APP_VERSION } from "../../../../shared/appVersion";
import type { AppSection, Project, Theme } from "../../types";

export function Sidebar({
  projects,
  selectedProjectId,
  activeSection,
  theme,
  collapsed,
  onProjectChange,
  onSectionChange,
  onAddProject,
  onCollapseToggle,
  onThemeToggle,
}: {
  projects: Project[];
  selectedProjectId: string;
  activeSection: AppSection;
  theme: Theme;
  collapsed: boolean;
  onProjectChange: (project: Project) => void;
  onSectionChange: (section: AppSection) => void;
  onAddProject: () => void;
  onCollapseToggle: () => void;
  onThemeToggle: () => void;
}): JSX.Element {
  const [projectsOpen, setProjectsOpen] = useState(true);

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="brand">
        <div className="brand-mark">
          <Boxes size={27} strokeWidth={2.2} />
        </div>
        <span className="brand-label">IVS Dashboard</span>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <button
          className={`nav-item${activeSection === "dashboard" ? " active" : ""}`}
          type="button"
          onClick={() => onSectionChange("dashboard")}
          aria-label="Dashboard"
          title="Dashboard"
        >
          <BarChart3 size={18} />
          <span className="nav-label">Overview</span>
        </button>

        <button
          className={`nav-item project-toggle${projectsOpen ? " open" : ""}`}
          type="button"
          onClick={() => {
            if (!collapsed) {
              setProjectsOpen((current) => !current);
            }
          }}
          aria-expanded={collapsed ? false : projectsOpen}
          aria-label={`Projects (${projects.length})`}
          title={`Projects (${projects.length})`}
        >
          <FolderKanban size={18} />
          <span className="nav-label project-nav-label">
            <span>Projects</span>
            <span className="project-count-badge">{projects.length}</span>
          </span>
          {!collapsed ? <ChevronDown className="chevron" size={16} /> : null}
        </button>

        <div
          className={`project-list${projectsOpen && !collapsed ? " open" : ""}`}
          aria-hidden={!collapsed && !projectsOpen}
        >
          {projects.map((project) => (
            <button
              className={`project-item${
                activeSection === "project" && project.id === selectedProjectId
                  ? " active"
                  : ""
              }`}
              type="button"
              key={project.id}
              tabIndex={projectsOpen || collapsed ? 0 : -1}
              onClick={() => onProjectChange(project)}
            >
              <span className="project-code">{project.code}</span>
              <span>{project.name}</span>
            </button>
          ))}
          <button
            className="project-item add-project-item"
            type="button"
            tabIndex={projectsOpen || collapsed ? 0 : -1}
            onClick={onAddProject}
          >
            <Plus className="add-project-icon" size={16} />
            <span>Add Project</span>
          </button>

          {collapsed ? (
            <button
              className="nav-item add-project-collapsed-btn"
              type="button"
              onClick={onAddProject}
              aria-label="Add project"
              title="Add project"
            >
              <Plus size={18} style={{ color: "var(--accent)" }} />
            </button>
          ) : null}
        </div>
      </nav>

      <div className="sidebar-footer">
        {!collapsed ? (
          <span className="sidebar-version">v{APP_VERSION}</span>
        ) : null}
        <button
          className="theme-toggle sidebar-icon-button"
          type="button"
          onClick={onCollapseToggle}
          aria-label={collapsed ? "Expand side menu" : "Collapse side menu"}
          title={collapsed ? "Expand side menu" : "Collapse side menu"}
        >
          {collapsed ? (
            <PanelLeftOpen size={18} />
          ) : (
            <PanelLeftClose size={18} />
          )}
        </button>
        <button
          className="theme-toggle sidebar-icon-button"
          type="button"
          onClick={onThemeToggle}
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>
    </aside>
  );
}
