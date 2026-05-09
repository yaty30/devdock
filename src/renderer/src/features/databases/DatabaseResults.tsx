import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeftRight,
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  GitCompare,
  LucideSquircle,
  SquareDashed,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Modal } from "../../components/dialogs/Modal";
import type { DatabaseQueryValue, DatabaseTable } from "../../types";
import { formatCompactTime } from "./databaseFormatters";
import type {
  ResultColumn,
  ResultColumnKey,
  ResultMeta,
  ResultRow,
  ResultTab,
} from "./DatabaseWorkspace";

type ResultColumnDragState = {
  key: ResultColumnKey;
  startX: number;
  startWidth: number;
  nextWidth: number;
};

type StableResultColumnWidths = {
  layoutKey: string;
  widths: Partial<Record<ResultColumnKey, number>>;
};

type ResultRowContextMenu = {
  x: number;
  y: number;
  rowIndex: number;
  row: ResultRow;
};

type ResultCompareSelection = {
  rowIndex: number;
  row: ResultRow;
};

type ResultCompareState = {
  base: ResultCompareSelection;
  target: ResultCompareSelection;
};

type SelectedResultCell = {
  rowIndex: number;
  columnKey: ResultColumnKey;
};

type ResultSnackbarState = {
  tone: "valid" | "invalid";
  message: string;
};

const SEQ_RESULT_COLUMN_KEY = "__ui_seq";
const RESULT_ROW_ESTIMATED_HEIGHT = 37;
const RESULT_ROW_OVERSCAN = 10;

export function ResultTabsPanel({
  tabs,
  activeTabId,
  metadataTables,
  onTabChange,
  onColumnWidthsChange,
}: {
  tabs: ResultTab[];
  activeTabId: string | null;
  metadataTables: DatabaseTable[];
  onTabChange: (tabId: string) => void;
  onColumnWidthsChange: (
    columnWidths: Partial<Record<ResultColumnKey, number>>,
  ) => void;
}): JSX.Element {
  const activeTab =
    tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;

  if (!activeTab) {
    return (
      <div className="database-result-region">
        <p className="database-empty-state">No result tabs for this sheet.</p>
      </div>
    );
  }

  return (
    <div className="database-result-tabs-region">
      <div
        className="database-result-tabs"
        role="tablist"
        aria-label="Statement results"
      >
        {tabs.map((tab) => (
          <button
            className={tab.id === activeTab.id ? "active" : undefined}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTab.id}
            title={tab.statementSql}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.name}
          </button>
        ))}
      </div>
      <ResultGrid
        rows={activeTab.rows}
        columns={activeTab.columns}
        meta={activeTab.meta}
        metadataTables={metadataTables}
        columnWidths={activeTab.columnWidths}
        onColumnWidthsChange={onColumnWidthsChange}
      />
    </div>
  );
}
function ResultGrid({
  rows,
  columns,
  meta,
  metadataTables,
  columnWidths,
  onColumnWidthsChange,
}: {
  rows: ResultRow[];
  columns: ResultColumn[];
  meta: ResultMeta;
  metadataTables: DatabaseTable[];
  columnWidths: Partial<Record<ResultColumnKey, number>>;
  onColumnWidthsChange: (
    columnWidths: Partial<Record<ResultColumnKey, number>>,
  ) => void;
}): JSX.Element {
  const resultScrollRef = useRef<HTMLDivElement>(null);
  const columnDragRef = useRef<ResultColumnDragState | null>(null);
  const columnResizeFrameRef = useRef<number | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const [stableColumnWidths, setStableColumnWidths] =
    useState<StableResultColumnWidths | null>(null);
  const [draftColumnWidths, setDraftColumnWidths] = useState<Partial<
    Record<ResultColumnKey, number>
  > | null>(null);
  const [expandedRowIndex, setExpandedRowIndex] = useState<number | null>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedResultCell | null>(
    null,
  );
  const [rowContextMenu, setRowContextMenu] =
    useState<ResultRowContextMenu | null>(null);
  const [compareBase, setCompareBase] = useState<ResultCompareSelection | null>(
    null,
  );
  const [compareState, setCompareState] = useState<ResultCompareState | null>(
    null,
  );
  const [snackbar, setSnackbar] = useState<ResultSnackbarState | null>(null);
  const hasColumns = columns.length > 0;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => resultScrollRef.current,
    estimateSize: () => RESULT_ROW_ESTIMATED_HEIGHT,
    measureElement: (element) =>
      element.getBoundingClientRect().height || RESULT_ROW_ESTIMATED_HEIGHT,
    overscan: RESULT_ROW_OVERSCAN,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const displayColumns = useMemo(
    () =>
      hasColumns && rows.length > 0
        ? [createSeqResultColumn(), ...columns]
        : columns,
    [columns, hasColumns, rows.length],
  );
  const columnLayoutKey = useMemo(
    () =>
      displayColumns
        .map(
          (column) =>
            `${column.key}:${column.kind}:${column.minWidth}:${column.weight}`,
        )
        .join("|"),
    [displayColumns],
  );
  const baseColumnWidths =
    stableColumnWidths?.layoutKey === columnLayoutKey
      ? stableColumnWidths.widths
      : null;
  const calculatedColumns = useMemo(
    () =>
      calculateResultColumnWidths({
        columns: displayColumns,
        panelWidth,
        stableColumnWidths: baseColumnWidths,
        userColumnWidths: draftColumnWidths ?? columnWidths,
      }),
    [
      displayColumns,
      panelWidth,
      baseColumnWidths,
      columnWidths,
      draftColumnWidths,
    ],
  );
  const totalColumnWidth = calculatedColumns.reduce(
    (total, column) => total + column.width,
    0,
  );
  const tableWidth = `${Math.ceil(totalColumnWidth)}px`;

  useEffect(() => {
    const element = resultScrollRef.current;
    if (!element) {
      return undefined;
    }

    setPanelWidth(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setPanelWidth(entry.contentRect.width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hasColumns || panelWidth <= 0) {
      return;
    }

    setStableColumnWidths((current) => {
      if (current?.layoutKey === columnLayoutKey) {
        return current;
      }

      const initialColumns = calculateResultColumnWidths({
        columns: displayColumns,
        panelWidth,
        stableColumnWidths: null,
        userColumnWidths: columnWidths,
      });
      return {
        layoutKey: columnLayoutKey,
        widths: Object.fromEntries(
          initialColumns.map((column) => [column.key, column.width]),
        ),
      };
    });
  }, [columnLayoutKey, columnWidths, displayColumns, hasColumns, panelWidth]);

  useEffect(() => {
    return () => {
      if (columnResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(columnResizeFrameRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [expandedRowIndex, rowVirtualizer]);

  useEffect(() => {
    setExpandedRowIndex(null);
    setSelectedCell(null);
    setRowContextMenu(null);
    setCompareBase(null);
    setCompareState(null);
    setSnackbar(null);
    if (resultScrollRef.current) {
      resultScrollRef.current.scrollTop = 0;
    }
  }, [rows, columns]);

  useEffect(() => {
    if (!snackbar) {
      return undefined;
    }

    const timer = window.setTimeout(() => setSnackbar(null), 3000);
    return () => window.clearTimeout(timer);
  }, [snackbar]);

  useEffect(() => {
    if (!rowContextMenu) {
      return undefined;
    }

    function closeContextMenu(): void {
      setRowContextMenu(null);
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setRowContextMenu(null);
      }
    }

    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [rowContextMenu]);

  const startColumnResize = (
    column: ResultColumn,
    event: PointerEvent<HTMLSpanElement>,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    columnDragRef.current = {
      key: column.key,
      startX: event.clientX,
      startWidth:
        calculatedColumns.find((item) => item.key === column.key)?.width ??
        column.minWidth,
      nextWidth:
        calculatedColumns.find((item) => item.key === column.key)?.width ??
        column.minWidth,
    };
    setDraftColumnWidths(columnWidths);
  };

  const resizeColumn = (event: PointerEvent<HTMLSpanElement>): void => {
    const drag = columnDragRef.current;
    if (!drag) {
      return;
    }

    const column = displayColumns.find((item) => item.key === drag.key);
    if (!column) {
      return;
    }

    drag.nextWidth = Math.max(
      column.minWidth,
      drag.startWidth + event.clientX - drag.startX,
    );

    if (columnResizeFrameRef.current !== null) {
      return;
    }

    columnResizeFrameRef.current = window.requestAnimationFrame(() => {
      columnResizeFrameRef.current = null;
      const latestDrag = columnDragRef.current;
      if (!latestDrag) {
        return;
      }
      setDraftColumnWidths({
        ...(draftColumnWidths ?? columnWidths),
        [latestDrag.key]: latestDrag.nextWidth,
      });
    });
  };

  const stopColumnResize = (event: PointerEvent<HTMLSpanElement>): void => {
    if (
      columnDragRef.current &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const drag = columnDragRef.current;
    if (columnResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(columnResizeFrameRef.current);
      columnResizeFrameRef.current = null;
    }
    columnDragRef.current = null;
    setDraftColumnWidths(null);
    if (drag) {
      onColumnWidthsChange({
        ...columnWidths,
        [drag.key]: drag.nextWidth,
      });
    }
  };

  const resetColumnWidth = (column: ResultColumn): void => {
    const next = { ...columnWidths };
    delete next[column.key];
    setDraftColumnWidths(null);
    onColumnWidthsChange(next);
  };

  function toggleRowExpanded(rowIndex: number): void {
    setExpandedRowIndex((current) => (current === rowIndex ? null : rowIndex));
  }

  function openRowContextMenu(
    event: MouseEvent<HTMLTableRowElement>,
    row: ResultRow,
    rowIndex: number,
  ): void {
    event.preventDefault();
    setRowContextMenu({
      x: event.clientX,
      y: event.clientY,
      row,
      rowIndex,
    });
  }

  function copyContextRowAsJson(): void {
    if (!rowContextMenu) {
      return;
    }

    try {
      const writeText = navigator.clipboard?.writeText;
      if (!writeText) {
        throw new Error("Clipboard is not available.");
      }

      void writeText
        .call(navigator.clipboard, JSON.stringify(rowContextMenu.row, null, 2))
        .then(() => setSnackbar({ tone: "valid", message: "Copied JSON" }))
        .catch((error) => {
          console.error(error);
          setSnackbar({
            tone: "invalid",
            message:
              error instanceof Error ? error.message : "Copy JSON failed",
          });
        });
    } catch (error) {
      console.error(error);
      setSnackbar({
        tone: "invalid",
        message: error instanceof Error ? error.message : "Copy JSON failed",
      });
    }
    setRowContextMenu(null);
  }

  function selectContextRowForCompare(): void {
    if (!rowContextMenu) {
      return;
    }

    const selected = {
      rowIndex: rowContextMenu.rowIndex,
      row: rowContextMenu.row,
    };
    if (!compareBase) {
      setCompareBase(selected);
      setRowContextMenu(null);
      return;
    }

    if (compareBase.rowIndex === selected.rowIndex) {
      setRowContextMenu(null);
      return;
    }

    setCompareState({ base: compareBase, target: selected });
    setCompareBase(null);
    setRowContextMenu(null);
  }

  return (
    <div className="database-result-region">
      <div className="database-result-scroll" ref={resultScrollRef}>
        {hasColumns ? (
          <table
            className="recent-builds-table database-result-table"
            style={{ width: tableWidth, minWidth: tableWidth }}
          >
            <colgroup>
              {calculatedColumns.map((column) => (
                <col
                  key={column.key}
                  style={{
                    width: `${column.width}px`,
                  }}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                {displayColumns.map((column) => (
                  <th key={column.key}>
                    <span className="database-result-th-content">
                      <span className="database-result-column-label">
                        {formatResultColumnHeader(column)}
                      </span>
                      <span
                        className="database-column-resize-handle"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${column.label} column`}
                        onPointerDown={(event) =>
                          startColumnResize(column, event)
                        }
                        onPointerMove={resizeColumn}
                        onPointerUp={stopColumnResize}
                        onPointerCancel={stopColumnResize}
                        onDoubleClick={() => resetColumnWidth(column)}
                      >
                        <ArrowLeftRight size={13} />
                      </span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr className="database-result-empty-row">
                  <td colSpan={displayColumns.length}>No records found</td>
                </tr>
              ) : null}
              {rows.length > 0 && virtualRows.length > 0 ? (
                <tr aria-hidden="true">
                  <td
                    colSpan={displayColumns.length}
                    style={{
                      height: `${virtualRows[0]?.start ?? 0}px`,
                      padding: 0,
                    }}
                  />
                </tr>
              ) : null}
            </tbody>
            {virtualRows.map((virtualRow) => {
              const rowIndex = virtualRow.index;
              const row = rows[rowIndex];
              const expanded = expandedRowIndex === rowIndex;
              return (
                <tbody
                  data-index={virtualRow.index}
                  key={`result-row-${rowIndex}`}
                  ref={rowVirtualizer.measureElement}
                >
                  <tr
                    className={`database-result-row${
                      compareBase?.rowIndex === rowIndex ? " compare-base" : ""
                    }`}
                    key={`row-${rowIndex}`}
                    onContextMenu={(event) =>
                      openRowContextMenu(event, row, rowIndex)
                    }
                  >
                    {displayColumns.map((column) => {
                      const selected =
                        selectedCell?.rowIndex === rowIndex &&
                        selectedCell.columnKey === column.key;
                      return (
                        <td
                          className={
                            column.key !== SEQ_RESULT_COLUMN_KEY
                              ? `database-result-value-cell${selected ? " selected" : ""}`
                              : undefined
                          }
                          key={`${rowIndex}-${column.key}`}
                          onClick={
                            column.key === SEQ_RESULT_COLUMN_KEY
                              ? undefined
                              : () =>
                                  setSelectedCell({
                                    rowIndex,
                                    columnKey: column.key,
                                  })
                          }
                        >
                          {column.key === SEQ_RESULT_COLUMN_KEY ? (
                            <span className="database-result-seq-cell">
                              <button
                                className="database-row-expand-button"
                                type="button"
                                aria-label={
                                  expanded
                                    ? `Collapse row ${rowIndex + 1}`
                                    : `Expand row ${rowIndex + 1}`
                                }
                                title={
                                  expanded
                                    ? `Collapse row ${rowIndex + 1}`
                                    : `Expand row ${rowIndex + 1}`
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleRowExpanded(rowIndex);
                                }}
                              >
                                {expanded ? (
                                  <ChevronDown size={13} />
                                ) : (
                                  <ChevronRight size={13} />
                                )}
                              </button>
                              <span>{rowIndex + 1}</span>
                            </span>
                          ) : (
                            renderResultValue(row[column.key])
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {expanded ? (
                    <tr
                      className={`database-result-detail-row ${expanded ? "expanded" : ""}`}
                      key={`detail-${rowIndex}`}
                    >
                      <td colSpan={displayColumns.length}>
                        <ResultRowDetails
                          row={row}
                          columns={columns}
                          metadataTables={metadataTables}
                        />
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
            <tbody>
              {rows.length > 0 && virtualRows.length > 0 ? (
                <tr aria-hidden="true">
                  <td
                    colSpan={displayColumns.length}
                    style={{
                      height: `${Math.max(
                        0,
                        rowVirtualizer.getTotalSize() -
                          (virtualRows[virtualRows.length - 1]?.end ?? 0),
                      )}px`,
                      padding: 0,
                    }}
                  />
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : null}
        {!hasColumns && rows.length === 0 ? (
          <p className="database-empty-state">No records found.</p>
        ) : null}
      </div>
      {rowContextMenu ? (
        <div
          className="database-context-menu database-result-context-menu"
          style={{ left: rowContextMenu.x, top: rowContextMenu.y }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={copyContextRowAsJson}>
            <Braces size={14} />
            Copy record in JSON
          </button>
          {compareBase?.rowIndex === rowContextMenu.rowIndex ? null : (
            <button
              type="button"
              role="menuitem"
              onClick={selectContextRowForCompare}
            >
              <GitCompare size={16} />
              {compareBase
                ? `Select to compare with row ${compareBase.rowIndex + 1}`
                : "Select to compare"}
            </button>
          )}
        </div>
      ) : null}
      {snackbar ? (
        <div
          className={`app-snackbar database-result-snackbar ${snackbar.tone}`}
        >
          {snackbar.message}
        </div>
      ) : null}
      <Modal
        open={compareState !== null}
        title="Compare Rows"
        subtitle={
          compareState
            ? `Row ${compareState.base.rowIndex + 1} vs Row ${
                compareState.target.rowIndex + 1
              }`
            : undefined
        }
        size="xl"
        className="database-row-compare-modal"
        contentClassName="database-row-compare-modal-content"
        closeLabel="Close row comparison"
        onClose={() => setCompareState(null)}
      >
        {compareState ? (
          <ResultRowComparison compare={compareState} columns={columns} />
        ) : null}
      </Modal>
      <div
        className={`database-result-footer${meta.status === "error" ? " error" : ""}`}
      >
        <span className="database-result-footer-summary">
          {!meta.hasRun
            ? "No query executed for this sheet"
            : meta.status === "error"
              ? `Error · ${meta.errorMessage ?? "Execution failed"}`
              : formatResultFooter(meta)}
        </span>
        <time>{meta.hasRun ? formatCompactTime(meta.queriedAt) : ""}</time>
      </div>
    </div>
  );
}
function ResultRowDetails({
  row,
  columns,
  metadataTables,
}: {
  row: ResultRow;
  columns: ResultColumn[];
  metadataTables: DatabaseTable[];
}): JSX.Element {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function copyValue(columnKey: string, value: DatabaseQueryValue): void {
    void navigator.clipboard
      ?.writeText(formatPlainResultValue(value))
      .then(() => {
        setCopiedKey(columnKey);
        setTimeout(
          () => setCopiedKey((k) => (k === columnKey ? null : k)),
          1500,
        );
      })
      .catch(() => undefined);
  }

  return (
    <div
      className="database-result-row-details"
      onClick={(event) => event.stopPropagation()}
    >
      <table className="database-result-row-details-table">
        <colgroup>
          <col className="database-detail-column-col" />
          <col className="database-detail-value-col" />
          <col className="database-detail-meta-col" />
          <col className="database-detail-meta-col" />
          <col className="database-detail-meta-col" />
        </colgroup>
        <thead>
          <tr>
            <th>Column</th>
            <th>Value</th>
            <th>Type</th>
            <th>Nullable</th>
            <th>Key</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => {
            const metadata = resolveResultColumnMetadata(
              column,
              metadataTables,
            );
            return (
              <tr key={column.key}>
                <td title={column.label}>{column.label}</td>
                <td title={formatPlainResultValue(row[column.key])}>
                  <div className="database-detail-value-cell">
                    <span className="database-detail-value-text">
                      {renderResultValue(row[column.key])}
                    </span>
                    <button
                      type="button"
                      className={`database-detail-copy-button${copiedKey === column.key ? " copied" : ""}`}
                      onClick={() => copyValue(column.key, row[column.key])}
                      title="Copy value"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </td>
                <td title={metadata.type}>{metadata.type}</td>
                <td title={metadata.nullability}>{metadata.nullability}</td>
                <td title={metadata.keyInfo}>{metadata.keyInfo}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function ResultRowComparison({
  compare,
  columns,
}: {
  compare: ResultCompareState;
  columns: ResultColumn[];
}): JSX.Element {
  const baseLabel = `Row ${compare.base.rowIndex + 1}`;
  const targetLabel = `Row ${compare.target.rowIndex + 1}`;

  return (
    <div className="database-row-comparison">
      <table className="database-row-comparison-table">
        <colgroup>
          <col className="database-row-comparison-column-col" />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>Column</th>
            <th>{baseLabel}</th>
            <th>{targetLabel}</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.key}>
              <td
                title={column.label}
                className="database-row-comparison-column"
              >
                {column.label}
              </td>
              <td title={formatPlainResultValue(compare.base.row[column.key])}>
                <div className="database-comparison-value-wrap">
                  {renderResultValue(compare.base.row[column.key])}
                </div>
              </td>
              <td
                title={formatPlainResultValue(compare.target.row[column.key])}
              >
                <div className="database-comparison-value-wrap">
                  {renderResultValue(compare.target.row[column.key])}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function createSeqResultColumn(): ResultColumn {
  return {
    key: SEQ_RESULT_COLUMN_KEY,
    label: "seq",
    kind: "number",
    minWidth: 72,
    weight: 0.35,
  };
}

function formatResultColumnHeader(column: ResultColumn): JSX.Element {
  return column.databaseType ? (
    <>
      <span>{column.label}</span>
      <span className="database-column-type">{column.databaseType}</span>
    </>
  ) : (
    <span>{column.label}</span>
  );
}

function renderResultValue(value: DatabaseQueryValue): ReactNode {
  if (value === null) {
    return (
      <div className="database-null-pill">
        {/* <SquareDashed size={16} /> */}
        <span>NULL</span>
      </div>
    );
  }
  return String(value);
}

function formatPlainResultValue(value: DatabaseQueryValue): string {
  return value === null ? "NULL" : String(value);
}

function resolveResultColumnMetadata(
  column: ResultColumn,
  metadataTables: DatabaseTable[],
): { type: string; nullability: string; keyInfo: string } {
  const matches = metadataTables.flatMap((table) =>
    table.columns
      .filter((candidate) => candidate.name === column.label)
      .map((candidate) => candidate.metadata),
  );
  const metadata = matches[0] ?? [];
  const type =
    metadata.find((item) => item.label.toLowerCase() === "type")?.value ??
    column.databaseType ??
    "Unknown type";
  const nullability =
    metadata.find((item) => item.label.toLowerCase() === "null")?.value ??
    "Nullability unknown";
  const keyValue =
    metadata.find((item) => item.label.toLowerCase() === "key")?.value ??
    "None";
  return {
    type,
    nullability,
    keyInfo: keyValue === "PRI" ? "Primary key" : keyValue,
  };
}

function formatResultFooter(meta: ResultMeta): string {
  const affected =
    meta.rowsAffected !== undefined
      ? ` · ${meta.rowsAffected} ${pluralize("row", meta.rowsAffected)} affected`
      : "";
  return `${meta.rows} rows fetched${affected} · ${meta.duration}`;
}

function calculateResultColumnWidths({
  columns,
  panelWidth,
  stableColumnWidths,
  userColumnWidths,
}: {
  columns: ResultColumn[];
  panelWidth: number;
  stableColumnWidths: Partial<Record<ResultColumnKey, number>> | null;
  userColumnWidths: Partial<Record<ResultColumnKey, number>>;
}): Array<ResultColumn & { width: number }> {
  if (stableColumnWidths) {
    return columns.map((column) => ({
      ...column,
      width: normalizeColumnWidth(
        column,
        userColumnWidths[column.key] ?? stableColumnWidths[column.key],
      ),
    }));
  }

  const userSizedColumns = columns.filter(
    (column) => userColumnWidths[column.key] !== undefined,
  );
  const autoColumns = columns.filter(
    (column) => userColumnWidths[column.key] === undefined,
  );
  const userSizedTotal = userSizedColumns.reduce(
    (total, column) =>
      total + Math.max(column.minWidth, userColumnWidths[column.key] ?? 0),
    0,
  );
  const autoMinimumTotal = autoColumns.reduce(
    (total, column) => total + column.minWidth,
    0,
  );
  const fallbackPanelWidth = columns.reduce(
    (total, column) => total + column.minWidth * column.weight,
    0,
  );
  const availableWidth = Math.max(panelWidth || fallbackPanelWidth, 0);
  const autoAvailableWidth = Math.max(
    autoMinimumTotal,
    availableWidth - userSizedTotal,
  );
  const evenlyDistributeAutoColumns =
    autoColumns.length > 0 &&
    autoColumns.every((column) => column.kind === autoColumns[0].kind);
  const totalWeight = evenlyDistributeAutoColumns
    ? autoColumns.length
    : autoColumns.reduce((total, column) => total + column.weight, 0) || 1;

  return columns.map((column) => {
    const userWidth = userColumnWidths[column.key];
    if (userWidth !== undefined) {
      return { ...column, width: normalizeColumnWidth(column, userWidth) };
    }

    if (autoColumns.length === 0) {
      return {
        ...column,
        width: normalizeColumnWidth(column, column.minWidth),
      };
    }

    const weight = evenlyDistributeAutoColumns ? 1 : column.weight;
    return {
      ...column,
      width: normalizeColumnWidth(
        column,
        (autoAvailableWidth * weight) / totalWeight,
      ),
    };
  });
}

function normalizeColumnWidth(
  column: ResultColumn,
  width: number | undefined,
): number {
  return Math.max(column.minWidth, Math.round(width ?? column.minWidth));
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : word + "s";
}
