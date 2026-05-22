import type { CSSProperties, MouseEvent, ReactNode, Ref } from "react";

export type DataTableColumn<RowData = unknown> = {
  key: string;
  header: ReactNode;
  width?: number | string;
  align?: "left" | "center" | "right";
  headerClassName?: string;
  cellClassName?: string | ((row: RowData, index: number) => string | undefined);
  cellTitle?: string | ((row: RowData, index: number) => string | undefined);
  render?: (row: RowData, index: number) => ReactNode;
};

type DataTableProps<RowData = unknown> = {
  columns: DataTableColumn<RowData>[];
  children?: ReactNode;
  rows?: RowData[];
  getRowKey?: (row: RowData, index: number) => string;
  rowClassName?: string | ((row: RowData, index: number) => string | undefined);
  onRowClick?: (
    row: RowData,
    index: number,
    event: MouseEvent<HTMLTableRowElement>,
  ) => void;
  className?: string;
  scrollClassName?: string;
  tableClassName?: string;
  tableStyle?: CSSProperties;
  scrollRef?: Ref<HTMLDivElement>;
  emptyState?: ReactNode;
  footer?: ReactNode;
  rowCursor?: "default" | "pointer";
};

export function DataTable<RowData = unknown>({
  columns,
  children,
  rows,
  getRowKey,
  rowClassName,
  onRowClick,
  className = "",
  scrollClassName = "",
  tableClassName = "",
  tableStyle,
  scrollRef,
  emptyState,
  footer,
  rowCursor = "default",
}: DataTableProps<RowData>): JSX.Element {
  const tableClasses = [
    "data-table",
    rowCursor === "pointer" ? "data-table--interactive" : "",
    tableClassName,
  ]
    .filter(Boolean)
    .join(" ");
  const scrollClasses = ["data-table-scroll", scrollClassName]
    .filter(Boolean)
    .join(" ");
  const rootClasses = ["data-table-shell", className].filter(Boolean).join(" ");

  return (
    <div className={rootClasses}>
      <div className={scrollClasses} ref={scrollRef}>
        <table className={tableClasses} style={tableStyle}>
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={columnStyle(column.width)} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.headerClassName}
                  style={alignStyle(column.align)}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              ? rows.map((row, rowIndex) => (
                  <tr
                    key={getRowKey ? getRowKey(row, rowIndex) : rowIndex}
                    className={resolveClassName(rowClassName, row, rowIndex)}
                    onClick={
                      onRowClick
                        ? (event) => onRowClick(row, rowIndex, event)
                        : undefined
                    }
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={resolveClassName(
                          column.cellClassName,
                          row,
                          rowIndex,
                        )}
                        title={resolveTitle(column.cellTitle, row, rowIndex)}
                        style={alignStyle(column.align)}
                      >
                        {column.render ? column.render(row, rowIndex) : null}
                      </td>
                    ))}
                  </tr>
                ))
              : children}
          </tbody>
        </table>
        {emptyState}
      </div>
      {footer}
    </div>
  );
}

function columnStyle(width: DataTableColumn["width"]): CSSProperties | undefined {
  if (width === undefined) {
    return undefined;
  }
  return { width: typeof width === "number" ? `${width}px` : width };
}

function alignStyle(
  align: DataTableColumn["align"],
): CSSProperties | undefined {
  return align ? { textAlign: align } : undefined;
}

function resolveClassName<RowData>(
  className: DataTableColumn<RowData>["cellClassName"] | undefined,
  row: RowData,
  index: number,
): string | undefined {
  return typeof className === "function" ? className(row, index) : className;
}

function resolveTitle<RowData>(
  title: DataTableColumn<RowData>["cellTitle"] | undefined,
  row: RowData,
  index: number,
): string | undefined {
  return typeof title === "function" ? title(row, index) : title;
}