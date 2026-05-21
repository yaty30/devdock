import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  BarChart3,
  Binary,
  Boxes,
  ChevronDown,
  Database,
  FlaskConical,
  FolderKanban,
  GitCompare,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Plus,
  Settings,
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
  ToolId,
} from "../../types";

type ActiveFlyout = "projects" | "databases" | "tools" | null;
type DatabaseInfoFlyoutState = {
  connection: DatabaseConnection;
  top: number;
} | null;

export function Sidebar({
  projects,
  databaseConnections,
  selectedProjectId,
  selectedDatabaseConnectionId,
  activeSection,
  activeTool,
  collapsed,
  debugEnabled = false,
  projectStatuses = {},
  projectFrontendEnabled = {},
  onProjectChange,
  onDatabaseConnectionChange,
  onDatabaseConnect,
  onDatabaseDisconnect,
  onSectionChange,
  onToolChange,
  onAddProject,
  onAddDatabaseConnection,
  onCollapseToggle,
  onInterfaceSettings,
  onDebugBuildNotification,
}: {
  projects: Project[];
  databaseConnections: DatabaseConnection[];
  selectedProjectId: string;
  selectedDatabaseConnectionId: string | null;
  activeSection: AppSection;
  activeTool: ToolId;
  collapsed: boolean;
  debugEnabled?: boolean;
  projectStatuses?: Record<string, ServiceStatusRecord[]>;
  projectFrontendEnabled?: Record<string, boolean>;
  onProjectChange: (project: Project) => void;
  onDatabaseConnectionChange: (connection: DatabaseConnection) => void;
  onDatabaseConnect: (connection: DatabaseConnection) => void;
  onDatabaseDisconnect: (connection: DatabaseConnection) => void;
  onSectionChange: (section: AppSection) => void;
  onToolChange: (tool: ToolId) => void;
  onAddProject: () => void;
  onAddDatabaseConnection: () => void;
  onCollapseToggle: () => void;
  onInterfaceSettings: () => void;
  onDebugBuildNotification?: () => void;
}): JSX.Element {
  const sidebarRef = useRef<HTMLElement>(null);
  const flyoutCloseTimerRef = useRef<number | null>(null);
  const databaseInfoFlyoutCloseTimerRef = useRef<number | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [databasesOpen, setDatabasesOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [activeFlyout, setActiveFlyout] = useState<ActiveFlyout>(null);
  const [activeFlyoutTop, setActiveFlyoutTop] = useState(78);
  const [databaseInfoFlyout, setDatabaseInfoFlyout] =
    useState<DatabaseInfoFlyoutState>(null);
  const [databaseContextMenu, setDatabaseContextMenu] = useState<{
    connection: DatabaseConnection;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!collapsed) {
      setActiveFlyout(null);
    } else {
      setDatabaseInfoFlyout(null);
    }
  }, [collapsed]);

  useEffect(() => {
    if (!activeFlyout) {
      return undefined;
    }

    function closeFlyoutOnPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (target instanceof Node && sidebarRef.current?.contains(target)) {
        return;
      }
      setActiveFlyout(null);
    }

    function closeFlyoutOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setActiveFlyout(null);
      }
    }

    window.addEventListener("pointerdown", closeFlyoutOnPointerDown);
    window.addEventListener("keydown", closeFlyoutOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeFlyoutOnPointerDown);
      window.removeEventListener("keydown", closeFlyoutOnEscape);
    };
  }, [activeFlyout]);

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

  useEffect(() => {
    return () => {
      if (flyoutCloseTimerRef.current !== null) {
        window.clearTimeout(flyoutCloseTimerRef.current);
      }
      if (databaseInfoFlyoutCloseTimerRef.current !== null) {
        window.clearTimeout(databaseInfoFlyoutCloseTimerRef.current);
      }
    };
  }, []);

  function clearFlyoutCloseTimer(): void {
    if (flyoutCloseTimerRef.current !== null) {
      window.clearTimeout(flyoutCloseTimerRef.current);
      flyoutCloseTimerRef.current = null;
    }
  }

  function openFlyout(
    section: Exclude<ActiveFlyout, null>,
    anchor?: HTMLButtonElement,
  ): void {
    clearFlyoutCloseTimer();
    if (anchor && sidebarRef.current) {
      const sidebarRect = sidebarRef.current.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      setActiveFlyoutTop(anchorRect.top - sidebarRect.top);
    }
    setActiveFlyout(section);
  }

  function closeFlyout(): void {
    clearFlyoutCloseTimer();
    setActiveFlyout(null);
  }

  function scheduleFlyoutClose(): void {
    clearFlyoutCloseTimer();
    flyoutCloseTimerRef.current = window.setTimeout(() => {
      setActiveFlyout(null);
      flyoutCloseTimerRef.current = null;
    }, 140);
  }

  function clearDatabaseInfoFlyoutCloseTimer(): void {
    if (databaseInfoFlyoutCloseTimerRef.current !== null) {
      window.clearTimeout(databaseInfoFlyoutCloseTimerRef.current);
      databaseInfoFlyoutCloseTimerRef.current = null;
    }
  }

  function openDatabaseInfoFlyout(
    connection: DatabaseConnection,
    anchor: HTMLElement,
  ): void {
    if (collapsed || !sidebarRef.current) {
      return;
    }
    clearDatabaseInfoFlyoutCloseTimer();
    const sidebarRect = sidebarRef.current.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    setDatabaseInfoFlyout({
      connection,
      top: anchorRect.top - sidebarRect.top,
    });
  }

  function scheduleDatabaseInfoFlyoutClose(): void {
    clearDatabaseInfoFlyoutCloseTimer();
    databaseInfoFlyoutCloseTimerRef.current = window.setTimeout(() => {
      setDatabaseInfoFlyout(null);
      databaseInfoFlyoutCloseTimerRef.current = null;
    }, 140);
  }

  return (
    <aside
      ref={sidebarRef}
      className={`sidebar${collapsed ? " collapsed" : ""}`}
      onMouseEnter={collapsed ? clearFlyoutCloseTimer : undefined}
      onMouseLeave={collapsed ? scheduleFlyoutClose : undefined}
    >
      <div className="brand">
        <div className="brand-mark">
          {/* <Atom size={27} strokeWidth={2.2} />
           */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="27"
            height="27"
            viewBox="0 0 24 24"
            fill="none"
            stroke="url(#shrimpGradient)"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            className="lucide lucide-shrimp-icon lucide-shrimp"
          >
            <defs>
              <linearGradient
                id="shrimpGradient"
                x1="0"
                y1="0"
                x2="24"
                y2="24"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stop-color="#c4b5fd" />
                <stop offset="45%" stop-color="#8b8df8" />
                <stop offset="100%" stop-color="#6366f1" />
              </linearGradient>
            </defs>

            <path d="M11 12h.01" />
            <path d="M13 22c.5-.5 1.12-1 2.5-1-1.38 0-2-.5-2.5-1" />
            <path d="M14 2a3.28 3.28 0 0 1-3.227 1.798l-6.17-.561A2.387 2.387 0 1 0 4.387 8H15.5a1 1 0 0 1 0 13 1 1 0 0 0 0-5H12a7 7 0 0 1-7-7V8" />
            <path d="M14 8a8.5 8.5 0 0 1 0 8" />
            <path d="M16 16c2 0 4.5-4 4-6" />
          </svg>
        </div>
        <span className="brand-label">IVS Dashboard</span>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        {collapsed ? (
          <>
            <CollapsedSidebarItem
              icon={<BarChart3 size={18} />}
              label="Overview"
              tooltipLabel="Overview"
              className="overview-nav-item"
              isActive={activeSection === "dashboard"}
              onHover={closeFlyout}
              onClick={() => {
                closeFlyout();
                onSectionChange("dashboard");
              }}
            />
            <CollapsedSidebarItem
              icon={<FolderKanban size={18} />}
              label="Projects"
              tooltipLabel="Projects"
              hasFlyout
              isOpen={activeFlyout === "projects"}
              isActive={activeSection === "project"}
              onHover={(anchor) => openFlyout("projects", anchor)}
              onClick={(anchor) => openFlyout("projects", anchor)}
            />
            <CollapsedSidebarItem
              icon={<Database size={18} />}
              label="Databases"
              tooltipLabel="Databases"
              hasFlyout
              isOpen={activeFlyout === "databases"}
              isActive={activeSection === "database"}
              onHover={(anchor) => openFlyout("databases", anchor)}
              onClick={(anchor) => openFlyout("databases", anchor)}
            />
            <CollapsedSidebarItem
              icon={<Wrench size={18} />}
              label="Tools"
              tooltipLabel="Tools"
              hasFlyout
              isOpen={activeFlyout === "tools"}
              isActive={activeSection === "tools"}
              onHover={(anchor) => openFlyout("tools", anchor)}
              onClick={(anchor) => openFlyout("tools", anchor)}
            />
          </>
        ) : (
          <>
            <button
              className={`nav-item overview-nav-item${activeSection === "dashboard" ? " active" : ""}`}
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
              {!collapsed ? (
                <ChevronDown className="chevron" size={16} />
              ) : null}
            </button>

            <div
              className={`project-list${projectsOpen && !collapsed ? " open" : ""}`}
              aria-hidden={!collapsed && !projectsOpen}
            >
              {projects.map((project) => {
                const frontendEnabled =
                  projectFrontendEnabled[project.id] ?? true;
                return (
                  <Tooltip
                    key={project.id}
                    className="project-tooltip-anchor"
                    placement="right"
                    content={
                      <ServiceStatusTooltip
                        statuses={projectStatuses[project.id]}
                        frontendEnabled={frontendEnabled}
                      />
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
                            {frontendEnabled ? (
                              <span
                                className={`project-service-dot ${getServiceState(projectStatuses[project.id], "frontend")}`}
                              />
                            ) : null}
                            <span
                              className={`project-service-dot ${getServiceState(projectStatuses[project.id], "wildfly")}`}
                            />
                          </div>
                        </div>
                      </div>
                    </button>
                  </Tooltip>
                );
              })}
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
              {!collapsed ? (
                <ChevronDown className="chevron" size={16} />
              ) : null}
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
                    aria-label={formatDatabaseConnectionAriaLabel(connection)}
                    onMouseEnter={(event) =>
                      openDatabaseInfoFlyout(connection, event.currentTarget)
                    }
                    onMouseLeave={scheduleDatabaseInfoFlyoutClose}
                    onFocus={(event) =>
                      openDatabaseInfoFlyout(connection, event.currentTarget)
                    }
                    onBlur={scheduleDatabaseInfoFlyoutClose}
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
                      <span className="database-type-label">
                        {connection.type}
                      </span>
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
              {!collapsed ? (
                <ChevronDown className="chevron" size={16} />
              ) : null}
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
                      activeSection === "tools" &&
                      activeTool === "cryptographic"
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
          </>
        )}
      </nav>

      {!collapsed && databaseInfoFlyout ? (
        <SidebarFlyout
          title={getConnectionDisplayName(databaseInfoFlyout.connection)}
          top={databaseInfoFlyout.top}
          className="sidebar-database-info-flyout"
          onMouseEnter={clearDatabaseInfoFlyoutCloseTimer}
          onMouseLeave={scheduleDatabaseInfoFlyoutClose}
        >
          <DatabaseConnectionFlyoutInfo
            connection={databaseInfoFlyout.connection}
          />
        </SidebarFlyout>
      ) : null}

      {collapsed && activeFlyout === "projects" ? (
        <SidebarFlyout
          title="Projects"
          top={activeFlyoutTop}
          footerAction={
            <button
              className="sidebar-flyout-footer-action"
              type="button"
              onClick={() => {
                setActiveFlyout(null);
                onAddProject();
              }}
            >
              <Plus size={16} />
              Add Project
            </button>
          }
        >
          <div className="sidebar-flyout-list">
            {projects.length > 0 ? (
              projects.map((project) => (
                <button
                  key={project.id}
                  className={`sidebar-flyout-project${
                    activeSection === "project" &&
                    project.id === selectedProjectId
                      ? " active"
                      : ""
                  }`}
                  type="button"
                  onClick={() => {
                    onProjectChange(project);
                    setActiveFlyout(null);
                  }}
                >
                  <span className="sidebar-flyout-project-heading">
                    <span className="project-code">{project.code}</span>
                    <span className="sidebar-flyout-row-title">
                      {project.name}
                    </span>
                  </span>
                  {(projectFrontendEnabled[project.id] ?? true) ? (
                    <ProjectServiceRow
                      label="Frontend"
                      state={getServiceState(
                        projectStatuses[project.id],
                        "frontend",
                      )}
                    />
                  ) : null}
                  <ProjectServiceRow
                    label="Backend"
                    state={getServiceState(
                      projectStatuses[project.id],
                      "wildfly",
                    )}
                  />
                </button>
              ))
            ) : (
              <div className="sidebar-flyout-empty">
                No projects configured.
              </div>
            )}
          </div>
        </SidebarFlyout>
      ) : null}

      {collapsed && activeFlyout === "databases" ? (
        <SidebarFlyout
          title="Databases"
          top={activeFlyoutTop}
          footerAction={
            <button
              className="sidebar-flyout-footer-action"
              type="button"
              onClick={() => {
                setActiveFlyout(null);
                onAddDatabaseConnection();
              }}
            >
              <Plus size={16} />
              New connection
            </button>
          }
        >
          <div className="sidebar-flyout-list">
            {databaseConnections.length > 0 ? (
              databaseConnections.map((connection) => {
                const displayName = getConnectionDisplayName(connection);
                return (
                  <button
                    key={connection.id}
                    className={`sidebar-flyout-database${
                      activeSection === "database" &&
                      connection.id === selectedDatabaseConnectionId
                        ? " active"
                        : ""
                    }`}
                    type="button"
                    onClick={() => {
                      onDatabaseConnectionChange(connection);
                      setActiveFlyout(null);
                    }}
                  >
                    <span
                      className={`database-status-dot ${connection.status}`}
                    />
                    <span className="sidebar-flyout-database-copy">
                      <span className="sidebar-flyout-row-title">
                        {displayName}
                      </span>
                      <span className="sidebar-flyout-row-meta">
                        {connection.type}
                      </span>
                    </span>
                    <span
                      className={`sidebar-flyout-status ${connection.status}`}
                    >
                      {formatStatusLabel(connection.status)}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="sidebar-flyout-empty">
                No database connections.
              </div>
            )}
          </div>
        </SidebarFlyout>
      ) : null}

      {collapsed && activeFlyout === "tools" ? (
        <SidebarFlyout title="Tools" top={activeFlyoutTop}>
          <div className="sidebar-flyout-list">
            <SidebarFlyoutTool
              icon={<GitCompare size={16} />}
              label="Comparing"
              isActive={activeSection === "tools" && activeTool === "comparing"}
              onClick={() => {
                onToolChange("comparing");
                setActiveFlyout(null);
              }}
            />
            <SidebarFlyoutTool
              icon={<FlaskConical size={16} />}
              label="API Tester"
              isActive={
                activeSection === "tools" && activeTool === "api-tester"
              }
              onClick={() => {
                onToolChange("api-tester");
                setActiveFlyout(null);
              }}
            />
            <SidebarFlyoutTool
              icon={<Binary size={16} />}
              label="Cryptographic"
              isActive={
                activeSection === "tools" && activeTool === "cryptographic"
              }
              onClick={() => {
                onToolChange("cryptographic");
                setActiveFlyout(null);
              }}
            />
          </div>
        </SidebarFlyout>
      ) : null}

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
          debugEnabled ? (
            <button
              className="sidebar-version sidebar-version-button"
              type="button"
              onClick={onDebugBuildNotification}
              title="Show debug build notification"
              aria-label="Show debug build notification"
            >
              v{APP_VERSION}
            </button>
          ) : (
            <span className="sidebar-version">v{APP_VERSION}</span>
          )
        ) : null}
        <div className="sidebar-footer-actions">
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
            onClick={onInterfaceSettings}
            aria-label="Interface settings"
            title="Interface settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function CollapsedSidebarItem({
  icon,
  label,
  isActive,
  isOpen = false,
  className = "",
  onClick,
  onHover,
  tooltipLabel,
  hasFlyout = false,
}: {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  isOpen?: boolean;
  className?: string;
  onClick: (anchor: HTMLButtonElement) => void;
  onHover?: (anchor: HTMLButtonElement) => void;
  tooltipLabel: string;
  hasFlyout?: boolean;
}): JSX.Element {
  const button = (
    <button
      className={`nav-item collapsed-sidebar-item${
        isActive ? " active" : ""
      }${isOpen ? " flyout-open" : ""}${className ? ` ${className}` : ""}`}
      type="button"
      onMouseEnter={(event) => onHover?.(event.currentTarget)}
      onFocus={(event) => onHover?.(event.currentTarget)}
      onClick={(event) => onClick(event.currentTarget)}
      aria-label={label}
      aria-haspopup={hasFlyout ? "dialog" : undefined}
      aria-expanded={hasFlyout ? isOpen : undefined}
    >
      {icon}
    </button>
  );

  if (hasFlyout) {
    return button;
  }

  return (
    <Tooltip
      className="collapsed-sidebar-tooltip-anchor"
      placement="right"
      content={tooltipLabel}
    >
      {button}
    </Tooltip>
  );
}

function SidebarFlyout({
  title,
  children,
  footerAction,
  top,
  className,
  onMouseEnter,
  onMouseLeave,
}: {
  title: string;
  children: ReactNode;
  footerAction?: ReactNode;
  top: number;
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}): JSX.Element {
  const style: CSSProperties = { top };

  return (
    <section
      className={`sidebar-flyout${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="sidebar-flyout-header">{title}</div>
      <div className="sidebar-flyout-body">{children}</div>
      {footerAction ? (
        <div className="sidebar-flyout-footer">{footerAction}</div>
      ) : null}
    </section>
  );
}

function DatabaseConnectionFlyoutInfo({
  connection,
}: {
  connection: DatabaseConnection;
}): JSX.Element {
  const target = formatDatabaseConnectionTarget(connection);

  return (
    <div className="sidebar-database-info-list">
      <span className="sidebar-flyout-service-row">
        <span>Type</span>
        <span className="sidebar-flyout-row-meta">{connection.type}</span>
      </span>
      <span className="sidebar-flyout-service-row">
        <span>Status</span>
        <span className={`sidebar-flyout-status ${connection.status}`}>
          {formatStatusLabel(connection.status)}
        </span>
      </span>
      {target ? (
        <span className="sidebar-flyout-service-row sidebar-database-info-target-row">
          <span>Target</span>
          <span className="sidebar-database-info-target">{target}</span>
        </span>
      ) : null}
    </div>
  );
}

function ProjectServiceRow({
  label,
  state,
}: {
  label: string;
  state: string;
}): JSX.Element {
  return (
    <span className="sidebar-flyout-service-row">
      <span>{label}</span>
      <span className={`sidebar-flyout-status ${state}`}>
        {formatStatusLabel(state)}
      </span>
    </span>
  );
}

function SidebarFlyoutTool({
  icon,
  label,
  isActive,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      className={`sidebar-flyout-tool${isActive ? " active" : ""}`}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
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

function formatDatabaseConnectionAriaLabel(
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

function formatDatabaseConnectionTarget(
  connection: DatabaseConnection,
): string {
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

function formatStatusLabel(status: string): string {
  if (!status) {
    return "Unknown";
  }

  return status
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ServiceStatusTooltip({
  statuses,
  frontendEnabled,
}: {
  statuses: ServiceStatusRecord[] | undefined;
  frontendEnabled: boolean;
}): JSX.Element {
  const frontendState = getServiceState(statuses, "frontend");
  const wildflyState = getServiceState(statuses, "wildfly");
  return (
    <span className="service-status-tooltip">
      {frontendEnabled ? (
        <span className="service-status-tooltip-row">
          <span className="service-status-tooltip-label">Frontend</span>
          <span className={`service-status-tooltip-state ${frontendState}`}>
            {frontendState}
          </span>
        </span>
      ) : null}
      <span className="service-status-tooltip-row">
        <span className="service-status-tooltip-label">Backend</span>
        <span className={`service-status-tooltip-state ${wildflyState}`}>
          {wildflyState}
        </span>
      </span>
    </span>
  );
}
