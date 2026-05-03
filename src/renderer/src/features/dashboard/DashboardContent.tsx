import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  Activity,
  CheckCircle2,
  CircleDot,
  Clock3,
  ExternalLink,
  FolderKanban,
  GitBranch,
  Layers3,
  Minus,
  Search,
  SquareTerminal,
} from "lucide-react";
import { ActionLink } from "../../components/common/ActionLink";
import { VirtualizedLogViewer } from "../../components/common/VirtualizedLogViewer";
import { Panel } from "../../components/common/Panel";
import {
  clearUnseen,
  INITIAL_LIVE_LINES,
  initViewport,
  LOAD_OLDER_CHUNK,
  prependHistorical,
  setFollowing,
  setLoadingOlder,
  useLogViewport,
} from "../../hooks/useLogStore";
import type { LogLine } from "../../../../shared/dashboardTypes";
import type {
  BuildStage,
  LogChannel,
  ProjectDashboardSummary,
  ProjectRuntimeState,
  ServiceName,
} from "../../types";
import { clamp } from "../../utils/math";

type DashboardLayout = {
  columnWidths: [number, number, number] | null;
  topRowHeight: number | null;
};

type DragState = {
  type: "column-1" | "column-2" | "row";
  startX: number;
  startY: number;
  startColumnWidths: [number, number, number];
  startTopRowHeight: number;
  availableWidth: number;
  maxTopRowHeight: number;
};

const DASHBOARD_MIN_COLUMN_WIDTH = 230;
const DASHBOARD_MIN_TOP_ROW = 320;
const DASHBOARD_MIN_BOTTOM_ROW = 220;
const DASHBOARD_SPLITTER_SIZE = 16;

function dashboardColumnTemplate(
  columnWidths: DashboardLayout["columnWidths"],
): string {
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

type LogFindState = {
  term: string;
  matchSeqs: number[];
  activeSeq: number | null;
  current: number;
  total: number;
  findBar: JSX.Element;
};

function useLogFind(lines: LogLine[], id: string): LogFindState {
  const [term, setTerm] = useState("");
  const [activePosition, setActivePosition] = useState(0);
  const matchSeqs = useMemo(() => {
    const query = term.trim().toLowerCase();
    if (!query) {
      return [];
    }
    return lines.reduce<number[]>((matches, line) => {
      if (line.text.toLowerCase().includes(query)) {
        matches.push(line.seq);
      }
      return matches;
    }, []);
  }, [lines, term]);
  const total = matchSeqs.length;
  const safePosition = total === 0 ? 0 : Math.min(activePosition, total - 1);
  const activeSeq = total === 0 ? null : matchSeqs[safePosition];

  useEffect(() => {
    setActivePosition(0);
  }, [term]);

  function move(delta: number): void {
    if (total === 0) {
      return;
    }

    setActivePosition((current) => (current + delta + total) % total);
  }

  const findBar = (
    <div className="log-find-row">
      <div className="find-input-shell">
        <Search size={14} />
        <input
          id={id}
          type="text"
          value={term}
          aria-label="Find"
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>
      <span className="log-find-count">
        {total === 0 ? "0/0" : `${safePosition + 1}/${total}`}
      </span>
      <button type="button" disabled={total === 0} onClick={() => move(-1)}>
        Prev
      </button>
      <button type="button" disabled={total === 0} onClick={() => move(1)}>
        Next
      </button>
      <button
        type="button"
        onClick={() => {
          setTerm("");
          setActivePosition(0);
        }}
      >
        Clear
      </button>
    </div>
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
}): JSX.Element {
  const {
    viewport,
    handleLoadOlder,
    handleJumpToBottom,
    handleFollowingChange,
  } = useLogPanel(projectId, channel);
  const id = `find-${title.toLowerCase().replace(/\s+/g, "-")}`;
  const find = useLogFind(viewport.lines, id);
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
  const buildLines = useLogViewport(projectId, "build").lines;
  const stages = buildStagesFromLatest(
    latestBuild?.status,
    latestBuild,
    buildLines,
  );

  return (
    <Panel
      title="Build Status"
      titleMeta={
        <div className="build-status-title-meta">
          <span className={`status-pill ${buildStatusClass(buildStatusLabel)}`}>
            {buildStatusLabel}
          </span>
          <span className="elapsed-pill">{elapsed}</span>
        </div>
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
          <strong>{projectState.gitStatus.branch}</strong>
        </div>
        <div className="branch-row">
          <span>Commit</span>
          <strong>@{projectState.gitStatus.commit}</strong>
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
      <div className="panel-footer">
        <ActionLink
          onClick={() => {
            const pomPath = projectState.settings.maven.pomXml;
            const targetPath = pomPath.replace(/[\\/][^\\/]+$/, "\\target");
            void window.ivsDashboard.openPath(targetPath);
          }}
        >
          Open WAR folder
        </ActionLink>
      </div>
    </Panel>
  );
}

function BuildLogPanel({
  projectId,
  suspendAutoFollow = false,
}: {
  projectId: string;
  suspendAutoFollow?: boolean;
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
  const find = useLogFind(viewport.lines, "find-build-log");
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
        </div>
      }
      className="build-log-panel"
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
  suspendAutoFollow = false,
}: {
  projectId: string;
  suspendAutoFollow?: boolean;
}): JSX.Element {
  const {
    viewport,
    handleLoadOlder,
    handleJumpToBottom,
    handleFollowingChange,
  } = useLogPanel(projectId, "tail");
  const find = useLogFind(viewport.lines, "find-tail-log");
  const [colorizeActive, toggleColorize] = useColorizeState(
    projectId,
    "tail",
    true,
  );

  return (
    <Panel
      title="Tail Log"
      titleMeta={<span className="status-pill success">Live</span>}
      action={
        <div className="log-panel-actions">
          <ColorizeToggle active={colorizeActive} onClick={toggleColorize} />
          <ActionLink
            onClick={() => void window.ivsDashboard.openLog(projectId, "tail")}
          >
            Open full log
          </ActionLink>
        </div>
      }
      className="tail-log-panel"
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

export function DashboardContent({
  projects,
  loading,
}: {
  projects: ProjectDashboardSummary[];
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
          icon={<Clock3 size={22} />}
          label="Last Updated"
          value={lastUpdated ? formatTime(lastUpdated) : "--"}
          tone="time"
        />
      </div>

      <div className="dashboard-project-list">
        {projects.length > 0 ? (
          projects.map((summary) => (
            <ProjectStatusRow
              key={summary.project.id}
              summary={summary}
              now={now}
            />
          ))
        ) : (
          <div className="dashboard-empty">No projects configured.</div>
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
  tone: "project" | "service" | "time";
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

function ProjectStatusRow({
  summary,
  now,
}: {
  summary: ProjectDashboardSummary;
  now: number;
}): JSX.Element {
  const frontend = serviceStatus(summary, "frontend");
  const wildfly = serviceStatus(summary, "wildfly");
  const overallStatus = projectOverallStatus(summary);
  const lastBuild = summary.lastBuild;

  return (
    <article className="dashboard-project-card">
      <header className="dashboard-project-card-header">
        <div className="dashboard-project-title-group">
          <span className="dashboard-project-code">{summary.project.code}</span>
          <div>
            <h2>{summary.project.name}</h2>
            <div className="dashboard-project-meta">
              <span>Project ID</span>
              <strong>{summary.project.id}</strong>
              <i />
              <span>Services</span>
              <strong>Frontend / WildFly</strong>
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
          <div className="dashboard-status-group">
            <span>Last Build Status</span>
            {lastBuild ? (
              buildStatusPill(lastBuild.status)
            ) : (
              <strong className="dashboard-status-value idle">No builds</strong>
            )}
          </div>
        </div>
      </header>

      <div className="dashboard-project-detail-grid">
        <section className="dashboard-project-detail">
          <header>
            <SquareTerminal size={18} />
            <h3>Frontend</h3>
            {statusPill(frontend?.state)}
          </header>
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
        </section>

        <section className="dashboard-project-detail">
          <header>
            <Layers3 size={18} />
            <h3>WildFly</h3>
            {statusPill(wildfly?.state)}
          </header>
          <DashboardDetailRow label="Console">
            {summary.serviceUrls.wildflyConsoleUrl ? (
              <a
                className="monitor-link"
                href={summary.serviceUrls.wildflyConsoleUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span>{summary.serviceUrls.wildflyConsoleUrl}</span>
                <ExternalLink size={13} />
              </a>
            ) : (
              <strong>Not set</strong>
            )}
          </DashboardDetailRow>
          <DashboardDetailRow label="KMU">
            {summary.serviceUrls.wildflyKmuUrl ? (
              <a
                className="monitor-link"
                href={summary.serviceUrls.wildflyKmuUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span>{summary.serviceUrls.wildflyKmuUrl}</span>
                <ExternalLink size={13} />
              </a>
            ) : (
              <strong>Not set</strong>
            )}
          </DashboardDetailRow>
        </section>

        <section className="dashboard-project-detail">
          <header>
            <Clock3 size={18} />
            <h3>Uptime</h3>
          </header>
          <DashboardDetailRow label="Frontend">
            <strong>{formatServiceUptime(frontend, now)}</strong>
          </DashboardDetailRow>
          <DashboardDetailRow label="WildFly">
            <strong>{formatServiceUptime(wildfly, now)}</strong>
          </DashboardDetailRow>
        </section>

        <section className="dashboard-project-detail">
          <header>
            <Clock3 size={18} />
            <h3>Last Build</h3>
            {lastBuild ? (
              buildStatusPill(lastBuild.status)
            ) : (
              <strong className="dashboard-status-value idle">No builds</strong>
            )}
          </header>
          <DashboardDetailRow label="Duration">
            <strong>{lastBuild?.duration ?? "--"}</strong>
          </DashboardDetailRow>
          <DashboardDetailRow label="Completed">
            <strong>{lastBuild?.completed ?? "No builds recorded"}</strong>
          </DashboardDetailRow>
        </section>
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

function projectOverallStatus(summary: ProjectDashboardSummary): {
  label: string;
  tone: "success" | "warning" | "failed" | "idle";
} {
  const frontend = serviceStatus(summary, "frontend");
  const wildfly = serviceStatus(summary, "wildfly");
  const states = [frontend?.state, wildfly?.state];

  if (states.every((state) => state === "running")) {
    return { label: "All Services Running", tone: "success" };
  }
  if (states.some((state) => state === "error")) {
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

export function ProjectDashboardContent({
  projectId,
  resetVersion,
  projectState,
}: {
  projectId: string;
  resetVersion: number;
  projectState: ProjectRuntimeState;
}): JSX.Element {
  const frontendStatus = serviceStatus(projectState, "frontend");
  const wildflyStatus = serviceStatus(projectState, "wildfly");
  const frontendRunning = frontendStatus?.state === "running";
  const wildflyRunning = wildflyStatus?.state === "running";
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingLayoutRef = useRef<DashboardLayout | null>(null);
  const resizingRef = useRef(false);
  const prevAvailableWidthRef = useRef<number | null>(null);
  const [layout, setLayout] = useState<DashboardLayout>(() =>
    readStoredLayout(projectId),
  );
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
      const newAvailableWidth = newContentWidth - DASHBOARD_SPLITTER_SIZE * 2;
      const prev = prevAvailableWidthRef.current;
      prevAvailableWidthRef.current = newAvailableWidth;
      if (prev === null || prev === newAvailableWidth) return;
      const current = layoutRef.current;
      if (current.columnWidths === null) return;
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyGridLayout(nextLayout: DashboardLayout): void {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    grid.style.setProperty(
      "--dashboard-column-template",
      dashboardColumnTemplate(nextLayout.columnWidths),
    );
    grid.style.setProperty(
      "--dashboard-row-template",
      dashboardRowTemplate(nextLayout.topRowHeight),
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
        DASHBOARD_SPLITTER_SIZE * 2
      : 0;
    const availableHeight = grid
      ? grid.clientHeight -
        gridPaddingTop -
        gridPaddingBottom -
        DASHBOARD_SPLITTER_SIZE
      : 0;
    const topRowPanel =
      gridRef.current?.querySelector<HTMLElement>(".frontend-panel");
    const columnPanels = [
      gridRef.current?.querySelector<HTMLElement>(".frontend-panel"),
      gridRef.current?.querySelector<HTMLElement>(".tail-log-panel"),
      gridRef.current?.querySelector<HTMLElement>(".build-status-panel"),
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
    "--dashboard-column-template": dashboardColumnTemplate(layout.columnWidths),
    "--dashboard-row-template": dashboardRowTemplate(layout.topRowHeight),
  } as CSSProperties;

  return (
    <section className="resizable-panel-screen">
      <div className="dashboard-grid" ref={gridRef} style={gridStyle}>
        <LogPanel
          title="Frontend"
          projectId={projectId}
          channel="frontend"
          footer="Open full log"
          className="frontend-panel"
          serviceState={frontendStatus?.state}
          openDisabled={!frontendRunning}
          suspendAutoFollow={isResizing}
          onOpen={() => void window.ivsDashboard.openLog(projectId, "frontend")}
        />
        <BuildLogPanel projectId={projectId} suspendAutoFollow={isResizing} />
        <BuildStatusPanel projectId={projectId} projectState={projectState} />
        <LogPanel
          title="WildFly"
          projectId={projectId}
          channel="wildfly"
          footer="Open full log"
          className="wildfly-panel"
          dense
          colorize={false}
          serviceState={wildflyStatus?.state}
          openDisabled={!wildflyRunning}
          suspendAutoFollow={isResizing}
          onOpen={() => void window.ivsDashboard.openLog(projectId, "wildfly")}
        />
        <TailLogPanel projectId={projectId} suspendAutoFollow={isResizing} />
        <div
          className="grid-splitter column-splitter column-splitter-one"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Frontend and Build Log columns"
          onPointerDown={(event) => startResize("column-1", event)}
          onPointerMove={resizeLayout}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
        />
        <div
          className="grid-splitter column-splitter column-splitter-two"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Build Log and Build Status columns"
          onPointerDown={(event) => startResize("column-2", event)}
          onPointerMove={resizeLayout}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
        />
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
      </div>
    </section>
  );
}

function readStoredLayout(projectId: string): DashboardLayout {
  const fallback: DashboardLayout = { columnWidths: null, topRowHeight: null };
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
  if (state === "running" || state === "success") {
    return "success";
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
  ];

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
