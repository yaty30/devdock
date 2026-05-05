import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  ArrowDownAZ,
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  GitBranch,
  Clock3,
  Layers3,
  Package,
  RotateCcw,
  SquareTerminal,
} from "lucide-react";
import { FindControls } from "../../components/common/FindControls";
import { Panel } from "../../components/common/Panel";
import type {
  ActivityRecord,
  BuildQuerySortKey,
  MonitorCard,
  ProjectRuntimeState,
  RecentBuildRecord,
  ServiceState,
} from "../../types";
import { clamp } from "../../utils/math";

type MonitorLayout = {
  columnWidths: [number, number, number, number] | null;
};

type MonitorDragState = {
  type: "column-1" | "column-2" | "column-3";
  startX: number;
  startY: number;
  startColumnWidths: [number, number, number, number];
  availableWidth: number;
};

const MONITOR_MIN_COLUMN_WIDTH = 190;
const MONITOR_MIN_TOP_ROW = 198;
const MONITOR_MIN_BOTTOM_ROW = 240;
const MONITOR_SPLITTER_SIZE = 16;

function monitorColumnTemplate(
  columnWidths: MonitorLayout["columnWidths"],
): string {
  return columnWidths === null
    ? `minmax(${MONITOR_MIN_COLUMN_WIDTH}px, 1fr) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_COLUMN_WIDTH}px, 1fr) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_COLUMN_WIDTH}px, 1fr) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_COLUMN_WIDTH}px, 1fr)`
    : `minmax(${MONITOR_MIN_COLUMN_WIDTH}px, ${columnWidths[0]}px) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_COLUMN_WIDTH}px, ${columnWidths[1]}px) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_COLUMN_WIDTH}px, ${columnWidths[2]}px) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_COLUMN_WIDTH}px, ${columnWidths[3]}px)`;
}

function monitorRowTemplate(): string {
  return `minmax(${MONITOR_MIN_TOP_ROW}px, auto) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_BOTTOM_ROW}px, 1fr)`;
}

function MonitorCardView({
  card,
  className = "",
}: {
  card: MonitorCard;
  className?: string;
}): JSX.Element {
  const headerStatus = card.rows.find((row) => row.label === "Status");
  const visibleRows = card.rows.filter((row) => row.label !== "Status");

  return (
    <article className={`monitor-card ${className}`}>
      <div className="monitor-card-header">
        <div className="monitor-icon">{card.icon}</div>
        <h2>{card.title}</h2>
        {headerStatus ? (
          <div className="monitor-card-status">{headerStatus.value}</div>
        ) : null}
      </div>
      <div className="monitor-card-rows">
        {visibleRows.map((row) => (
          <div className="monitor-row" key={row.label}>
            <span>{row.label}</span>
            {typeof row.value === "string" &&
            (row.value.startsWith("http://") ||
              row.value.startsWith("https://")) ? (
              <a
                className="monitor-link"
                href={row.value}
                target="_blank"
                rel="noreferrer"
              >
                <span>{row.value}</span>
                <ExternalLink size={13} />
              </a>
            ) : (
              <strong>{row.value}</strong>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

type BuildStatusFilter = "All" | RecentBuildRecord["status"];

const STATUS_OPTIONS: Array<{
  value: BuildStatusFilter;
  label: string;
  dotColor: string | null;
}> = [
  { value: "All", label: "All statuses", dotColor: null },
  { value: "Running", label: "Running", dotColor: "var(--accent)" },
  { value: "Success", label: "Success", dotColor: "#22c55e" },
  { value: "Failed", label: "Failed", dotColor: "#ef4444" },
  { value: "Stopped", label: "Stopped", dotColor: "#f59e0b" },
];

function StatusSelect({
  value,
  onChange,
}: {
  value: BuildStatusFilter;
  onChange: (value: BuildStatusFilter) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const current =
    STATUS_OPTIONS.find((o) => o.value === value) ?? STATUS_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div className="custom-select" ref={containerRef}>
      <button
        className="custom-select-trigger"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current.dotColor && (
          <span
            className="custom-select-dot"
            style={{ background: current.dotColor }}
          />
        )}
        <span className="custom-select-value">{current.label}</span>
        <ChevronDown
          size={13}
          className={`custom-select-chevron${open ? " open" : ""}`}
        />
      </button>
      {open && (
        <ul className="custom-select-dropdown" role="listbox">
          {STATUS_OPTIONS.map((option) => (
            <li
              key={option.value}
              className={`custom-select-option${
                value === option.value ? " selected" : ""
              }`}
              role="option"
              aria-selected={value === option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span
                className="custom-select-dot"
                style={
                  option.dotColor
                    ? { background: option.dotColor }
                    : {
                        background: "transparent",
                        border: "1.5px solid var(--muted)",
                      }
                }
              />
              <span className="custom-select-option-label">{option.label}</span>
              {value === option.value && (
                <Check size={13} className="custom-select-check" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const RECENT_BUILDS_PAGE_SIZE = 30;

function RecentBuildsPanel({
  projectId,
  recentBuilds,
}: {
  projectId: string;
  recentBuilds: RecentBuildRecord[];
}): JSX.Element {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<BuildStatusFilter>("All");
  const [sortBy, setSortBy] = useState<BuildQuerySortKey>("completed");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [builds, setBuilds] = useState<RecentBuildRecord[]>([]);
  const [totalBuilds, setTotalBuilds] = useState(0);
  const [hasMoreBuilds, setHasMoreBuilds] = useState(false);
  const [loadingBuilds, setLoadingBuilds] = useState(false);
  const [activeBuildIndex, setActiveBuildIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const activeBuildRowRef = useRef<HTMLTableRowElement>(null);
  const requestSeqRef = useRef(0);
  const latestBuildKey = recentBuilds
    .map((build) => `${build.id}:${build.status}:${build.completedAt ?? ""}`)
    .join("|");

  const fetchBuildPage = useCallback(
    async (offset: number): Promise<void> => {
      const requestSeq = ++requestSeqRef.current;
      setLoadingBuilds(true);
      try {
        const result = await window.ivsDashboard.getBuilds(projectId, {
          search: searchTerm,
          status: statusFilter,
          sortBy,
          sortDirection,
          offset,
          limit: RECENT_BUILDS_PAGE_SIZE,
        });
        if (requestSeq !== requestSeqRef.current) {
          return;
        }
        setBuilds((current) =>
          offset === 0 ? result.builds : [...current, ...result.builds],
        );
        setTotalBuilds(result.total);
        setHasMoreBuilds(result.hasMore);
      } catch (error) {
        console.error(error);
      } finally {
        if (requestSeq === requestSeqRef.current) {
          setLoadingBuilds(false);
        }
      }
    },
    [projectId, searchTerm, sortBy, sortDirection, statusFilter],
  );

  useEffect(() => {
    setBuilds([]);
    setTotalBuilds(0);
    setHasMoreBuilds(false);
    setActiveBuildIndex(0);
    scrollRef.current?.scrollTo({ top: 0 });
    void fetchBuildPage(0);
  }, [fetchBuildPage, latestBuildKey]);

  useEffect(() => {
    setActiveBuildIndex(0);
  }, [projectId, searchTerm, sortBy, sortDirection, statusFilter]);

  useEffect(() => {
    const matchLimit = Math.min(totalBuilds, builds.length);
    if (activeBuildIndex >= matchLimit) {
      setActiveBuildIndex(matchLimit > 0 ? matchLimit - 1 : 0);
    }
  }, [activeBuildIndex, builds.length, totalBuilds]);

  useEffect(() => {
    activeBuildRowRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeBuildIndex, builds]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreBuilds && !loadingBuilds) {
          void fetchBuildPage(builds.length);
        }
      },
      { root, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [builds.length, fetchBuildPage, hasMoreBuilds, loadingBuilds]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        findInputRef.current?.focus();
        findInputRef.current?.select();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleSort(column: BuildQuerySortKey): void {
    if (sortBy === column) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortBy(column);
    setSortDirection(column === "completed" ? "desc" : "asc");
  }

  function renderSortLabel(
    column: BuildQuerySortKey,
    label: string,
  ): JSX.Element {
    const isActive = sortBy === column;

    return (
      <button
        className={`table-sort-button${isActive ? " active" : ""}`}
        type="button"
        onClick={() => handleSort(column)}
      >
        <span>{label}</span>
        {isActive ? (
          <span className="table-sort-direction">
            {sortDirection === "asc" ? "Asc" : "Desc"}
          </span>
        ) : null}
        {isActive ? <ArrowDownAZ size={14} /> : <ArrowUpDown size={14} />}
      </button>
    );
  }

  function handleReset(): void {
    setSearchTerm("");
    setActiveBuildIndex(0);
    setStatusFilter("All");
    setSortBy("completed");
    setSortDirection("desc");
  }

  function navigateBuildFind(delta: -1 | 1): void {
    const matchLimit = Math.min(totalBuilds, builds.length);
    if (matchLimit === 0) {
      return;
    }

    setActiveBuildIndex(
      (current) => (current + delta + matchLimit) % matchLimit,
    );
  }

  const isFiltered =
    searchTerm !== "" ||
    statusFilter !== "All" ||
    sortBy !== "completed" ||
    sortDirection !== "desc";
  const findMatchCount = searchTerm.trim() ? totalBuilds : 0;
  const activeBuildId =
    findMatchCount > 0
      ? builds[Math.min(activeBuildIndex, builds.length - 1)]?.id
      : undefined;

  return (
    <Panel
      title="Recent Builds"
      className="recent-builds-panel"
      findBar={
        <div className="log-find-row">
          <FindControls
            id="recent-builds-search"
            value={searchTerm}
            activeIndex={activeBuildIndex}
            matchCount={findMatchCount}
            inputRef={findInputRef}
            onChange={setSearchTerm}
            onPrevious={() => navigateBuildFind(-1)}
            onNext={() => navigateBuildFind(1)}
            onClear={() => {
              setSearchTerm("");
              setActiveBuildIndex(0);
            }}
          />
          <StatusSelect value={statusFilter} onChange={setStatusFilter} />
          <button
            className="table-reset-button"
            type="button"
            onClick={handleReset}
            title="Reset filters and sorting"
            disabled={!isFiltered}
          >
            <RotateCcw size={14} />
            <span>Reset</span>
          </button>
        </div>
      }
    >
      <div className="recent-builds-table-scroll" ref={scrollRef}>
        <table className="recent-builds-table">
          <thead>
            <tr>
              <th>{renderSortLabel("id", "Build ID")}</th>
              <th>{renderSortLabel("branch", "Branch")}</th>
              <th>{renderSortLabel("commit", "Commit")}</th>
              <th>{renderSortLabel("profile", "Profile")}</th>
              <th>{renderSortLabel("status", "Status")}</th>
              <th>{renderSortLabel("duration", "Duration")}</th>
              <th>{renderSortLabel("completed", "Completed")}</th>
            </tr>
          </thead>
          <tbody>
            {builds.map((build) => (
              <tr
                key={build.id}
                className={
                  build.id === activeBuildId
                    ? "recent-build-row-active"
                    : undefined
                }
                ref={build.id === activeBuildId ? activeBuildRowRef : undefined}
              >
                <td>{build.id}</td>
                <td>{build.branch}</td>
                <td>{`@${build.commit}/${build.commitCleanliness}`}</td>
                <td>{build.profile}</td>
                <td>
                  <span
                    className={`status-pill ${buildStatusClass(build.status)}`}
                  >
                    {build.status}
                  </span>
                </td>
                <td>{build.duration}</td>
                <td>{build.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div
          ref={sentinelRef}
          className="recent-builds-sentinel"
          aria-hidden="true"
        />
        {builds.length === 0 && !loadingBuilds ? (
          <p className="recent-builds-empty">No builds match the filters.</p>
        ) : null}
      </div>
      <div className="table-footer">
        <span>
          {loadingBuilds && builds.length === 0
            ? "Loading builds"
            : `Showing ${builds.length} of ${totalBuilds} builds`}
        </span>
        {loadingBuilds && builds.length > 0 ? (
          <span>Loading more...</span>
        ) : null}
      </div>
    </Panel>
  );
}
const ACTIVITY_PAGE_SIZE = 20;

type ActivityFeedRow =
  | { type: "divider"; key: string; label: string }
  | { type: "item"; item: ActivityRecord };

function ActivityFeedPanel({
  activityFeed,
}: {
  activityFeed: ActivityRecord[];
}): JSX.Element {
  const [visibleCount, setVisibleCount] = useState(ACTIVITY_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // reset when the feed itself changes (project switch or fresh data)
  useEffect(() => {
    setVisibleCount(ACTIVITY_PAGE_SIZE);
  }, [activityFeed]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) =>
            Math.min(prev + ACTIVITY_PAGE_SIZE, activityFeed.length),
          );
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activityFeed.length]);

  const visibleItems = activityFeed.slice(0, visibleCount);
  const rows = groupActivityFeedByDate(visibleItems);
  const hasMore = visibleCount < activityFeed.length;

  return (
    <Panel title="Activity Feed" className="activity-feed-panel">
      <div className="activity-list">
        {rows.map((row) =>
          row.type === "divider" ? (
            <div className="activity-date-divider" key={row.key}>
              <span>{row.label}</span>
            </div>
          ) : (
            <div className="activity-item" key={row.item.id}>
              <span className={`activity-dot ${row.item.tone}`} />
              <div className="activity-icon">{activityIcon(row.item.kind)}</div>
              <div className="activity-copy">
                <strong>{row.item.title}</strong>
                <span>{row.item.meta}</span>
              </div>
              <time>{row.item.time}</time>
            </div>
          ),
        )}
        {hasMore && (
          <div
            ref={sentinelRef}
            className="activity-scroll-sentinel"
            aria-hidden="true"
          />
        )}
        {!hasMore && activityFeed.length === 0 && (
          <p className="activity-empty">No activity in the last 7 days.</p>
        )}
      </div>
    </Panel>
  );
}

function groupActivityFeedByDate(items: ActivityRecord[]): ActivityFeedRow[] {
  const rows: ActivityFeedRow[] = [];
  let previousKey: string | null = null;

  for (const item of items) {
    const key = activityDateKey(item.createdAt);
    if (key !== previousKey) {
      rows.push({
        type: "divider",
        key: `divider-${key}`,
        label: formatActivityDate(item.createdAt),
      });
      previousKey = key;
    }
    rows.push({ type: "item", item });
  }

  return rows;
}

function activityDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatActivityDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (activityDateKey(value) === activityDateKey(today.toISOString())) {
    return "Today";
  }

  if (activityDateKey(value) === activityDateKey(yesterday.toISOString())) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function MonitorTab({
  resetVersion,
  projectState,
  projectId,
}: {
  resetVersion: number;
  projectState: ProjectRuntimeState;
  projectId: string;
}): JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<MonitorDragState | null>(null);
  const pendingLayoutRef = useRef<MonitorLayout | null>(null);
  const resizingRef = useRef(false);
  const prevAvailableWidthRef = useRef<number | null>(null);
  const [layout, setLayout] = useState<MonitorLayout>(() =>
    readStoredMonitorLayout(projectId),
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [, setUptimeTick] = useState(0);

  useEffect(() => {
    setLayout(readStoredMonitorLayout(projectId));
    prevAvailableWidthRef.current = null;
  }, [resetVersion, projectId]);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const observer = new ResizeObserver((entries) => {
      if (dragRef.current || resizingRef.current) return;
      const entry = entries[0];
      if (!entry) return;
      const newContentWidth = entry.contentRect.width;
      const newAvailableWidth = newContentWidth - MONITOR_SPLITTER_SIZE * 3;
      const current = layoutRef.current;
      if (current.columnWidths === null) return;
      const prev =
        prevAvailableWidthRef.current ??
        current.columnWidths.reduce((total, width) => total + width, 0);
      prevAvailableWidthRef.current = newAvailableWidth;
      if (prev === newAvailableWidth) return;
      const ratio = newAvailableWidth / prev;
      const rescaled = current.columnWidths.map((w) =>
        Math.max(MONITOR_MIN_COLUMN_WIDTH, w * ratio),
      ) as [number, number, number, number];
      const nextLayout = { ...current, columnWidths: rescaled };
      applyGridLayout(nextLayout);
      setLayout(nextLayout);
    });

    observer.observe(grid);
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyGridLayout(nextLayout: MonitorLayout): void {
    const grid = gridRef.current;
    if (!grid) {
      return;
    }

    grid.style.setProperty(
      "--monitor-column-template",
      monitorColumnTemplate(nextLayout.columnWidths),
    );
    grid.style.setProperty("--monitor-row-template", monitorRowTemplate());
  }

  function scheduleGridLayout(nextLayout: MonitorLayout): void {
    pendingLayoutRef.current = nextLayout;
    applyGridLayout(nextLayout);
  }

  useEffect(() => {
    window.localStorage.setItem(
      `ivs-monitor-layout-${projectId}`,
      JSON.stringify(layout),
    );
  }, [layout, projectId]);

  useEffect(() => {
    const id = setInterval(() => setUptimeTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const startResize = (
    type: MonitorDragState["type"],
    event: PointerEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizingRef.current = false;

    const grid = gridRef.current;
    const gridStyles = grid ? window.getComputedStyle(grid) : null;
    const gridPaddingRight = gridStyles
      ? parseFloat(gridStyles.paddingRight) || 0
      : 0;
    const gridPaddingLeft = gridStyles
      ? parseFloat(gridStyles.paddingLeft) || 0
      : 0;
    const availableWidth = grid
      ? grid.clientWidth -
        gridPaddingLeft -
        gridPaddingRight -
        MONITOR_SPLITTER_SIZE * 3
      : 0;

    const columnPanels = [
      gridRef.current?.querySelector<HTMLElement>(".monitor-card-one"),
      gridRef.current?.querySelector<HTMLElement>(".monitor-card-two"),
      gridRef.current?.querySelector<HTMLElement>(".monitor-card-three"),
      gridRef.current?.querySelector<HTMLElement>(".monitor-card-four"),
    ];
    const startColumnWidths = columnPanels.map(
      (panel) => panel?.getBoundingClientRect().width ?? 0,
    ) as [number, number, number, number];

    dragRef.current = {
      type,
      startX: event.clientX,
      startY: event.clientY,
      startColumnWidths,
      availableWidth,
    };
  };

  const resizeLayout = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }

    if (!resizingRef.current) {
      resizingRef.current = true;
    }

    const baseLayout = pendingLayoutRef.current ?? layout;
    const delta = event.clientX - drag.startX;
    const nextWidths: [number, number, number, number] = [
      drag.startColumnWidths[0],
      drag.startColumnWidths[1],
      drag.startColumnWidths[2],
      drag.startColumnWidths[3],
    ];

    if (drag.type === "column-1") {
      const pairWidth = drag.startColumnWidths[0] + drag.startColumnWidths[1];
      nextWidths[0] = clamp(
        drag.startColumnWidths[0] + delta,
        MONITOR_MIN_COLUMN_WIDTH,
        pairWidth - MONITOR_MIN_COLUMN_WIDTH,
      );
      nextWidths[1] = pairWidth - nextWidths[0];
    } else if (drag.type === "column-2") {
      const pairWidth = drag.startColumnWidths[1] + drag.startColumnWidths[2];
      nextWidths[1] = clamp(
        drag.startColumnWidths[1] + delta,
        MONITOR_MIN_COLUMN_WIDTH,
        pairWidth - MONITOR_MIN_COLUMN_WIDTH,
      );
      nextWidths[2] = pairWidth - nextWidths[1];
    } else {
      const pairWidth = drag.startColumnWidths[2] + drag.startColumnWidths[3];
      nextWidths[2] = clamp(
        drag.startColumnWidths[2] + delta,
        MONITOR_MIN_COLUMN_WIDTH,
        pairWidth - MONITOR_MIN_COLUMN_WIDTH,
      );
      nextWidths[3] = pairWidth - nextWidths[2];
    }

    const nextTotal = nextWidths.reduce((total, value) => total + value, 0);
    const normalizedWidths =
      nextTotal <= 0 || drag.availableWidth <= 0
        ? nextWidths
        : nextTotal === drag.availableWidth
          ? nextWidths
          : (nextWidths.map(
              (width) => (width / nextTotal) * drag.availableWidth,
            ) as [number, number, number, number]);

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
  };

  const gridStyle = {
    "--monitor-column-template": monitorColumnTemplate(layout.columnWidths),
    "--monitor-row-template": monitorRowTemplate(),
  } as CSSProperties;
  const monitorCards = createMonitorCards(projectState);

  return (
    <section className="monitor-screen resizable-panel-screen">
      <div className="monitor-grid" ref={gridRef} style={gridStyle}>
        {monitorCards.map((card, index) => (
          <MonitorCardView
            card={card}
            className={`monitor-card-${index + 1} ${
              ["one", "two", "three", "four"][index]
                ? `monitor-card-${["one", "two", "three", "four"][index]}`
                : ""
            }`}
            key={card.title}
          />
        ))}
        <RecentBuildsPanel
          projectId={projectId}
          recentBuilds={projectState.recentBuilds}
        />
        <ActivityFeedPanel activityFeed={projectState.activityFeed} />
        <div
          className="grid-splitter monitor-column-splitter monitor-column-splitter-one"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Frontend and WildFly monitor columns"
          onPointerDown={(event) => startResize("column-1", event)}
          onPointerMove={resizeLayout}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
        />
        <div
          className="grid-splitter monitor-column-splitter monitor-column-splitter-two"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize WildFly and Consoles monitor columns"
          onPointerDown={(event) => startResize("column-2", event)}
          onPointerMove={resizeLayout}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
        />
        <div
          className="grid-splitter monitor-column-splitter monitor-column-splitter-three"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Consoles and Last Build monitor columns"
          onPointerDown={(event) => startResize("column-3", event)}
          onPointerMove={resizeLayout}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
        />
      </div>
    </section>
  );
}

function readStoredMonitorLayout(projectId: string): MonitorLayout {
  const fallback: MonitorLayout = { columnWidths: null };
  const stored = window.localStorage.getItem(`ivs-monitor-layout-${projectId}`);
  if (!stored) return fallback;
  try {
    const parsed = JSON.parse(stored) as { columnWidths?: unknown };
    return {
      columnWidths: Array.isArray(parsed.columnWidths)
        ? (parsed.columnWidths as [number, number, number, number])
        : null,
    };
  } catch {
    return fallback;
  }
}

function createMonitorCards(projectState: ProjectRuntimeState): MonitorCard[] {
  const frontendStatus = projectState.statuses.find(
    (status) => status.service === "frontend",
  );
  const wildflyStatus = projectState.statuses.find(
    (status) => status.service === "wildfly",
  );
  const lastBuild = projectState.recentBuilds[0];

  return [
    {
      title: "Frontend",
      icon: <SquareTerminal size={26} />,
      rows: [
        { label: "Status", value: statusPill(frontendStatus?.state) },
        {
          label: "URL",
          value:
            projectState.settings.services.frontend.appUrl ||
            projectState.settings.services.frontend.healthUrl ||
            "Not set",
        },
        {
          label: "Last Check",
          value: frontendStatus
            ? formatDate(frontendStatus.checkedAt)
            : "Not checked",
        },
      ],
    },
    {
      title: "WildFly",
      icon: <Layers3 size={26} />,
      rows: [
        { label: "Status", value: statusPill(wildflyStatus?.state) },
        {
          label: "Console",
          value:
            projectState.settings.services.wildfly.managementUrl || "Not set",
        },
        {
          label: "KMU",
          value: projectState.settings.services.wildfly.appUrl || "Not set",
        },
      ],
    },
    {
      title: "Uptime",
      icon: <Clock3 size={26} />,
      rows: [
        {
          label: "Frontend",
          value: formatUptime(frontendStatus?.startedAt, frontendStatus?.state),
        },
        {
          label: "WildFly",
          value: formatUptime(wildflyStatus?.startedAt, wildflyStatus?.state),
        },
      ],
    },
    {
      title: "Last Build",
      icon: <CheckCircle2 size={26} />,
      rows: [
        {
          label: "Status",
          value: statusPill(lastBuild?.status.toLowerCase()),
        },
        { label: "Duration", value: lastBuild?.duration ?? "No builds" },
        { label: "Completed", value: lastBuild?.completed ?? "No builds" },
      ],
    },
  ];
}

function statusPill(state: string | undefined): JSX.Element {
  const normalized = state ?? "unknown";
  const statusClass =
    normalized === "running" || normalized === "success"
      ? "success"
      : normalized === "starting"
        ? "starting"
        : normalized === "stopping"
          ? "stopping"
          : normalized === "stopped"
            ? "stopped"
            : "failed";
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

function buildStatusClass(status: RecentBuildRecord["status"]): string {
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

function activityIcon(kind: ActivityRecord["kind"]): JSX.Element {
  if (kind === "build") {
    return <Package size={18} />;
  }
  if (kind === "service") {
    return <SquareTerminal size={18} />;
  }
  if (kind === "git") {
    return <GitBranch size={18} />;
  }
  return <Circle size={18} />;
}

function formatUptime(
  startedAt: string | undefined,
  state: ServiceState | undefined,
): string {
  if (state === "starting") {
    return "Starting";
  }

  if (state === "stopping") {
    return "Stopping";
  }

  if (!startedAt || state !== "running") {
    return "Not running";
  }

  const totalSeconds = Math.max(
    1,
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
  );
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
