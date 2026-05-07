import { useState } from "react";
import {
  BarChart3,
  Boxes,
  ChevronDown,
  Database,
  FolderKanban,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sun,
} from "lucide-react";
import { APP_VERSION } from "../../../../shared/appVersion";
import type {
  AppSection,
  DatabaseConnection,
  Project,
  Theme,
} from "../../types";

export function Sidebar({
  projects,
  databaseConnections,
  selectedProjectId,
  selectedDatabaseConnectionId,
  activeSection,
  theme,
  collapsed,
  onProjectChange,
  onDatabaseConnectionChange,
  onSectionChange,
  onAddProject,
  onAddDatabaseConnection,
  onCollapseToggle,
  onThemeToggle,
}: {
  projects: Project[];
  databaseConnections: DatabaseConnection[];
  selectedProjectId: string;
  selectedDatabaseConnectionId: string | null;
  activeSection: AppSection;
  theme: Theme;
  collapsed: boolean;
  onProjectChange: (project: Project) => void;
  onDatabaseConnectionChange: (connection: DatabaseConnection) => void;
  onSectionChange: (section: AppSection) => void;
  onAddProject: () => void;
  onAddDatabaseConnection: () => void;
  onCollapseToggle: () => void;
  onThemeToggle: () => void;
}): JSX.Element {
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [databasesOpen, setDatabasesOpen] = useState(true);

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

        <button
          className={`nav-item project-toggle${databasesOpen ? " open" : ""}`}
          type="button"
          onClick={() => {
            if (!collapsed) {
              setDatabasesOpen((current) => !current);
            }
          }}
          aria-expanded={collapsed ? false : databasesOpen}
          aria-label={`Databases (${databaseConnections.length})`}
          title={`Databases (${databaseConnections.length})`}
        >
          <Database size={18} />
          <span className="nav-label project-nav-label">
            <span>Databases</span>
            <span className="project-count-badge">
              {databaseConnections.length}
            </span>
          </span>
          {!collapsed ? <ChevronDown className="chevron" size={16} /> : null}
        </button>

        <div
          className={`project-list database-list${
            databasesOpen && !collapsed ? " open" : ""
          }`}
          aria-hidden={!collapsed && !databasesOpen}
        >
          {databaseConnections.map((connection) => {
            const displayName = getConnectionDisplayName(connection);
            return (
              <div
                className={`project-item database-item${
                  activeSection === "database" &&
                  connection.id === selectedDatabaseConnectionId
                    ? " active"
                    : ""
                }`}
                key={connection.id}
                title={formatDatabaseConnectionTooltip(connection)}
                aria-label={formatDatabaseConnectionTooltip(connection)}
              >
                <button
                  className="database-item-main"
                  type="button"
                  tabIndex={databasesOpen || collapsed ? 0 : -1}
                  onClick={() => onDatabaseConnectionChange(connection)}
                >
                  <span
                    className={`database-status-dot ${connection.status}`}
                  />
                  <span className="database-connection-initials">
                    {getConnectionInitials(connection)}
                  </span>
                  <span className="database-connection-name">
                    {displayName}
                  </span>
                  <span className="database-type-label">{connection.type}</span>
                </button>
              </div>
            );
          })}
          <button
            className="project-item add-project-item"
            type="button"
            tabIndex={databasesOpen || collapsed ? 0 : -1}
            onClick={onAddDatabaseConnection}
          >
            <Plus className="add-project-icon" size={16} />
            <span>New connection</span>
          </button>

          {collapsed ? (
            <button
              className="nav-item add-project-collapsed-btn"
              type="button"
              onClick={onAddDatabaseConnection}
              aria-label="New database connection"
              title="New database connection"
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

function getConnectionInitials(connection: DatabaseConnection): string {
  const nameInitials = connection.name
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();

  if (nameInitials) {
    return nameInitials;
  }

  return (
    connection.id
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 2)
      .toUpperCase() || "DB"
  );
}

function getConnectionDisplayName(connection: DatabaseConnection): string {
  return connection.name.trim() || connection.id.trim() || "Database";
}

function formatDatabaseConnectionTooltip(
  connection: DatabaseConnection,
): string {
  const hostPort = [connection.host, connection.port].filter(Boolean).join(":");
  return [
    getConnectionDisplayName(connection),
    connection.type,
    connection.status,
    hostPort,
  ]
    .filter(Boolean)
    .join("\n");
}
