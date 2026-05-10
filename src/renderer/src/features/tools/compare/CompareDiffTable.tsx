import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Maximize2 } from "lucide-react";
import type { DiffRow } from "./compareDiff";

const DIFF_ROW_ESTIMATED_HEIGHT = 24;
const DIFF_ROW_OVERSCAN = 14;

export function CompareDiffTable({
  rows,
  leftTitle,
  rightTitle,
  summary,
  ready,
  className = "",
  expanded,
  setExpanded,
}: {
  rows: DiffRow[];
  leftTitle: string;
  rightTitle: string;
  summary: string;
  ready: boolean;
  className?: string;
  expanded: boolean;
  setExpanded?: (expanded: boolean) => void;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const changedIndexes = useMemo(
    () =>
      rows
        .map((row, index) => (row.kind === "equal" ? null : index))
        .filter((index): index is number => index !== null),
    [rows],
  );
  const rowVirtualizer = useVirtualizer({
    count: ready ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DIFF_ROW_ESTIMATED_HEIGHT,
    measureElement: (element) =>
      element.getBoundingClientRect().height || DIFF_ROW_ESTIMATED_HEIGHT,
    overscan: DIFF_ROW_OVERSCAN,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const firstVisibleIndex = virtualRows[0]?.index ?? 0;
  const lastVisibleIndex =
    virtualRows[virtualRows.length - 1]?.index ?? firstVisibleIndex;

  function scrollToRow(index: number): void {
    rowVirtualizer.scrollToIndex(index, { align: "center" });
  }

  return (
    <div
      className={`compare-diff${className ? ` ${className}` : ""}`}
      aria-label="Text comparison"
    >
      <div className="compare-result-titlebar">
        <div className="compare-result-title">
          <h2>Compare Results</h2>
          <span>{summary}</span>
        </div>
        {!expanded && (
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Expand comparison"
            title="Expand comparison"
            onClick={() => setExpanded?.(true)}
          >
            <Maximize2 size={15} />
          </button>
        )}
      </div>
      <div className="compare-diff-header">
        <span>{leftTitle}</span>
        <span>{rightTitle}</span>
        <span aria-label="Change map" />
      </div>
      <div className="compare-diff-body">
        <div className="compare-diff-scroll" ref={scrollRef}>
          {!ready ? null : rows.length === 0 ? (
            <div className="compare-empty-row">No differences detected.</div>
          ) : (
            <div
              className="compare-diff-table"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <div
                    className={`compare-diff-row ${row.kind}`}
                    data-index={virtualRow.index}
                    key={virtualRow.key}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <DiffCell
                      side="left"
                      lineNumber={row.leftLineNumber}
                      text={row.leftText}
                      empty={row.kind === "added"}
                    />
                    <DiffCell
                      side="right"
                      lineNumber={row.rightLineNumber}
                      text={row.rightText}
                      empty={row.kind === "removed"}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {ready && rows.length > 0 ? (
          <CompareChangeMap
            rowCount={rows.length}
            changedIndexes={changedIndexes}
            firstVisibleIndex={firstVisibleIndex}
            lastVisibleIndex={lastVisibleIndex}
            onJump={scrollToRow}
          />
        ) : (
          <div className="compare-change-map" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

function CompareChangeMap({
  rowCount,
  changedIndexes,
  firstVisibleIndex,
  lastVisibleIndex,
  onJump,
}: {
  rowCount: number;
  changedIndexes: number[];
  firstVisibleIndex: number;
  lastVisibleIndex: number;
  onJump: (index: number) => void;
}): JSX.Element {
  const mapRef = useRef<HTMLDivElement>(null);
  const visibleTop = rowCount <= 1 ? 0 : (firstVisibleIndex / rowCount) * 100;
  const visibleHeight = Math.max(
    4,
    ((lastVisibleIndex - firstVisibleIndex + 1) / rowCount) * 100,
  );

  function jumpFromPointer(clientY: number): void {
    const element = mapRef.current;
    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    onJump(Math.round(ratio * Math.max(0, rowCount - 1)));
  }

  return (
    <div
      className="compare-change-map"
      ref={mapRef}
      aria-label="Changed line map"
      role="scrollbar"
      aria-valuemin={1}
      aria-valuemax={rowCount}
      aria-valuenow={Math.min(rowCount, firstVisibleIndex + 1)}
      onPointerDown={(event) => jumpFromPointer(event.clientY)}
    >
      <span
        className="compare-change-map-current"
        style={{
          top: `${visibleTop}%`,
          height: `${Math.min(100 - visibleTop, visibleHeight)}%`,
        }}
      />
      {changedIndexes.map((index) => (
        <button
          className="compare-change-marker"
          type="button"
          aria-label={`Jump to changed row ${index + 1}`}
          key={index}
          style={{ top: `${((index + 0.5) / rowCount) * 100}%` }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onJump(index)}
        />
      ))}
    </div>
  );
}

function DiffCell({
  side,
  lineNumber,
  text,
  empty,
}: {
  side: "left" | "right";
  lineNumber?: number;
  text?: string;
  empty: boolean;
}): JSX.Element {
  return (
    <div className={`compare-diff-cell ${side}${empty ? " empty" : ""}`}>
      <span className="compare-line-number">{lineNumber ?? ""}</span>
      <pre>{text ?? ""}</pre>
    </div>
  );
}
