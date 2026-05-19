import { useEffect, useState } from "react";
import {
  BarChart3,
  Binary,
  Boxes,
  ChevronDown,
  Database,
  FlaskConical,
  FolderKanban,
  GitCompare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Plus,
  Sun,
  Unplug,
  Wrench,
} from "lucide-react";
import { APP_VERSION } from "../../../../shared/appVersion";
import { Tooltip } from "../common/Tooltip";
import type {
  AppSection,
  DatabaseConnection,
  Project,
  ServiceStatusRecord,
  Theme,
  ToolId,
} from "../../types";

export function Sidebar({
  projects,
  databaseConnections,
  selectedProjectId,
  selectedDatabaseConnectionId,
  activeSection,
  activeTool,
  theme,
  collapsed,
  projectStatuses = {},
  onProjectChange,
  onDatabaseConnectionChange,
  onDatabaseConnect,
  onDatabaseDisconnect,
  onSectionChange,
  onToolChange,
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
  activeTool: ToolId;
  theme: Theme;
  collapsed: boolean;
  projectStatuses?: Record<string, ServiceStatusRecord[]>;
  onProjectChange: (project: Project) => void;
  onDatabaseConnectionChange: (connection: DatabaseConnection) => void;
  onDatabaseConnect: (connection: DatabaseConnection) => void;
  onDatabaseDisconnect: (connection: DatabaseConnection) => void;
  onSectionChange: (section: AppSection) => void;
  onToolChange: (tool: ToolId) => void;
  onAddProject: () => void;
  onAddDatabaseConnection: () => void;
  onCollapseToggle: () => void;
  onThemeToggle: () => void;
}): JSX.Element {
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [databasesOpen, setDatabasesOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [databaseContextMenu, setDatabaseContextMenu] = useState<{
    connection: DatabaseConnection;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!databaseContextMenu) {
      return undefined;
    }

    function closeContextMenu(): void {
      setDatabaseContextMenu(null);
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setDatabaseContextMenu(null);
      }
    }

    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [databaseContextMenu]);

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
            <Tooltip
              key={project.id}
              className="project-tooltip-anchor"
              placement="right"
              content={
                <ServiceStatusTooltip statuses={projectStatuses[project.id]} />
              }
            >
              <button
                className={`project-item${
                  activeSection === "project" &&
                  project.id === selectedProjectId
                    ? " active"
                    : ""
                }`}
                type="button"
                tabIndex={projectsOpen || collapsed ? 0 : -1}
                onClick={() => onProjectChange(project)}
              >
                <div className="project-info">
                  <span className="project-code">{project.code}</span>
                  <span className="project-name">{project.name}</span>

                  <div className="project-service-dots">
                    <div className="project-service-dots dots">
                      <span
                        className={`project-service-dot ${getServiceState(projectStatuses[project.id], "frontend")}`}
                      />
                      <span
                        className={`project-service-dot ${getServiceState(projectStatuses[project.id], "wildfly")}`}
                      />
                    </div>
                  </div>
                </div>
              </button>
            </Tooltip>
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
                onContextMenu={(event) => {
                  event.preventDefault();
                  setDatabaseContextMenu({
                    connection,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
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

        <button
          className={`nav-item project-toggle${toolsOpen ? " open" : ""}`}
          type="button"
          onClick={() => {
            if (!collapsed) {
              setToolsOpen((current) => !current);
            }
          }}
          aria-expanded={collapsed ? false : toolsOpen}
          aria-label="Tools (3)"
          title="Tools (3)"
        >
          <Wrench size={18} />
          <span className="nav-label project-nav-label">
            <span>Tools</span>
            <span className="project-count-badge">3</span>
          </span>
          {!collapsed ? <ChevronDown className="chevron" size={16} /> : null}
        </button>

        <div
          className={`project-list tools-list${
            toolsOpen && !collapsed ? " open" : ""
          }`}
          aria-hidden={!collapsed && !toolsOpen}
        >
          <button
            className={`project-item tool-item${
              activeSection === "tools" && activeTool === "comparing"
                ? " active"
                : ""
            }`}
            type="button"
            tabIndex={toolsOpen || collapsed ? 0 : -1}
            onClick={() => onToolChange("comparing")}
            title="Comparing"
          >
            <GitCompare size={16} />
            <span>Comparing</span>
          </button>
          <button
            className={`project-item tool-item${
              activeSection === "tools" && activeTool === "api-tester"
                ? " active"
                : ""
            }`}
            type="button"
            tabIndex={toolsOpen || collapsed ? 0 : -1}
            onClick={() => onToolChange("api-tester")}
            title="API Tester"
          >
            <FlaskConical size={16} />
            <span>API Tester</span>
          </button>
          <button
            className={`project-item tool-item${
              activeSection === "tools" && activeTool === "cryptographic"
                ? " active"
                : ""
            }`}
            type="button"
            tabIndex={toolsOpen || collapsed ? 0 : -1}
            onClick={() => onToolChange("cryptographic")}
            title="Cryptographic"
          >
            <Binary size={16} />
            <span>Cryptographic</span>
          </button>

          {collapsed ? (
            <>
              <button
                className={`nav-item add-project-collapsed-btn${
                  activeSection === "tools" && activeTool === "comparing"
                    ? " active"
                    : ""
                }`}
                type="button"
                onClick={() => onToolChange("comparing")}
                aria-label="Comparing"
                title="Comparing"
              >
                <GitCompare size={18} />
              </button>
              <button
                className={`nav-item add-project-collapsed-btn${
                  activeSection === "tools" && activeTool === "api-tester"
                    ? " active"
                    : ""
                }`}
                type="button"
                onClick={() => onToolChange("api-tester")}
                aria-label="API Tester"
                title="API Tester"
              >
                <FlaskConical size={18} />
              </button>
              <button
                className={`nav-item add-project-collapsed-btn${
                  activeSection === "tools" && activeTool === "cryptographic"
                    ? " active"
                    : ""
                }`}
                type="button"
                onClick={() => onToolChange("cryptographic")}
                aria-label="Cryptographic"
                title="Cryptographic"
              >
                <Binary size={18} />
              </button>
            </>
          ) : null}
        </div>
      </nav>

      {databaseContextMenu ? (
        <div
          className="database-context-menu sidebar-database-context-menu"
          style={{
            left: databaseContextMenu.x,
            top: databaseContextMenu.y,
          }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {databaseContextMenu.connection.status === "connected" ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDatabaseDisconnect(databaseContextMenu.connection);
                setDatabaseContextMenu(null);
              }}
            >
              <Unplug size={14} />
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDatabaseConnect(databaseContextMenu.connection);
                setDatabaseContextMenu(null);
              }}
            >
              <PlugZap size={14} />
              Connect
            </button>
          )}
        </div>
      ) : null}

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
  const target = formatDatabaseConnectionTarget(connection);
  return [
    getConnectionDisplayName(connection),
    connection.type,
    connection.status,
    target,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDatabaseConnectionTarget(connection: DatabaseConnection): string {
  if (connection.type === "Oracle") {
    if (connection.connectionMode === "tnsAlias") {
      return connection.networkAlias?.trim() || connection.schema || "";
    }
    if (connection.connectionMode === "connectString") {
      return connection.connectString?.trim() || "";
    }
  }

  return [connection.host, connection.port].filter(Boolean).join(":");
}

function getServiceState(
  statuses: ServiceStatusRecord[] | undefined,
  service: "frontend" | "wildfly",
): string {
  return statuses?.find((s) => s.service === service)?.state ?? "unknown";
}

function ServiceStatusTooltip({
  statuses,
}: {
  statuses: ServiceStatusRecord[] | undefined;
}): JSX.Element {
  const frontendState = getServiceState(statuses, "frontend");
  const wildflyState = getServiceState(statuses, "wildfly");
  return (
    <span className="service-status-tooltip">
      <span className="service-status-tooltip-row">
        <span className="service-status-tooltip-label">Frontend</span>
        <span className={`service-status-tooltip-state ${frontendState}`}>
          {frontendState}
        </span>
      </span>
      <span className="service-status-tooltip-row">
        <span className="service-status-tooltip-label">Backend</span>
        <span className={`service-status-tooltip-state ${wildflyState}`}>
          {wildflyState}
        </span>
      </span>
    </span>
  );
}
