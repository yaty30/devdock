import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { CheckCircle2, CircleDot, GitBranch, Minus } from "lucide-react";
import { ActionLink } from "../../components/common/ActionLink";
import { LogLines } from "../../components/common/LogLines";
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
import type { BuildStage, LogChannel, ProjectRuntimeState } from "../../types";
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
};

const DASHBOARD_MIN_COLUMN_WIDTH = 230;
const DASHBOARD_MIN_TOP_ROW = 320;
const DASHBOARD_MIN_BOTTOM_ROW = 220;
const DASHBOARD_SPLITTER_SIZE = 16;

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
      <label htmlFor={id}>Find</label>
      <input
        id={id}
        type="text"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />
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

function LogPanel({
  title,
  projectId,
  channel,
  footer,
  onOpen,
  className,
  dense = false,
}: {
  title: string;
  projectId: string;
  channel: LogChannel;
  footer: string;
  onOpen?: () => void;
  className?: string;
  dense?: boolean;
}): JSX.Element {
  const {
    viewport,
    handleLoadOlder,
    handleJumpToBottom,
    handleFollowingChange,
  } = useLogPanel(projectId, channel);
  const id = `find-${title.toLowerCase().replace(/\s+/g, "-")}`;
  const find = useLogFind(viewport.lines, id);

  return (
    <Panel
      title={title}
      titleMeta={<span className="status-pill success">Live</span>}
      action={<ActionLink onClick={onOpen}>{footer}</ActionLink>}
      className={className}
      findBar={find.findBar}
    >
      <LogLines
        lines={viewport.lines}
        dense={dense}
        highlight={find.term}
        activeMatchSeq={find.activeSeq}
        isLoadingOlder={viewport.isLoadingOlder}
        hasMoreOlder={viewport.hasMoreOlder}
        unseenCount={viewport.unseenNewLineCount}
        isFollowing={viewport.isFollowing}
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
  const elapsed = latestBuild
    ? buildElapsed(latestBuild, now)
    : "--:--";
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
          {latestBuild ? (
            <span className={`status-pill ${buildStatusClass(latestBuild.status)}`}>
              {latestBuild.status}
            </span>
          ) : null}
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
          <strong>{projectState.gitStatus.commit}</strong>
        </div>
      </div>
      <div className="timeline">
        {stages.map((stage) => (
          <div
            className={`timeline-item ${stage.state}`}
            key={stage.label}
          >
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

function BuildLogPanel({ projectId }: { projectId: string }): JSX.Element {
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

  return (
    <Panel
      title="Build Log"
      action={
        <ActionLink
          onClick={() => void window.ivsDashboard.openLog(projectId, "build")}
        >
          Open build log
        </ActionLink>
      }
      className="build-log-panel"
      findBar={find.findBar}
    >
      <LogLines
        lines={viewport.lines}
        dense
        highlight={find.term}
        activeMatchSeq={find.activeSeq}
        isLoadingOlder={viewport.isLoadingOlder}
        hasMoreOlder={viewport.hasMoreOlder}
        unseenCount={viewport.unseenNewLineCount}
        isFollowing={viewport.isFollowing}
        onLoadOlder={handleLoadOlder}
        onJumpToBottom={handleJumpToBottom}
        onFollowingChange={handleFollowingChange}
      />
    </Panel>
  );
}

function TailLogPanel({ projectId }: { projectId: string }): JSX.Element {
  const {
    viewport,
    handleLoadOlder,
    handleJumpToBottom,
    handleFollowingChange,
  } = useLogPanel(projectId, "tail");
  const find = useLogFind(viewport.lines, "find-tail-log");

  return (
    <Panel
      title="Tail Log"
      titleMeta={<span className="status-pill success">Live</span>}
      action={
        <ActionLink
          onClick={() => void window.ivsDashboard.openLog(projectId, "tail")}
        >
          Open full log
        </ActionLink>
      }
      className="tail-log-panel"
      findBar={find.findBar}
    >
      <LogLines
        lines={viewport.lines}
        dense
        highlight={find.term}
        activeMatchSeq={find.activeSeq}
        isLoadingOlder={viewport.isLoadingOlder}
        hasMoreOlder={viewport.hasMoreOlder}
        unseenCount={viewport.unseenNewLineCount}
        isFollowing={viewport.isFollowing}
        onLoadOlder={handleLoadOlder}
        onJumpToBottom={handleJumpToBottom}
        onFollowingChange={handleFollowingChange}
      />
    </Panel>
  );
}

export function DashboardContent({
  projectId,
  resetVersion,
  projectState,
}: {
  projectId: string;
  resetVersion: number;
  projectState: ProjectRuntimeState;
}): JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [layout, setLayout] = useState<DashboardLayout>(() =>
    readStoredLayout(projectId),
  );

  useEffect(() => {
    setLayout(readStoredLayout(projectId));
  }, [resetVersion, projectId]);

  useEffect(() => {
    window.localStorage.setItem(
      `ivs-dashboard-layout-${projectId}`,
      JSON.stringify(layout),
    );
  }, [layout, projectId]);

  const startResize = (
    type: DragState["type"],
    event: PointerEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

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
    };
  };

  const resizeLayout = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const grid = gridRef.current;

    if (!drag || !grid) {
      return;
    }

    if (drag.type === "row") {
      const gridStyles = window.getComputedStyle(grid);
      const gridPaddingTop = parseFloat(gridStyles.paddingTop) || 0;
      const gridPaddingBottom = parseFloat(gridStyles.paddingBottom) || 0;
      const availableHeight =
        grid.clientHeight -
        gridPaddingTop -
        gridPaddingBottom -
        DASHBOARD_SPLITTER_SIZE;
      const maxTopHeight = Math.max(
        DASHBOARD_MIN_TOP_ROW,
        availableHeight - DASHBOARD_MIN_BOTTOM_ROW,
      );
      const nextTopHeight = clamp(
        drag.startTopRowHeight + event.clientY - drag.startY,
        DASHBOARD_MIN_TOP_ROW,
        maxTopHeight,
      );

      setLayout((current) => ({
        ...current,
        topRowHeight: nextTopHeight,
      }));
      return;
    }

    const gridStyles = window.getComputedStyle(grid);
    const gridPaddingLeft = parseFloat(gridStyles.paddingLeft) || 0;
    const gridPaddingRight = parseFloat(gridStyles.paddingRight) || 0;
    const availableWidth =
      grid.clientWidth -
      gridPaddingLeft -
      gridPaddingRight -
      DASHBOARD_SPLITTER_SIZE * 2;
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
      nextTotal === availableWidth
        ? nextWidths
        : (nextWidths.map((width) => (width / nextTotal) * availableWidth) as [
            number,
            number,
            number,
          ]);

    setLayout((current) => ({
      ...current,
      columnWidths: normalizedWidths,
    }));
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragRef.current = null;
  };

  const gridStyle = {
    "--dashboard-column-template":
      layout.columnWidths === null
        ? `minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, 1fr) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, 1.12fr) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, 0.96fr)`
        : `minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, ${layout.columnWidths[0]}px) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, ${layout.columnWidths[1]}px) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_COLUMN_WIDTH}px, ${layout.columnWidths[2]}px)`,
    "--dashboard-row-template":
      layout.topRowHeight === null
        ? `minmax(${DASHBOARD_MIN_TOP_ROW}px, 1fr) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_BOTTOM_ROW}px, 1fr)`
        : `minmax(${DASHBOARD_MIN_TOP_ROW}px, ${layout.topRowHeight}px) ${DASHBOARD_SPLITTER_SIZE}px minmax(${DASHBOARD_MIN_BOTTOM_ROW}px, 1fr)`,
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
          onOpen={() => void window.ivsDashboard.openLog(projectId, "frontend")}
        />
        <BuildLogPanel projectId={projectId} />
        <BuildStatusPanel projectId={projectId} projectState={projectState} />
        <LogPanel
          title="WildFly"
          projectId={projectId}
          channel="wildfly"
          footer="Open full log"
          className="wildfly-panel"
          dense
          onOpen={() => void window.ivsDashboard.openLog(projectId, "wildfly")}
        />
        <TailLogPanel projectId={projectId} />
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
  if (status === "Success") {
    return "success";
  }
  if (status === "Running") {
    return "running";
  }
  return "failed";
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
    { label: "Cleaning project", patterns: [/--- clean:/i, /\bclean(?:ing)?\b/i] },
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
