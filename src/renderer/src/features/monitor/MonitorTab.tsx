import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { ActionLink } from "../../components/common/ActionLink";
import { Panel } from "../../components/common/Panel";
import { activityFeed, monitorCards, recentBuilds } from "../../data/mockData";
import type { MonitorCard } from "../../types";
import { clamp } from "../../utils/math";

type MonitorLayout = {
  columnWidths: [number, number, number, number] | null;
  topRowHeight: number | null;
};

type MonitorDragState = {
  type: "column-1" | "column-2" | "column-3" | "row";
  startX: number;
  startY: number;
  startColumnWidths: [number, number, number, number];
  startTopRowHeight: number;
};

const MONITOR_MIN_COLUMN_WIDTH = 190;
const MONITOR_MIN_TOP_ROW = 198;
const MONITOR_MIN_BOTTOM_ROW = 240;
const MONITOR_SPLITTER_SIZE = 16;

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

function RecentBuildsPanel(): JSX.Element {
  return (
    <Panel
      title="Recent Builds"
      action={<ActionLink>View all</ActionLink>}
      className="recent-builds-panel"
    >
      <table className="recent-builds-table">
        <thead>
          <tr>
            <th>Build ID</th>
            <th>Branch</th>
            <th>Builder Name</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Completed</th>
          </tr>
        </thead>
        <tbody>
          {recentBuilds.map((build) => (
            <tr key={build.id}>
              <td>{build.id}</td>
              <td>{build.branch}</td>
              <td>
                <span
                  className={`environment-pill ${build.environment.toLowerCase()}`}
                >
                  {build.environment}
                </span>
              </td>
              <td>
                <span className={`status-pill ${build.status.toLowerCase()}`}>
                  {build.status}
                </span>
              </td>
              <td>{build.duration}</td>
              <td>{build.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-footer">
        <span>Showing 1 to 5 of 25 results</span>
        <div className="pagination">
          <button
            className="pagination-arrow"
            type="button"
            aria-label="Previous page"
          >
            <ChevronLeft size={22} />
          </button>
          {[1, 2, 3, 4, 5].map((page) => (
            <button
              className={page === 2 ? "active" : ""}
              type="button"
              key={page}
            >
              {page}
            </button>
          ))}
          <span className="pagination-ellipsis">...</span>
          <button type="button">22</button>
          <button
            className="pagination-arrow next"
            type="button"
            aria-label="Next page"
          >
            <ChevronRight size={22} />
          </button>
        </div>
      </div>
    </Panel>
  );
}

function ActivityFeedPanel(): JSX.Element {
  return (
    <Panel
      title="Activity Feed"
      action={
        <button className="text-link" type="button">
          View all
        </button>
      }
      className="activity-feed-panel"
    >
      <div className="activity-list">
        {activityFeed.map((item) => (
          <div className="activity-item" key={`${item.title}-${item.time}`}>
            <span className={`activity-dot ${item.tone}`} />
            <div className="activity-icon">{item.icon}</div>
            <div className="activity-copy">
              <strong>{item.title}</strong>
              <span>{item.meta}</span>
            </div>
            <time>{item.time}</time>
          </div>
        ))}
      </div>
      <div className="activity-footer">
        <ActionLink>View all activity</ActionLink>
      </div>
    </Panel>
  );
}

export function MonitorTab({
  resetVersion,
}: {
  resetVersion: number;
}): JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<MonitorDragState | null>(null);
  const [layout, setLayout] = useState<MonitorLayout>({
    columnWidths: null,
    topRowHeight: null,
  });

  useEffect(() => {
    setLayout({ columnWidths: null, topRowHeight: null });
  }, [resetVersion]);

  const startResize = (
    type: MonitorDragState["type"],
    event: PointerEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const topRowPanel =
      gridRef.current?.querySelector<HTMLElement>(".monitor-card-one");
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
        MONITOR_SPLITTER_SIZE;
      const maxTopHeight = Math.max(
        MONITOR_MIN_TOP_ROW,
        availableHeight - MONITOR_MIN_BOTTOM_ROW,
      );
      const nextTopHeight = clamp(
        drag.startTopRowHeight + event.clientY - drag.startY,
        MONITOR_MIN_TOP_ROW,
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
      MONITOR_SPLITTER_SIZE * 3;
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
      nextTotal === availableWidth
        ? nextWidths
        : (nextWidths.map((width) => (width / nextTotal) * availableWidth) as [
            number,
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
    "--monitor-column-template":
      layout.columnWidths === null
        ? `minmax(${MONITOR_MIN_COLUMN_WIDTH}px, 1fr) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_COLUMN_WIDTH}px, 1fr) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_COLUMN_WIDTH}px, 1fr) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_COLUMN_WIDTH}px, 1fr)`
        : `minmax(${MONITOR_MIN_COLUMN_WIDTH}px, ${layout.columnWidths[0]}px) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_COLUMN_WIDTH}px, ${layout.columnWidths[1]}px) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_COLUMN_WIDTH}px, ${layout.columnWidths[2]}px) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_COLUMN_WIDTH}px, ${layout.columnWidths[3]}px)`,
    "--monitor-row-template":
      layout.topRowHeight === null
        ? `minmax(${MONITOR_MIN_TOP_ROW}px, auto) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_BOTTOM_ROW}px, 1fr)`
        : `minmax(${MONITOR_MIN_TOP_ROW}px, ${layout.topRowHeight}px) ${MONITOR_SPLITTER_SIZE}px minmax(${MONITOR_MIN_BOTTOM_ROW}px, 1fr)`,
  } as CSSProperties;

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
        <RecentBuildsPanel />
        <ActivityFeedPanel />
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
        <div
          className="grid-splitter monitor-row-splitter"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize monitor summary and details rows"
          onPointerDown={(event) => startResize("row", event)}
          onPointerMove={resizeLayout}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
        />
      </div>
    </section>
  );
}
