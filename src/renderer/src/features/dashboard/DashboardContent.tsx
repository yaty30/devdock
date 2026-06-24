import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  Database,
  ExternalLink,
  FolderKanban,
  GitBranch,
  Layers3,
  Minus,
  Server,
  SquareTerminal,
} from "lucide-react";
import { ActionLink } from "../../components/common/ActionLink";
import { FindControls } from "../../components/common/FindControls";
import { VirtualizedLogViewer } from "../../components/common/VirtualizedLogViewer";
import { Panel } from "../../components/common/Panel";
import { Modal } from "../../components/dialogs/Modal";
import {
  clearUnseen,
  INITIAL_LIVE_LINES,
  initViewport,
  LOAD_OLDER_CHUNK,
  prependHistorical,
  replaceWithHistoricalWindow,
  setFollowing,
  setLoadingOlder,
  useLogViewport,
} from "../../hooks/useLogStore";
import type { LogLine } from "../../../../shared/dashboardTypes";
import {
  getProjectBackendLabel,
  getProjectBackendServiceName,
  getPythonServerTypeLabel,
  isProjectFrontendEnabled,
  extractPortFromUrl,
} from "../../../../shared/projectFrontend";
import type {
  BuildStage,
  DatabaseConnection,
  LogChannel,
  ProjectDashboardSummary,
  ProjectRuntimeState,
  ServiceName,
} from "../../types";
import { clamp } from "../../utils/math";

type DashboardLayout = {
  columnWidths: [number, number, number] | null;
  topRowHeight: number | null;
  pythonPanelRatios: [number, number, number] | null;
};

type DragState = {
  type: "column-1" | "column-2" | "row" | "python-panel-1" | "python-panel-2";
  startX: number;
  startY: number;
  startColumnWidths: [number, number, number];
  startTopRowHeight: number;
  availableWidth: number;
  maxTopRowHeight: number;
  startPythonPanelHeights: [number, number, number];
};

type ZoomLogConfig = {
  title: string;
  channel: LogChannel;
  footer: string;
  className: string;
  serviceState?: ProjectRuntimeState["statuses"][number]["state"];
  openDisabled?: boolean;
  dense?: boolean;
  colorize?: boolean;
};

const DASHBOARD_MIN_COLUMN_WIDTH = 230;
const DASHBOARD_MIN_TOP_ROW = 320;
const DASHBOARD_MIN_BOTTOM_ROW = 220;
const DASHBOARD_SPLITTER_SIZE = 16;
const PYTHON_PANEL_MIN_HEIGHT = 118;
const PYTHON_PANEL_SPLITTER_SIZE = 12;
const DEFAULT_PYTHON_PANEL_RATIOS: [number, number, number] = [
  0.95, 0.92, 1.13,
];

function dashboardColumnTemplate(
  columnWidths: DashboardLayout["columnWidths"],
  frontendEnabled: boolean,
  stackFrontendLogs = false,
): string {
  if (!frontendEnabled || stackFrontendLogs) {
    return columnWidths === null
      ? `minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, 2.12fr) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, 0.96fr)`
      : `minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, ${Math.max(
          DASHBOARD_MIN_COLUMN_WIDTH,
          columnWidths[0] + columnWidths[1],
        )}px) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, ${columnWidths[2]}px)`;
  }

  return columnWidths === null
    ? `minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, 1fr) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, 1.12fr) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, 0.96fr)`
    : `minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, ${columnWidths[0]}px) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, ${columnWidths[1]}px) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, ${columnWidths[2]}px)`;
}

function dashboardRowTemplate(
  topRowHeight: DashboardLayout["topRowHeight"],
): string {
  return topRowHeight === null
    ? `minmax(${DASHBOARD_MIN_TOP_ROW}px, 1fr) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_BOTTOM_ROW}px, 1fr)`
    : `minmax(${DASHBOARD_MIN_TOP_ROW}px, ${topRowHeight}px) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_BOTTOM_ROW}px, 1fr)`;
}

function pythonSideRowTemplate(
  ratios: DashboardLayout["pythonPanelRatios"],
): string {
  const [errorsRatio, runtimeRatio, dependenciesRatio] =
    ratios ?? DEFAULT_PYTHON_PANEL_RATIOS;

  return `minmax(${PYTHON_PANEL_MIN_HEIGHT}px, ${errorsRatio}fr) ${PYTHON_PANEL_SPLITTER_SIZE}px minmax(${PYTHON_PANEL_MIN_HEIGHT}px, ${runtimeRatio}fr) ${PYTHON_PANEL_SPLITTER_SIZE}px minmax(${PYTHON_PANEL_MIN_HEIGHT}px, ${dependenciesRatio}fr)`;
}

type LogFindState = {
  term: string;
  matchSeqs: number[];
  activeSeq: number | null;
  current: number;
  total: number;
  findBar: JSX.Element;
};

const LOG_SEARCH_WINDOW_LINES = 1200;

function useLogFind(
  projectId: string,
  channel: LogChannel,
  lines: LogLine[],
  id: string,
): LogFindState {
  const [term, setTerm] = useState("");
  const [activePosition, setActivePosition] = useState(0);
  const [matchSeqs, setMatchSeqs] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [loadingMatch, setLoadingMatch] = useState(false);
  const searchRequestRef = useRef(0);
  const loadRequestRef = useRef(0);
  const safePosition = total === 0 ? 0 : Math.min(activePosition, total - 1);
  const activeSeq = total === 0 ? null : (matchSeqs[safePosition] ?? null);
  const activeSeqLoaded =
    activeSeq === null || lines.some((line) => line.seq === activeSeq);

  useEffect(() => {
    const query = term.trim();
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;

    if (!query) {
      setMatchSeqs([]);
      setTotal(0);
      setActivePosition(0);
      setSearching(false);
      return;
    }

    setSearching(true);
    void window.ivsDashboard
      .searchLog(projectId, channel, query)
      .then((result) => {
        if (searchRequestRef.current !== requestId) {
          return;
        }

        setMatchSeqs(result.matchSeqs);
        setTotal(result.total);
        const firstLoadedPosition = result.matchSeqs.findIndex((seq) =>
          lines.some((line) => line.seq === seq),
        );
        setActivePosition(firstLoadedPosition >= 0 ? firstLoadedPosition : 0);
      })
      .catch((error) => {
        console.error(error);
        if (searchRequestRef.current === requestId) {
          setMatchSeqs([]);
          setTotal(0);
          setActivePosition(0);
        }
      })
      .finally(() => {
        if (searchRequestRef.current === requestId) {
          setSearching(false);
        }
      });
  }, [channel, projectId, term]);

  useEffect(() => {
    setActivePosition((current) =>
      total === 0 ? 0 : Math.min(current, total - 1),
    );
  }, [total]);

  useEffect(() => {
    if (activeSeq === null || activeSeqLoaded) {
      setLoadingMatch(false);
      return;
    }

    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setLoadingMatch(true);
    void window.ivsDashboard
      .getLogAround(projectId, channel, activeSeq, LOG_SEARCH_WINDOW_LINES)
      .then((result) => {
        if (loadRequestRef.current === requestId) {
          replaceWithHistoricalWindow(projectId, channel, result);
        }
      })
      .catch((error) => console.error(error))
      .finally(() => {
        if (loadRequestRef.current === requestId) {
          setLoadingMatch(false);
        }
      });
  }, [activeSeq, activeSeqLoaded, channel, projectId]);

  function move(delta: number): void {
    if (total === 0) {
      return;
    }

    setActivePosition((current) => (current + delta + total) % total);
  }

  const findBar = (
    <FindControls
      id={id}
      value={term}
      activeIndex={safePosition}
      matchCount={total}
      searching={searching || loadingMatch}
      onChange={setTerm}
      onPrevious={() => move(-1)}
      onNext={() => move(1)}
      onClear={() => {
        searchRequestRef.current += 1;
        loadRequestRef.current += 1;
        setTerm("");
        setActivePosition(0);
        setMatchSeqs([]);
        setTotal(0);
        setSearching(false);
        setLoadingMatch(false);
      }}
    />
  );

  return {
    term,
    matchSeqs,
    activeSeq,
    current: total === 0 ? 0 : safePosition + 1,
    total,
    findBar,
  };
}

const BUILD_INITIAL_LOG_LINES = 800;
const BUILD_LOAD_OLDER_LINES = 800;

function useLogPanel(
  projectId: string,
  channel: LogChannel,
  initialLimit = INITIAL_LIVE_LINES,
  olderChunk = LOAD_OLDER_CHUNK,
) {
  const viewport = useLogViewport(projectId, channel);

  useEffect(() => {
    let cancelled = false;
    void window.ivsDashboard
      .getLogLatest(projectId, channel, initialLimit)
      .then((result) => {
        if (!cancelled) initViewport(projectId, channel, result);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, channel, initialLimit]);

  const handleLoadOlder = async (): Promise<void> => {
    if (
      viewport.isLoadingOlder ||
      !viewport.hasMoreOlder ||
      viewport.oldestLoadedSeq === null
    )
      return;
    setLoadingOlder(projectId, channel, true);
    const result = await window.ivsDashboard.getLogBefore(
      projectId,
      channel,
      viewport.oldestLoadedSeq,
      olderChunk,
    );
    prependHistorical(projectId, channel, result);
  };

  const handleJumpToBottom = (): void => clearUnseen(projectId, channel);
  const handleFollowingChange = (following: boolean): void =>
    setFollowing(projectId, channel, following);

  return {
    viewport,
    handleLoadOlder,
    handleJumpToBottom,
    handleFollowingChange,
  };
}

function useColorizeState(
  projectId: string,
  channel: string,
  defaultValue: boolean,
): [boolean, () => void] {
  const key = `ivs-colorize-${projectId}-${channel}`;
  const getStoredValue = useCallback((): boolean => {
    const stored = window.localStorage.getItem(key);
    return stored !== null ? stored === "true" : defaultValue;
  }, [defaultValue, key]);
  const [state, setState] = useState<{ active: boolean; key: string }>(() => {
    return { active: getStoredValue(), key };
  });
  const active = state.key === key ? state.active : getStoredValue();
  useEffect(() => {
    if (state.key !== key || state.active !== active) {
      setState({ active, key });
    }
  }, [active, key, state.active, state.key]);
  const toggle = useCallback(() => {
    setState((current) => {
      const currentActive =
        current.key === key ? current.active : getStoredValue();
      const next = !currentActive;
      window.localStorage.setItem(key, String(next));
      return { active: next, key };
    });
  }, [getStoredValue, key]);
  return [active, toggle];
}

function ColorizeToggle({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`log-colorize-toggle${active ? " active" : ""}`}
      title={active ? "Colorization on" : "Colorization off"}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 512 512"
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="256"
          cy="184"
          r="120"
          className="log-colorize-circle-top"
          strokeWidth="42"
          strokeLinejoin="round"
        />
        <circle
          cx="344"
          cy="328"
          r="120"
          className="log-colorize-circle-right"
          strokeWidth="42"
          strokeLinejoin="round"
        />
        <circle
          cx="168"
          cy="328"
          r="120"
          className="log-colorize-circle-left"
          strokeWidth="42"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function ZoomIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M15.85 3.85 17.3 5.3l-2.18 2.16c-.39.39-.39 1.03 0 1.42s1.03.39 1.42 0L18.7 6.7l1.45 1.45c.31.31.85.09.85-.36V3.5c0-.28-.22-.5-.5-.5h-4.29c-.45 0-.67.54-.36.85m-12 4.3L5.3 6.7l2.16 2.18c.39.39 1.03.39 1.42 0s.39-1.03 0-1.42L6.7 5.3l1.45-1.45c.31-.31.09-.85-.36-.85H3.5c-.28 0-.5.22-.5.5v4.29c0 .45.54.67.85.36m4.3 12L6.7 18.7l2.18-2.16c.39-.39.39-1.03 0-1.42s-1.03-.39-1.42 0L5.3 17.3l-1.45-1.45c-.31-.31-.85-.09-.85.36v4.29c0 .28.22.5.5.5h4.29c.45 0 .67-.54.36-.85m12-4.3L18.7 17.3l-2.16-2.18c-.39-.39-1.03-.39-1.42 0s-.39 1.03 0 1.42l2.18 2.16-1.45 1.45c-.31.31-.09.85.36.85h4.29c.28 0 .5-.22.5-.5v-4.29c0-.45-.54-.67-.85-.36" />
    </svg>
  );
}

function LogZoomButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="log-zoom-button"
      aria-label="Open enlarged log"
      title="Open enlarged log"
      onClick={onClick}
    >
      <ZoomIcon />
    </button>
  );
}

function LogPanel({
  title,
  projectId,
  channel,
  footer,
  onOpen,
  openDisabled = false,
  serviceState,
  className,
  dense = false,
  colorize = true,
  suspendAutoFollow = false,
  onZoom,
}: {
  title: string;
  projectId: string;
  channel: LogChannel;
  footer: string;
  onOpen?: () => void;
  openDisabled?: boolean;
  serviceState?: ProjectRuntimeState["statuses"][number]["state"];
  className?: string;
  dense?: boolean;
  colorize?: boolean;
  suspendAutoFollow?: boolean;
  onZoom?: () => void;
}): JSX.Element {
  const {
    viewport,
    handleLoadOlder,
    handleJumpToBottom,
    handleFollowingChange,
  } = useLogPanel(projectId, channel);
  const findId = useId().replace(/:/g, "");
  const id = `find-${title.toLowerCase().replace(/\s+/g, "-")}-${findId}`;
  const find = useLogFind(projectId, channel, viewport.lines, id);
  const [colorizeActive, toggleColorize] = useColorizeState(
    projectId,
    channel,
    colorize,
  );

  return (
    <Panel
      title={title}
      titleMeta={
        serviceState === undefined ? (
          <span className="status-pill success">Live</span>
        ) : (
          statusPill(serviceState)
        )
      }
      action={
        <div className="log-panel-actions">
          <ColorizeToggle active={colorizeActive} onClick={toggleColorize} />
          <ActionLink disabled={openDisabled} onClick={onOpen}>
            {footer}
          </ActionLink>
          {onZoom ? <LogZoomButton onClick={onZoom} /> : null}
        </div>
      }
      className={className}
      findBar={find.findBar}
    >
      <VirtualizedLogViewer
        lines={viewport.lines}
        dense={dense}
        colorize={colorizeActive}
        highlight={find.term}
        activeMatchSeq={find.activeSeq}
        isLoadingOlder={viewport.isLoadingOlder}
        hasMoreOlder={viewport.hasMoreOlder}
        unseenCount={viewport.unseenNewLineCount}
        isFollowing={viewport.isFollowing}
        suspendAutoFollow={suspendAutoFollow}
        onLoadOlder={handleLoadOlder}
        onJumpToBottom={handleJumpToBottom}
        onFollowingChange={handleFollowingChange}
      />
    </Panel>
  );
}

function BuildStatusPanel({
  projectId,
  projectState,
}: {
  projectId: string;
  projectState: ProjectRuntimeState;
}): JSX.Element {
  const latestBuild = projectState.recentBuilds[0];
  const now = useNow(latestBuild?.status === "Running" ? 1000 : null);
  const elapsed = latestBuild ? buildElapsed(latestBuild, now) : "--:--";
  const buildStatusLabel = latestBuild?.status ?? "Idle";
  const sourceBranch = latestBuild?.branch ?? projectState.gitStatus.branch;
  const sourceCommit = latestBuild?.commit ?? projectState.gitStatus.commit;
  const buildLines = useLogViewport(projectId, "build").lines;
  const stages = buildStagesFromLatest(
    latestBuild?.status,
    latestBuild,
    buildLines,
    isProjectFrontendEnabled(projectState.settings),
  );

  return (
    <Panel
      title="Build Status"
      titleMeta={
        <div className="build-status-title-meta">
          <span
            className={`status-pill build-status ${buildStatusClass(buildStatusLabel)}`}
          >
            {buildStatusLabel}
          </span>
          <span className="elapsed-pill">{elapsed}</span>
        </div>
      }
      action={
        <ActionLink
          onClick={() => {
            const pomPath = projectState.settings.maven.pomXml;
            const targetPath = pomPath.replace(/[\\/][^\\/]+$/, "\\target");
            void window.ivsDashboard.openPath(targetPath);
          }}
        >
          Open WAR folder
        </ActionLink>
      }
      className="build-status-panel"
    >
      <div className="branch-info">
        <div className="branch-info-title">
          <GitBranch size={14} />
          <span>Git status</span>
        </div>
        <div className="branch-row">
          <span>Source</span>
          <strong>{sourceBranch}</strong>
        </div>
        <div className="branch-row">
          <span>Commit</span>
          <strong>@{sourceCommit}</strong>
        </div>
      </div>
      <div className="timeline">
        {stages.map((stage) => (
          <div className={`timeline-item ${stage.state}`} key={stage.label}>
            {stage.state === "complete" ? (
              <CheckCircle2 size={17} />
            ) : stage.state === "current" ? (
              <CircleDot size={17} />
            ) : (
              <Minus size={17} />
            )}
            <span>{stage.label}</span>
            <time>{stage.time}</time>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function BuildLogPanel({
  projectId,
  suspendAutoFollow = false,
  className = "build-log-panel",
  onZoom,
}: {
  projectId: string;
  suspendAutoFollow?: boolean;
  className?: string;
  onZoom?: () => void;
}): JSX.Element {
  const {
    viewport,
    handleLoadOlder,
    handleJumpToBottom,
    handleFollowingChange,
  } = useLogPanel(
    projectId,
    "build",
    BUILD_INITIAL_LOG_LINES,
    BUILD_LOAD_OLDER_LINES,
  );
  const findId = useId().replace(/:/g, "");
  const find = useLogFind(
    projectId,
    "build",
    viewport.lines,
    `find-build-log-${findId}`,
  );
  const [colorizeActive, toggleColorize] = useColorizeState(
    projectId,
    "build",
    true,
  );

  return (
    <Panel
      title="Build Log"
      action={
        <div className="log-panel-actions">
          <ColorizeToggle active={colorizeActive} onClick={toggleColorize} />
          <ActionLink
            onClick={() => void window.ivsDashboard.openLog(projectId, "build")}
          >
            Open build log
          </ActionLink>
          {onZoom ? <LogZoomButton onClick={onZoom} /> : null}
        </div>
      }
      className={className}
      findBar={find.findBar}
    >
      <VirtualizedLogViewer
        lines={viewport.lines}
        dense
        colorize={colorizeActive}
        highlight={find.term}
        activeMatchSeq={find.activeSeq}
        isLoadingOlder={viewport.isLoadingOlder}
        hasMoreOlder={viewport.hasMoreOlder}
        unseenCount={viewport.unseenNewLineCount}
        isFollowing={viewport.isFollowing}
        suspendAutoFollow={suspendAutoFollow}
        onLoadOlder={handleLoadOlder}
        onJumpToBottom={handleJumpToBottom}
        onFollowingChange={handleFollowingChange}
      />
    </Panel>
  );
}

function TailLogPanel({
  projectId,
  configured = true,
  suspendAutoFollow = false,
  className = "tail-log-panel",
  onZoom,
}: {
  projectId: string;
  configured?: boolean;
  suspendAutoFollow?: boolean;
  className?: string;
  onZoom?: () => void;
}): JSX.Element {
  const {
    viewport,
    handleLoadOlder,
    handleJumpToBottom,
    handleFollowingChange,
  } = useLogPanel(projectId, "tail");
  const findId = useId().replace(/:/g, "");
  const find = useLogFind(
    projectId,
    "tail",
    viewport.lines,
    `find-tail-log-${findId}`,
  );
  const [colorizeActive, toggleColorize] = useColorizeState(
    projectId,
    "tail",
    true,
  );

  return (
    <Panel
      title="Tail Log"
      titleMeta={
        <span className={`status-pill ${configured ? "success" : "idle"}`}>
          {configured ? "Live" : "Idle"}
        </span>
      }
      action={
        configured ? (
          <div className="log-panel-actions">
            <ColorizeToggle active={colorizeActive} onClick={toggleColorize} />
            <ActionLink
              onClick={() =>
                void window.ivsDashboard.openLog(projectId, "tail")
              }
            >
              Open full log
            </ActionLink>
            {onZoom ? <LogZoomButton onClick={onZoom} /> : null}
          </div>
        ) : undefined
      }
      className={className}
      findBar={configured ? find.findBar : undefined}
    >
      {configured ? (
        <VirtualizedLogViewer
          lines={viewport.lines}
          dense
          colorize={colorizeActive}
          highlight={find.term}
          activeMatchSeq={find.activeSeq}
          isLoadingOlder={viewport.isLoadingOlder}
          hasMoreOlder={viewport.hasMoreOlder}
          unseenCount={viewport.unseenNewLineCount}
          isFollowing={viewport.isFollowing}
          suspendAutoFollow={suspendAutoFollow}
          onLoadOlder={handleLoadOlder}
          onJumpToBottom={handleJumpToBottom}
          onFollowingChange={handleFollowingChange}
        />
      ) : (
        <div className="empty-panel-state">No application log configured.</div>
      )}
    </Panel>
  );
}

export function DashboardContent({
  projects,
  databaseConnections,
  loading,
}: {
  projects: ProjectDashboardSummary[];
  databaseConnections: DatabaseConnection[];
  loading: boolean;
}): JSX.Element {
  const hasRunningService = projects.some((summary) =>
    summary.statuses.some((status) => status.state === "running"),
  );
  const now = useNow(hasRunningService ? 1000 : null);
  const runningServices = projects.reduce(
    (count, summary) =>
      count +
      summary.statuses.filter((status) => status.state === "running").length,
    0,
  );
  const expectedServices = projects.length * 2;
  const connectedDatabases = databaseConnections.filter(
    (connection) => connection.status === "connected",
  ).length;
  const lastUpdated = latestCheckedAt(projects);

  return (
    <section
      className={`dashboard-overview-screen${loading ? " overview-loading" : ""}`}
      aria-busy={loading}
    >
      <div className="dashboard-kpi-grid">
        <OverviewKpi
          icon={<FolderKanban size={22} />}
          label="Total Projects"
          value={String(projects.length)}
          tone="project"
        />
        <OverviewKpi
          icon={<Activity size={22} />}
          label="Services Running"
          value={`${runningServices}/${expectedServices}`}
          tone="service"
        />
        <OverviewKpi
          icon={<Database size={22} />}
          label="Databases"
          value={`${connectedDatabases}/${databaseConnections.length}`}
          tone="database"
        />
        <OverviewKpi
          icon={<Clock3 size={22} />}
          label="Last Updated"
          value={lastUpdated ? formatTime(lastUpdated) : "--"}
          tone="time"
        />
      </div>

      <div className="dashboard-project-list">
        {projects.length > 0 ? (
          <>
            {projects.map((summary) => (
              <ProjectStatusRow
                key={summary.project.id}
                summary={summary}
                now={now}
              />
            ))}
            <DatabaseOverviewSection connections={databaseConnections} />
          </>
        ) : (
          <>
            <div className="dashboard-empty">No projects configured.</div>
            <DatabaseOverviewSection connections={databaseConnections} />
          </>
        )}
      </div>
      {loading ? (
        <div
          className="dashboard-overview-loading"
          role="status"
          aria-label="Loading overview"
        >
          <span className="dashboard-overview-spinner" />
        </div>
      ) : null}
    </section>
  );
}

function OverviewKpi({
  icon,
  label,
  value,
  tone,
}: {
  icon: JSX.Element;
  label: string;
  value: string;
  tone: "project" | "service" | "database" | "time";
}): JSX.Element {
  return (
    <article className="dashboard-kpi-card">
      <div className={`dashboard-kpi-icon ${tone}`}>{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function DatabaseOverviewSection({
  connections,
}: {
  connections: DatabaseConnection[];
}): JSX.Element {
  if (connections.length === 0) {
    return (
      <div className="dashboard-empty dashboard-database-empty">
        No database connections configured.
      </div>
    );
  }

  return (
    <>
      {connections.map((connection) => (
        <DatabaseStatusRow connection={connection} key={connection.id} />
      ))}
    </>
  );
}

function DatabaseStatusRow({
  connection,
}: {
  connection: DatabaseConnection;
}): JSX.Element {
  const status = databaseConnectionStatus(connection.status);
  const databaseName = connection.database || connection.schema || "Not set";
  const target = formatDatabaseTarget(connection);
  const serverDetails = getDatabaseServerDetails(connection);

  return (
    <article className="dashboard-project-card dashboard-database-card">
      <header className="dashboard-project-card-header">
        <div className="dashboard-project-title-group">
          <span className="dashboard-project-code dashboard-database-code">
            <Database size={18} />
          </span>
          <div>
            <h2>{connection.name}</h2>
            <div className="dashboard-project-meta">
              <span>Connection ID</span>
              <strong>{connection.id}</strong>
              <i />
              <span>Driver</span>
              <strong>{connection.type}</strong>
            </div>
          </div>
        </div>

        <div className="dashboard-project-status-groups">
          <div className="dashboard-status-group">
            <span>
              <span className={`dashboard-status-dot ${status.tone}`} />
              Connection Status
            </span>
            {databaseStatusPill(connection.status)}
          </div>
          <div className="dashboard-status-group">
            <span>Target</span>
            <strong className="dashboard-status-value idle">{target}</strong>
          </div>
        </div>
      </header>

      <div className="dashboard-project-detail-grid">
        <section className="dashboard-project-detail">
          <header>
            <Database size={18} />
            <h3>Database</h3>
            {databaseStatusPill(connection.status)}
          </header>
          <DashboardDetailRow label="Schema">
            <strong>{databaseName}</strong>
          </DashboardDetailRow>
          <DashboardDetailRow label="User">
            <strong>{connection.user || "Not set"}</strong>
          </DashboardDetailRow>
        </section>

        <section className="dashboard-project-detail">
          <header>
            <Layers3 size={18} />
            <h3>Server</h3>
          </header>
          {serverDetails.map((detail) => (
            <DashboardDetailRow label={detail.label} key={detail.label}>
              <strong>{detail.value}</strong>
            </DashboardDetailRow>
          ))}
        </section>

        <section className="dashboard-project-detail">
          <header>
            <Activity size={18} />
            <h3>Session</h3>
          </header>
          <DashboardDetailRow label="Latency">
            <strong>{connection.latency || "Not tested"}</strong>
          </DashboardDetailRow>
          <DashboardDetailRow label="Uptime">
            <strong>{connection.uptime || "Not connected"}</strong>
          </DashboardDetailRow>
        </section>

        <section className="dashboard-project-detail">
          <header>
            <Clock3 size={18} />
            <h3>Security</h3>
          </header>
          <DashboardDetailRow label="SSL">
            <strong>{connection.sslMode ?? "disabled"}</strong>
          </DashboardDetailRow>
          <DashboardDetailRow label="Password">
            <strong>
              {connection.savePassword ? "Saved" : "Session only"}
            </strong>
          </DashboardDetailRow>
        </section>
      </div>
    </article>
  );
}

function ProjectStatusRow({
  summary,
  now,
}: {
  summary: ProjectDashboardSummary;
  now: number;
}): JSX.Element {
  const frontendEnabled = summary.frontendEnabled;
  const frontend = serviceStatus(summary, "frontend");
  const backend = serviceStatus(summary, summary.project.backendType);
  const backendLabel = summary.serviceUrls.backendLabel;
  const isPython = summary.project.backendType === "python";
  const showBuildSummary = !isPython;
  const overallStatus = projectOverallStatus(summary);
  const lastBuild = summary.lastBuild;
  const healthConfigured = Boolean(summary.serviceUrls.backendHealthPort);
  const healthState = !healthConfigured
    ? "unknown"
    : backend?.state === "running"
      ? "success"
      : backend?.state === "failed"
        ? "failed"
        : backend?.state;

  return (
    <article className="dashboard-project-card">
      <header className="dashboard-project-card-header">
        <div className="dashboard-project-title-group">
          <span className="dashboard-project-code">
            <Server size={18} />
          </span>
          <div>
            <h2>{summary.project.name}</h2>
            <div className="dashboard-project-meta">
              <span>Project ID</span>
              <strong>{summary.project.id}</strong>
              <i />
              <span>Services</span>
              <strong>
                {frontendEnabled ? `Frontend / ${backendLabel}` : backendLabel}
              </strong>
            </div>
          </div>
        </div>

        <div className="dashboard-project-status-groups">
          <div className="dashboard-status-group">
            <span>
              <span className={`dashboard-status-dot ${overallStatus.tone}`} />
              Overall Status
            </span>
            <strong className={`dashboard-status-value ${overallStatus.tone}`}>
              {overallStatus.label}
            </strong>
          </div>
          {showBuildSummary ? (
            <div className="dashboard-status-group">
              <span>Last Build Status</span>
              {lastBuild ? (
                buildStatusPill(lastBuild.status)
              ) : (
                <strong className="dashboard-status-value idle">
                  No builds
                </strong>
              )}
            </div>
          ) : (
            <div className="dashboard-status-group">
              <span>Health Check Port</span>
              {healthConfigured ? (
                statusPill(healthState)
              ) : (
                <strong className="dashboard-status-value idle">
                  Not configured
                </strong>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="dashboard-project-detail-grid">
        <section className="dashboard-project-detail">
          <header>
            <SquareTerminal size={18} />
            <h3>Frontend</h3>
            {frontendEnabled ? statusPill(frontend?.state) : null}
          </header>
          {frontendEnabled ? (
            <>
              <DashboardDetailRow label="URL">
                {summary.serviceUrls.frontendUrl ? (
                  <a
                    className="monitor-link"
                    href={summary.serviceUrls.frontendUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>{summary.serviceUrls.frontendUrl}</span>
                    <ExternalLink size={13} />
                  </a>
                ) : (
                  <strong>Not set</strong>
                )}
              </DashboardDetailRow>
              <DashboardDetailRow label="Last Check">
                <strong>
                  {frontend ? formatDate(frontend.checkedAt) : "Not checked"}
                </strong>
              </DashboardDetailRow>
            </>
          ) : (
            <DashboardDetailRow label="Status">
              <strong>Not configured</strong>
            </DashboardDetailRow>
          )}
        </section>

        <section className="dashboard-project-detail">
          <header>
            <Layers3 size={18} />
            <h3>{backendLabel}</h3>
            {statusPill(backend?.state)}
          </header>
          {summary.project.backendType === "wildfly" ? (
            <DashboardDetailRow label="Console">
              {summary.serviceUrls.backendManagementUrl ? (
                <a
                  className="monitor-link"
                  href={summary.serviceUrls.backendManagementUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{summary.serviceUrls.backendManagementUrl}</span>
                  <ExternalLink size={13} />
                </a>
              ) : (
                <strong>Not set</strong>
              )}
            </DashboardDetailRow>
          ) : null}
          <DashboardDetailRow
            label={
              summary.project.backendType === "wildfly" ? "KMU" : "App URL"
            }
          >
            {summary.serviceUrls.backendUrl ? (
              <a
                className="monitor-link"
                href={summary.serviceUrls.backendUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span>{summary.serviceUrls.backendUrl}</span>
                <ExternalLink size={13} />
              </a>
            ) : (
              <strong>Not set</strong>
            )}
          </DashboardDetailRow>
          {isPython ? (
            <DashboardDetailRow label="Server type">
              <strong>
                {summary.serviceUrls.backendServerType || "Custom"}
              </strong>
            </DashboardDetailRow>
          ) : null}
        </section>

        <section className="dashboard-project-detail">
          <header>
            <Clock3 size={18} />
            <h3>Uptime</h3>
          </header>
          <DashboardDetailRow label="Frontend">
            <strong>
              {frontendEnabled
                ? formatServiceUptime(frontend, now)
                : "Not configured"}
            </strong>
          </DashboardDetailRow>
          <DashboardDetailRow label={backendLabel}>
            <strong>{formatServiceUptime(backend, now)}</strong>
          </DashboardDetailRow>
        </section>

        {showBuildSummary ? (
          <section className="dashboard-project-detail">
            <header>
              <Clock3 size={18} />
              <h3>Last Build</h3>
              {lastBuild ? (
                buildStatusPill(lastBuild.status)
              ) : (
                <strong className="dashboard-status-value idle">
                  No builds
                </strong>
              )}
            </header>
            <DashboardDetailRow label="Duration">
              <strong>{lastBuild?.duration ?? "--"}</strong>
            </DashboardDetailRow>
            <DashboardDetailRow label="Completed">
              <strong>{lastBuild?.completed ?? "No builds recorded"}</strong>
            </DashboardDetailRow>
          </section>
        ) : (
          <section className="dashboard-project-detail">
            <header>
              <Activity size={18} />
              <h3>Health Check Port</h3>
              {healthConfigured ? statusPill(healthState) : null}
            </header>
            <DashboardDetailRow label="Status">
              <strong>
                {healthConfigured
                  ? backend?.state === "running"
                    ? "Healthy"
                    : "Unknown"
                  : "Not configured"}
              </strong>
            </DashboardDetailRow>
            <DashboardDetailRow label="Port">
              <strong>{summary.serviceUrls.backendHealthPort || "--"}</strong>
            </DashboardDetailRow>
            <DashboardDetailRow label="Last Check">
              <strong>
                {backend?.checkedAt ? formatDate(backend.checkedAt) : "--"}
              </strong>
            </DashboardDetailRow>
          </section>
        )}
      </div>
    </article>
  );
}

function DashboardDetailRow({
  label,
  children,
}: {
  label: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="dashboard-detail-row">
      <span>{label}</span>
      {children}
    </div>
  );
}

function databaseConnectionStatus(status: DatabaseConnection["status"]): {
  label: string;
  tone: "success" | "warning" | "failed" | "idle";
  pillClass: "success" | "warning" | "failed";
} {
  if (status === "connected") {
    return { label: "Connected", tone: "success", pillClass: "success" };
  }
  if (status === "error") {
    return { label: "Error", tone: "failed", pillClass: "failed" };
  }
  return { label: "Disconnected", tone: "warning", pillClass: "warning" };
}

function databaseStatusPill(status: DatabaseConnection["status"]): JSX.Element {
  const state = databaseConnectionStatus(status);
  return (
    <span className={`status-pill ${state.pillClass}`}>{state.label}</span>
  );
}

function formatDatabaseTarget(connection: DatabaseConnection): string {
  if (connection.type === "Oracle") {
    if (connection.connectionMode === "tnsAlias") {
      return connection.networkAlias?.trim() || connection.schema || "Not set";
    }
    if (connection.connectionMode === "connectString") {
      return connection.connectString?.trim() || "Not set";
    }
  }

  const host = connection.host.trim();
  const port = connection.port.trim();
  if (!host && !port) {
    return "Not set";
  }
  if (!port) {
    return host;
  }
  if (!host) {
    return port;
  }
  return `${host}:${port}`;
}

function getDatabaseServerDetails(
  connection: DatabaseConnection,
): Array<{ label: string; value: string }> {
  if (
    connection.type === "Oracle" &&
    connection.connectionMode === "tnsAlias"
  ) {
    return [
      {
        label: "Network Alias",
        value:
          connection.networkAlias?.trim() || connection.schema || "Not set",
      },
    ];
  }

  if (
    connection.type === "Oracle" &&
    connection.connectionMode === "connectString"
  ) {
    return [
      {
        label: "Connect String",
        value: connection.connectString?.trim() || "Not set",
      },
    ];
  }

  return [
    { label: "Host", value: connection.host || "Not set" },
    { label: "Port", value: connection.port || "--" },
  ];
}

function projectOverallStatus(summary: ProjectDashboardSummary): {
  label: string;
  tone: "success" | "warning" | "failed" | "idle";
} {
  const frontend = summary.frontendEnabled
    ? serviceStatus(summary, "frontend")
    : undefined;
  const backend = serviceStatus(summary, summary.project.backendType);
  const states = summary.frontendEnabled
    ? [frontend?.state, backend?.state]
    : [backend?.state];

  if (states.every((state) => state === "running")) {
    return { label: "All Services Running", tone: "success" };
  }
  if (states.some((state) => state === "failed")) {
    return { label: "Service Error", tone: "failed" };
  }
  if (states.some((state) => state === "running")) {
    return { label: "Partially Running", tone: "warning" };
  }
  return { label: "No Services Running", tone: "idle" };
}

function latestCheckedAt(
  projects: ProjectDashboardSummary[],
): string | undefined {
  let latestValue: string | undefined;
  let latestTime = Number.NEGATIVE_INFINITY;

  projects.forEach((summary) => {
    summary.statuses.forEach((status) => {
      const time = new Date(status.checkedAt).getTime();
      if (Number.isNaN(time)) {
        return;
      }
      if (time > latestTime) {
        latestValue = status.checkedAt;
        latestTime = time;
      }
    });
  });

  return latestValue;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function serviceStatus(
  summary: { statuses: ProjectDashboardSummary["statuses"] },
  service: ServiceName,
): ProjectDashboardSummary["statuses"][number] | undefined {
  return summary.statuses.find((status) => status.service === service);
}

function PythonRuntimePanel({
  status,
  settings,
}: {
  status: ProjectRuntimeState["statuses"][number] | undefined;
  settings: ProjectRuntimeState["settings"];
}): JSX.Element {
  const healthCheckPort = extractPortFromUrl(settings.python.appUrl);
  return (
    <Panel title="Runtime Status" className="python-runtime-panel">
      <div className="python-runtime-list">
        <DashboardDetailRow label="Server type">
          <strong>
            {getPythonServerTypeLabel(settings.python.serverType)}
          </strong>
        </DashboardDetailRow>
        <DashboardDetailRow label="Process">
          {statusPill(status?.state)}
        </DashboardDetailRow>
        <DashboardDetailRow label="Uptime">
          <strong>{formatServiceUptime(status, Date.now())}</strong>
        </DashboardDetailRow>
        <DashboardDetailRow label="App URL">
          <strong>{settings.python.appUrl || "--"}</strong>
        </DashboardDetailRow>
        <DashboardDetailRow label="Health Check Port">
          <strong>
            {healthCheckPort === null ? "Not detected" : healthCheckPort}
          </strong>
        </DashboardDetailRow>
      </div>
    </Panel>
  );
}

function PythonDependenciesPanel({
  dependencies,
}: {
  dependencies: ProjectRuntimeState["pythonDependencies"];
}): JSX.Element {
  return (
    <Panel title="Dependencies" className="python-dependencies-panel">
      {dependencies.length > 0 ? (
        <div className="python-dependency-list">
          {dependencies.map((dependency) => (
            <div
              className="python-dependency-row"
              key={`${dependency.source}:${dependency.name}`}
            >
              <strong>{dependency.name}</strong>
              <span title={dependency.source}>
                {dependency.version.replace("==", "v")}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-panel-state">No dependencies detected.</div>
      )}
    </Panel>
  );
}

function PythonErrorsPanel({ lines }: { lines: string[] }): JSX.Element {
  const errorLines = lines
    .filter((line) =>
      /\b(error|exception|traceback|failed|failure)\b/i.test(line),
    )
    .slice(-8)
    .reverse();

  return (
    <Panel title="Recent Errors" className="python-errors-panel">
      {errorLines.length > 0 ? (
        <div className="python-error-list">
          {errorLines.map((line, index) => (
            <div className="python-error-row" key={`${index}-${line}`}>
              <AlertTriangle size={15} />
              <span>{line}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-panel-state">No recent errors detected.</div>
      )}
    </Panel>
  );
}

export function ProjectDashboardContent({
  projectId,
  resetVersion,
  projectState,
}: {
  projectId: string;
  resetVersion: number;
  projectState: ProjectRuntimeState;
}): JSX.Element {
  const frontendEnabled = isProjectFrontendEnabled(projectState.settings);
  const backendService = getProjectBackendServiceName(projectState.settings);
  const backendLabel = getProjectBackendLabel(projectState.settings);
  const frontendStatus = serviceStatus(projectState, "frontend");
  const backendStatus = serviceStatus(projectState, backendService);
  const frontendRunning =
    frontendEnabled && frontendStatus?.state === "running";
  const backendRunning = backendStatus?.state === "running";
  const showBuildPanels =
    projectState.settings.backendType !== "python" ||
    Boolean(projectState.settings.python.buildCommand?.trim());
  const tailLogConfigured = Boolean(projectState.settings.appLogFile.trim());
  const showTailLogPanel =
    projectState.settings.backendType !== "python" || tailLogConfigured;
  const stackFrontendLogs =
    projectState.settings.backendType === "python" && frontendEnabled;
  const gridRef = useRef<HTMLDivElement>(null);
  const pythonSideColumnRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingLayoutRef = useRef<DashboardLayout | null>(null);
  const resizingRef = useRef(false);
  const prevAvailableWidthRef = useRef<number | null>(null);
  const [layout, setLayout] = useState<DashboardLayout>(() =>
    readStoredLayout(projectId),
  );
  const [zoomLog, setZoomLog] = useState<ZoomLogConfig | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    setLayout(readStoredLayout(projectId));
    prevAvailableWidthRef.current = null;
  }, [resetVersion, projectId]);

  useEffect(() => {
    window.localStorage.setItem(
      `ivs-dashboard-layout-${projectId}`,
      JSON.stringify(layout),
    );
  }, [layout, projectId]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const observer = new ResizeObserver((entries) => {
      if (dragRef.current || resizingRef.current) return;
      const entry = entries[0];
      if (!entry) return;
      const newContentWidth = entry.contentRect.width;
      const splitterCount = frontendEnabled && !stackFrontendLogs ? 2 : 1;
      const newAvailableWidth =
        newContentWidth - DASHBOARD_SPLITTER_SIZE * splitterCount;
      const current = layoutRef.current;
      if (current.columnWidths === null) return;
      const prev =
        prevAvailableWidthRef.current ??
        current.columnWidths.reduce((total, width) => total + width, 0);
      prevAvailableWidthRef.current = newAvailableWidth;
      if (prev === newAvailableWidth) return;
      const ratio = newAvailableWidth / prev;
      const rescaled = current.columnWidths.map((w) =>
        Math.max(DASHBOARD_MIN_COLUMN_WIDTH, w * ratio),
      ) as [number, number, number];
      const nextLayout = { ...current, columnWidths: rescaled };
      applyGridLayout(nextLayout);
      setLayout(nextLayout);
    });

    observer.observe(grid);
    return () => observer.disconnect();
  }, [frontendEnabled, stackFrontendLogs, showBuildPanels, showTailLogPanel]);

  function applyGridLayout(nextLayout: DashboardLayout): void {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    grid.style.setProperty(
      "--dashboard-column-template",
      dashboardColumnTemplate(
        nextLayout.columnWidths,
        frontendEnabled,
        stackFrontendLogs,
      ),
    );
    grid.style.setProperty(
      "--dashboard-row-template",
      dashboardRowTemplate(nextLayout.topRowHeight),
    );
    grid.style.setProperty(
      "--python-side-row-template",
      pythonSideRowTemplate(nextLayout.pythonPanelRatios),
    );
  }

  function scheduleGridLayout(nextLayout: DashboardLayout): void {
    pendingLayoutRef.current = nextLayout;
    applyGridLayout(nextLayout);
  }

  const startResize = (
    type: DragState["type"],
    event: PointerEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizingRef.current = false;

    if (type === "python-panel-1" || type === "python-panel-2") {
      const panelSelectors = [
        ".python-errors-panel",
        ".python-runtime-panel",
        ".python-dependencies-panel",
      ];
      const startPythonPanelHeights = panelSelectors.map(
        (selector) =>
          pythonSideColumnRef.current
            ?.querySelector<HTMLElement>(selector)
            ?.getBoundingClientRect().height ?? 0,
      ) as [number, number, number];

      dragRef.current = {
        type,
        startX: event.clientX,
        startY: event.clientY,
        startColumnWidths: [0, 0, 0],
        startTopRowHeight: 0,
        availableWidth: 0,
        maxTopRowHeight: 0,
        startPythonPanelHeights,
      };
      return;
    }

    const grid = gridRef.current;
    const gridStyles = grid ? window.getComputedStyle(grid) : null;
    const gridPaddingTop = gridStyles
      ? parseFloat(gridStyles.paddingTop) || 0
      : 0;
    const gridPaddingRight = gridStyles
      ? parseFloat(gridStyles.paddingRight) || 0
      : 0;
    const gridPaddingBottom = gridStyles
      ? parseFloat(gridStyles.paddingBottom) || 0
      : 0;
    const gridPaddingLeft = gridStyles
      ? parseFloat(gridStyles.paddingLeft) || 0
      : 0;
    const availableWidth = grid
      ? grid.clientWidth -
        gridPaddingLeft -
        gridPaddingRight -
        DASHBOARD_SPLITTER_SIZE *
          (frontendEnabled && !stackFrontendLogs ? 2 : 1)
      : 0;
    const availableHeight = grid
      ? grid.clientHeight -
        gridPaddingTop -
        gridPaddingBottom -
        DASHBOARD_SPLITTER_SIZE
      : 0;
    const topRowPanel = gridRef.current?.querySelector<HTMLElement>(
      frontendEnabled
        ? ".frontend-panel"
        : showTailLogPanel
          ? ".tail-log-panel"
          : ".wildfly-panel",
    );
    const columnPanels = [
      frontendEnabled && !stackFrontendLogs
        ? gridRef.current?.querySelector<HTMLElement>(".frontend-panel")
        : null,
      stackFrontendLogs
        ? gridRef.current?.querySelector<HTMLElement>(".frontend-panel")
        : gridRef.current?.querySelector<HTMLElement>(
            showTailLogPanel ? ".tail-log-panel" : ".wildfly-panel",
          ),
      gridRef.current?.querySelector<HTMLElement>(
        showBuildPanels ? ".build-status-panel" : ".python-side-column",
      ),
    ];
    const startColumnWidths = columnPanels.map(
      (panel) => panel?.getBoundingClientRect().width ?? 0,
    ) as [number, number, number];

    dragRef.current = {
      type,
      startX: event.clientX,
      startY: event.clientY,
      startColumnWidths,
      startTopRowHeight: topRowPanel?.getBoundingClientRect().height ?? 0,
      availableWidth,
      maxTopRowHeight: Math.max(
        DASHBOARD_MIN_TOP_ROW,
        availableHeight - DASHBOARD_MIN_BOTTOM_ROW,
      ),
      startPythonPanelHeights: [0, 0, 0],
    };
  };

  const resizeLayout = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;

    if (!drag) {
      return;
    }

    if (!resizingRef.current) {
      resizingRef.current = true;
      setIsResizing(true);
    }

    const baseLayout = pendingLayoutRef.current ?? layout;

    if (drag.type === "python-panel-1" || drag.type === "python-panel-2") {
      const delta = event.clientY - drag.startY;
      const nextHeights: [number, number, number] = [
        drag.startPythonPanelHeights[0],
        drag.startPythonPanelHeights[1],
        drag.startPythonPanelHeights[2],
      ];

      if (drag.type === "python-panel-1") {
        const pairHeight =
          drag.startPythonPanelHeights[0] + drag.startPythonPanelHeights[1];
        nextHeights[0] = clamp(
          drag.startPythonPanelHeights[0] + delta,
          PYTHON_PANEL_MIN_HEIGHT,
          pairHeight - PYTHON_PANEL_MIN_HEIGHT,
        );
        nextHeights[1] = pairHeight - nextHeights[0];
      } else {
        const pairHeight =
          drag.startPythonPanelHeights[1] + drag.startPythonPanelHeights[2];
        nextHeights[1] = clamp(
          drag.startPythonPanelHeights[1] + delta,
          PYTHON_PANEL_MIN_HEIGHT,
          pairHeight - PYTHON_PANEL_MIN_HEIGHT,
        );
        nextHeights[2] = pairHeight - nextHeights[1];
      }

      const nextTotal = nextHeights.reduce((total, value) => total + value, 0);
      const pythonPanelRatios =
        nextTotal <= 0
          ? DEFAULT_PYTHON_PANEL_RATIOS
          : (nextHeights.map((height) => height / nextTotal) as [
              number,
              number,
              number,
            ]);

      scheduleGridLayout({
        ...baseLayout,
        pythonPanelRatios,
      });
      return;
    }

    if (drag.type === "row") {
      const nextTopHeight = clamp(
        drag.startTopRowHeight + event.clientY - drag.startY,
        DASHBOARD_MIN_TOP_ROW,
        drag.maxTopRowHeight,
      );

      scheduleGridLayout({
        ...baseLayout,
        topRowHeight: nextTopHeight,
      });
      return;
    }

    const delta = event.clientX - drag.startX;
    const nextWidths: [number, number, number] = [
      drag.startColumnWidths[0],
      drag.startColumnWidths[1],
      drag.startColumnWidths[2],
    ];

    if (drag.type === "column-1") {
      const pairWidth = drag.startColumnWidths[0] + drag.startColumnWidths[1];
      nextWidths[0] = clamp(
        drag.startColumnWidths[0] + delta,
        DASHBOARD_MIN_COLUMN_WIDTH,
        pairWidth - DASHBOARD_MIN_COLUMN_WIDTH,
      );
      nextWidths[1] = pairWidth - nextWidths[0];
    } else {
      const pairWidth = drag.startColumnWidths[1] + drag.startColumnWidths[2];
      nextWidths[1] = clamp(
        drag.startColumnWidths[1] + delta,
        DASHBOARD_MIN_COLUMN_WIDTH,
        pairWidth - DASHBOARD_MIN_COLUMN_WIDTH,
      );
      nextWidths[2] = pairWidth - nextWidths[1];
    }

    const nextTotal = nextWidths.reduce((total, value) => total + value, 0);
    const normalizedWidths =
      nextTotal <= 0 || drag.availableWidth <= 0
        ? nextWidths
        : nextTotal === drag.availableWidth
          ? nextWidths
          : (nextWidths.map(
              (width) => (width / nextTotal) * drag.availableWidth,
            ) as [number, number, number]);

    scheduleGridLayout({
      ...baseLayout,
      columnWidths: normalizedWidths,
    });
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }

    const pendingLayout = pendingLayoutRef.current;
    if (pendingLayout) {
      applyGridLayout(pendingLayout);
      setLayout(pendingLayout);
      pendingLayoutRef.current = null;
    }

    dragRef.current = null;
    resizingRef.current = false;
    setIsResizing(false);
  };

  const gridStyle = {
    "--dashboard-column-template": dashboardColumnTemplate(
      layout.columnWidths,
      frontendEnabled,
      stackFrontendLogs,
    ),
    "--dashboard-row-template": dashboardRowTemplate(layout.topRowHeight),
    "--python-side-row-template": pythonSideRowTemplate(
      layout.pythonPanelRatios,
    ),
  } as CSSProperties;

  return (
    <section className="resizable-panel-screen">
      <div
        className={`dashboard-grid${frontendEnabled ? "" : " frontend-disabled"}${showTailLogPanel ? "" : " tail-disabled"}${showBuildPanels ? "" : " python-layout"}${stackFrontendLogs ? " python-stacked-logs" : ""}`}
        ref={gridRef}
        style={gridStyle}
      >
        {frontendEnabled ? (
          <LogPanel
            title="Frontend"
            projectId={projectId}
            channel="frontend"
            footer="Open full log"
            className="frontend-panel"
            serviceState={frontendStatus?.state}
            openDisabled={!frontendRunning}
            suspendAutoFollow={isResizing}
            onOpen={() =>
              void window.ivsDashboard.openLog(projectId, "frontend")
            }
            onZoom={() =>
              setZoomLog({
                title: "Frontend",
                channel: "frontend",
                footer: "Open full log",
                className: "frontend-panel log-zoom-panel",
                serviceState: frontendStatus?.state,
                openDisabled: !frontendRunning,
              })
            }
          />
        ) : null}
        {showBuildPanels ? (
          <BuildLogPanel
            projectId={projectId}
            suspendAutoFollow={isResizing}
            onZoom={() =>
              setZoomLog({
                title: "Build Log",
                channel: "build",
                footer: "Open build log",
                className: "build-log-panel log-zoom-panel",
                dense: true,
              })
            }
          />
        ) : null}
        {showBuildPanels ? (
          <BuildStatusPanel projectId={projectId} projectState={projectState} />
        ) : (
          <div className="python-side-column" ref={pythonSideColumnRef}>
            <PythonErrorsPanel lines={projectState.logs.python} />
            <div
              className="grid-splitter python-panel-splitter python-panel-splitter-one"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize Recent Errors and Runtime Status panels"
              onPointerDown={(event) => startResize("python-panel-1", event)}
              onPointerMove={resizeLayout}
              onPointerUp={stopResize}
              onPointerCancel={stopResize}
            />
            <PythonRuntimePanel
              status={backendStatus}
              settings={projectState.settings}
            />
            <div
              className="grid-splitter python-panel-splitter python-panel-splitter-two"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize Runtime Status and Dependencies panels"
              onPointerDown={(event) => startResize("python-panel-2", event)}
              onPointerMove={resizeLayout}
              onPointerUp={stopResize}
              onPointerCancel={stopResize}
            />
            <PythonDependenciesPanel
              dependencies={projectState.pythonDependencies}
            />
          </div>
        )}
        <LogPanel
          title={backendService === "python" ? "Server Log" : backendLabel}
          projectId={projectId}
          channel={backendService}
          footer="Open full log"
          className="wildfly-panel"
          dense
          colorize={false}
          serviceState={backendStatus?.state}
          openDisabled={!backendRunning}
          suspendAutoFollow={isResizing}
          onOpen={() =>
            void window.ivsDashboard.openLog(projectId, backendService)
          }
          onZoom={() =>
            setZoomLog({
              title: backendService === "python" ? "Server Log" : backendLabel,
              channel: backendService,
              footer: "Open full log",
              className: "wildfly-panel log-zoom-panel",
              serviceState: backendStatus?.state,
              openDisabled: !backendRunning,
              dense: true,
              colorize: false,
            })
          }
        />
        {showTailLogPanel ? (
          <TailLogPanel
            projectId={projectId}
            configured={tailLogConfigured}
            suspendAutoFollow={isResizing}
            onZoom={
              tailLogConfigured
                ? () =>
                    setZoomLog({
                      title: "Tail Log",
                      channel: "tail",
                      footer: "Open full log",
                      className: "tail-log-panel log-zoom-panel",
                      dense: true,
                    })
                : undefined
            }
          />
        ) : null}
        {frontendEnabled ? (
          <div
            className="grid-splitter column-splitter column-splitter-one"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Frontend and Tail Log columns"
            onPointerDown={(event) => startResize("column-1", event)}
            onPointerMove={resizeLayout}
            onPointerUp={stopResize}
            onPointerCancel={stopResize}
          />
        ) : null}
        <div
          className="grid-splitter column-splitter column-splitter-two"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Tail Log and Build panels columns"
          onPointerDown={(event) => startResize("column-2", event)}
          onPointerMove={resizeLayout}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
        />
        {showTailLogPanel ? (
          <div
            className="grid-splitter row-splitter"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize top and bottom dashboard rows"
            onPointerDown={(event) => startResize("row", event)}
            onPointerMove={resizeLayout}
            onPointerUp={stopResize}
            onPointerCancel={stopResize}
          />
        ) : null}
      </div>

      <Modal
        open={zoomLog !== null}
        title={zoomLog?.title ?? ""}
        subtitle={zoomLog !== null ? `Project: ${projectId}` : undefined}
        size="fullScreen"
        className="log-zoom-modal"
        contentClassName="log-zoom-modal-content"
        closeLabel="Close log view"
        onClose={() => setZoomLog(null)}
      >
        {zoomLog?.channel === "build" ? (
          <BuildLogPanel
            projectId={projectId}
            className="build-log-panel log-zoom-panel"
          />
        ) : zoomLog?.channel === "tail" ? (
          <TailLogPanel
            projectId={projectId}
            className="tail-log-panel log-zoom-panel"
            configured={tailLogConfigured}
          />
        ) : zoomLog ? (
          <LogPanel
            title={zoomLog.title}
            projectId={projectId}
            channel={zoomLog.channel}
            footer={zoomLog.footer}
            className={zoomLog.className}
            serviceState={zoomLog.serviceState}
            openDisabled={zoomLog.openDisabled}
            dense={zoomLog.dense}
            colorize={zoomLog.colorize}
            onOpen={() =>
              void window.ivsDashboard.openLog(projectId, zoomLog.channel)
            }
          />
        ) : null}
      </Modal>
    </section>
  );
}

function readStoredLayout(projectId: string): DashboardLayout {
  const fallback: DashboardLayout = {
    columnWidths: null,
    topRowHeight: null,
    pythonPanelRatios: null,
  };
  const stored = window.localStorage.getItem(
    `ivs-dashboard-layout-${projectId}`,
  );
  if (!stored) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(stored) as DashboardLayout;
    return {
      columnWidths: Array.isArray(parsed.columnWidths)
        ? parsed.columnWidths
        : null,
      topRowHeight:
        typeof parsed.topRowHeight === "number" ? parsed.topRowHeight : null,
      pythonPanelRatios:
        Array.isArray(parsed.pythonPanelRatios) &&
        parsed.pythonPanelRatios.length === 3 &&
        parsed.pythonPanelRatios.every(
          (ratio) => typeof ratio === "number" && ratio > 0,
        )
          ? parsed.pythonPanelRatios
          : null,
    };
  } catch {
    return fallback;
  }
}

function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (intervalMs === null) {
      setNow(Date.now());
      return undefined;
    }

    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

function buildElapsed(
  build: ProjectRuntimeState["recentBuilds"][number],
  now: number,
): string {
  if (build.status !== "Running") {
    return build.duration;
  }

  const startedAt = new Date(build.startedAt).getTime();
  if (Number.isNaN(startedAt)) {
    return "--:--";
  }

  return formatElapsed(Math.max(0, Math.floor((now - startedAt) / 1000)));
}

function buildStatusClass(status: string): string {
  if (status === "Idle") {
    return "idle";
  }

  if (status === "Success") {
    return "success";
  }
  if (status === "Running") {
    return "running";
  }
  if (status === "Stopped") {
    return "stopped";
  }
  return "failed";
}

function statusPill(state: string | undefined): JSX.Element {
  const normalized = (state ?? "unknown").toLowerCase();
  const statusClass = serviceStateClass(normalized);
  const text =
    normalized === "running"
      ? "Running"
      : normalized === "starting"
        ? "Starting"
        : normalized === "stopping"
          ? "Stopping"
          : normalized === "success"
            ? "Success"
            : normalized === "failed" || normalized === "error"
              ? "Failed"
              : normalized === "stopped"
                ? "Stopped"
                : "Unknown";

  return <span className={`status-pill ${statusClass}`}>{text}</span>;
}

function buildStatusPill(
  status: NonNullable<ProjectDashboardSummary["lastBuild"]>["status"],
): JSX.Element {
  return (
    <span className={`status-pill ${buildStatusClass(status)}`}>{status}</span>
  );
}

function serviceStateClass(state: string): string {
  if (state === "success") {
    return "success";
  }
  if (state === "running") {
    return "running";
  }
  if (state === "starting") {
    return "starting";
  }
  if (state === "stopping") {
    return "stopping";
  }
  if (state === "stopped") {
    return "stopped";
  }
  return state === "unknown" ? "idle" : "failed";
}

function formatServiceUptime(
  status: ProjectDashboardSummary["statuses"][number] | undefined,
  now: number,
): string {
  if (!status?.startedAt || status.state !== "running") {
    return status?.state === "starting" ? "Starting" : "Not running";
  }

  const startedAt = new Date(status.startedAt).getTime();
  if (Number.isNaN(startedAt)) {
    return "Not running";
  }

  const totalSeconds = Math.max(1, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildStagesFromLatest(
  status: string | undefined,
  build: ProjectRuntimeState["recentBuilds"][number] | undefined,
  buildLines: LogLine[],
  frontendEnabled: boolean,
): BuildStage[] {
  const stepDefinitions = [
    {
      label: "Build started",
      patterns: [/\$ .*(?:mvn|mvn\.cmd)/i, /build started/i],
    },
    {
      label: "Cleaning project",
      patterns: [/--- clean:/i, /\bclean(?:ing)?\b/i],
    },
    {
      label: "Backend compile",
      patterns: [/--- compiler:/i, /\bcompil(?:e|ing)\b/i],
    },
    {
      label: "Building frontend",
      patterns: [/frontend/i, /\bnpm\b/i, /\bvite\b/i],
    },
    {
      label: "Packaging WAR",
      patterns: [/--- war:/i, /building war:/i, /packag(?:e|ing).*war/i],
    },
    {
      label: "Installing artifact",
      patterns: [/--- install:/i, /installing .*artifact/i],
    },
    { label: "Deploying", patterns: [/deploy(?:ing|ed)?/i] },
    {
      label: "Build completed",
      patterns: [/build success/i, /build completed/i],
    },
  ].filter((step) => frontendEnabled || step.label !== "Building frontend");

  if (!status) {
    return stepDefinitions.map((step) => ({
      label: step.label,
      time: "--",
      state: "pending",
    }));
  }

  const matchedIndexes = new Set<number>();
  const lowerStatusFailed = status === "Failed" || status === "Stopped";
  const failedLineIndex = buildLines.findIndex((line) =>
    /build failure|error|failed|stop build requested|exited with code (?!0\b)/i.test(
      line.text,
    ),
  );

  for (let index = 0; index < buildLines.length; index += 1) {
    const text = buildLines[index].text;
    stepDefinitions.forEach((step, stepIndex) => {
      if (step.patterns.some((pattern) => pattern.test(text))) {
        matchedIndexes.add(stepIndex);
      }
    });
  }

  if (status === "Success") {
    matchedIndexes.add(stepDefinitions.length - 1);
  }

  const latestMatchedIndex =
    matchedIndexes.size === 0 ? -1 : Math.max(...matchedIndexes);

  return stepDefinitions.map((step, index) => {
    const matched = matchedIndexes.has(index);
    const isCurrent =
      status === "Running" &&
      index === Math.min(latestMatchedIndex + 1, stepDefinitions.length - 1);
    const isFailed =
      lowerStatusFailed &&
      failedLineIndex >= 0 &&
      index === Math.min(latestMatchedIndex + 1, stepDefinitions.length - 1);

    return {
      label: step.label,
      time: matched ? "" : "--",
      state: matched
        ? "complete"
        : isFailed
          ? "failed"
          : isCurrent
            ? "current"
            : "pending",
    };
  });
}
