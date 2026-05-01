import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { CheckCircle2, CircleDot, GitBranch } from "lucide-react";
import { ActionLink } from "../../components/common/ActionLink";
import { LiveStatus } from "../../components/common/LiveStatus";
import { LogLines } from "../../components/common/LogLines";
import { Panel } from "../../components/common/Panel";
import {
  branchInfo,
  buildLog,
  buildStages,
  frontendLogs,
  tailLogs,
  wildFlyLogs,
} from "../../data/mockData";
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

function LogPanel({
  title,
  lines,
  footer,
  className,
  dense = false,
}: {
  title: string;
  lines: string[];
  footer: string;
  className?: string;
  dense?: boolean;
}): JSX.Element {
  const [findTerm, setFindTerm] = useState("");
  const id = `find-${title.toLowerCase().replace(/\s+/g, "-")}`;

  const findBar = (
    <div className="log-find-row">
      <label htmlFor={id}>Find</label>
      <input
        id={id}
        type="text"
        value={findTerm}
        onChange={(e) => setFindTerm(e.target.value)}
      />
      <button type="button">Prev</button>
      <button type="button">Next</button>
      <button type="button" onClick={() => setFindTerm("")}>
        Clear
      </button>
    </div>
  );

  return (
    <Panel
      title={title}
      action={<LiveStatus />}
      className={className}
      findBar={findBar}
    >
      <LogLines lines={lines} dense={dense} highlight={findTerm} />
      <div className="panel-footer">
        <ActionLink>{footer}</ActionLink>
      </div>
    </Panel>
  );
}

function BuildStatusPanel(): JSX.Element {
  return (
    <Panel
      title="Build Status"
      titleMeta={<span className="elapsed-pill">Elapsed 06:42</span>}
      className="build-status-panel"
    >
      <div className="branch-info">
        <div className="branch-info-title">
          <GitBranch size={14} />
          <span>Git status</span>
        </div>
        <div className="branch-row">
          <span>Source</span>
          <strong>{branchInfo.branch}</strong>
        </div>
        <div className="branch-row">
          <span>Commit</span>
          <strong>{branchInfo.commit}</strong>
        </div>
      </div>
      <div className="timeline">
        {buildStages.map((stage) => (
          <div
            className={`timeline-item${stage.current ? " current" : ""}`}
            key={stage.label}
          >
            {stage.current ? (
              <CircleDot size={17} />
            ) : (
              <CheckCircle2 size={17} />
            )}
            <span>{stage.label}</span>
            <time>{stage.time}</time>
          </div>
        ))}
      </div>
      <div className="panel-footer">
        <ActionLink>Open WAR folder</ActionLink>
      </div>
    </Panel>
  );
}

function BuildLogPanel(): JSX.Element {
  const [findTerm, setFindTerm] = useState("");

  const findBar = (
    <div className="log-find-row">
      <label htmlFor="find-build-log">Find</label>
      <input
        id="find-build-log"
        type="text"
        value={findTerm}
        onChange={(e) => setFindTerm(e.target.value)}
      />
      <button type="button">Prev</button>
      <button type="button">Next</button>
      <button type="button" onClick={() => setFindTerm("")}>
        Clear
      </button>
    </div>
  );

  return (
    <Panel title="Build Log" className="build-log-panel" findBar={findBar}>
      <LogLines lines={buildLog} dense highlight={findTerm} />
      <div className="panel-footer">
        <ActionLink>Open build log</ActionLink>
      </div>
    </Panel>
  );
}

function TailLogPanel(): JSX.Element {
  const [findTerm, setFindTerm] = useState("");

  const findBar = (
    <div className="log-find-row">
      <label htmlFor="find-tail-log">Find</label>
      <input
        id="find-tail-log"
        type="text"
        value={findTerm}
        onChange={(e) => setFindTerm(e.target.value)}
      />
      <button type="button">Prev</button>
      <button type="button">Next</button>
      <button type="button" onClick={() => setFindTerm("")}>
        Clear
      </button>
    </div>
  );

  return (
    <Panel
      title="Tail Log"
      action={<LiveStatus label="Live tail" />}
      className="tail-log-panel"
      findBar={findBar}
    >
      <LogLines lines={tailLogs} dense highlight={findTerm} />
    </Panel>
  );
}

export function DashboardContent({
  resetVersion,
}: {
  resetVersion: number;
}): JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [layout, setLayout] = useState<DashboardLayout>({
    columnWidths: null,
    topRowHeight: null,
  });

  useEffect(() => {
    setLayout({ columnWidths: null, topRowHeight: null });
  }, [resetVersion]);

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
      gridRef.current?.querySelector<HTMLElement>(".build-log-panel"),
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
          lines={frontendLogs}
          footer="Open full log"
          className="frontend-panel"
        />
        <BuildLogPanel />
        <BuildStatusPanel />
        <LogPanel
          title="WildFly"
          lines={wildFlyLogs}
          footer="Open full log"
          className="wildfly-panel"
          dense
        />
        <TailLogPanel />
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
