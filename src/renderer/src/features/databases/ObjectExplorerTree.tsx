import { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Carrot,
  ChevronDown,
  Columns3,
  Component,
  Cpu,
  GitBranch,
  Key,
  Leaf,
  Puzzle,
  Sigma,
  Table2,
  Zap,
} from "lucide-react";
import type {
  DatabaseColumn,
  DatabaseIndex,
  DatabaseTable,
  DatabaseTrigger,
} from "../../types";

export function ObjectTreeGroup({
  title,
  defaultOpen = false,
  forceOpen = false,
  onOpen,
  onContextMenu,
  children,
}: {
  title: string | JSX.Element;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  onOpen?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
    }
  }, [forceOpen]);

  return (
    <div className="database-tree-group">
      <button
        type="button"
        onClick={() =>
          setOpen((current) => {
            const nextOpen = !current;
            if (nextOpen) {
              onOpen?.();
            }
            return nextOpen;
          })
        }
        onContextMenu={onContextMenu}
      >
        <ChevronDown size={14} className={open ? "open" : undefined} />
        <span>{title}</span>
      </button>
      {open ? <div className="database-tree-children">{children}</div> : null}
    </div>
  );
}

export function TableTreeItem({
  table,
  activeObjectKey,
  onOpenTable,
  onOpenIndex,
  onOpenTrigger,
  onContextMenu,
  onIndexGroupContextMenu,
  onTriggerGroupContextMenu,
}: {
  table: DatabaseTable;
  activeObjectKey: string | null;
  onOpenTable: (table: DatabaseTable) => void;
  onOpenIndex: (table: DatabaseTable, index: DatabaseIndex) => void;
  onOpenTrigger: (table: DatabaseTable, trigger: DatabaseTrigger) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onIndexGroupContextMenu: (
    event: React.MouseEvent,
    table: DatabaseTable,
  ) => void;
  onTriggerGroupContextMenu: (
    event: React.MouseEvent,
    table: DatabaseTable,
  ) => void;
}): JSX.Element {
  const tableObjectKey = createObjectKey("table", table.schema, table.name);
  const hasActiveChild =
    activeObjectKey === tableObjectKey ||
    table.indexes.some(
      (index) =>
        activeObjectKey ===
        createObjectKey("index", table.schema, index.name, table.name),
    ) ||
    table.triggers.some(
      (trigger) =>
        activeObjectKey ===
        createObjectKey("trigger", table.schema, trigger.name, table.name),
    );
  const [open, setOpen] = useState(hasActiveChild);

  useEffect(() => {
    if (hasActiveChild) {
      setOpen(true);
    }
  }, [hasActiveChild]);

  return (
    <div className="database-table-tree-item">
      <button
        className={`database-tree-item database-tree-button database-object-row${
          activeObjectKey === tableObjectKey ? " active" : ""
        }`}
        type="button"
        onClick={() => setOpen((current) => !current)}
        onDoubleClick={() => onOpenTable(table)}
        onContextMenu={onContextMenu}
        data-database-object-key={tableObjectKey}
      >
        <ChevronDown size={14} className={open ? "open" : undefined} />
        <Table2 size={15} />
        <span className="database-object-label">{`${formatObjectName(table)}`}</span>
        {/* <span className="database-object-count" title="Estimated rows">
          {formatEstimatedRowCount(table.estimatedRowCount)}
        </span> */}
      </button>
      {open ? (
        <div className="database-table-object-groups">
          <TableObjectGroup
            title="Columns"
            count={table.columns.length}
            icon={<Columns3 size={13} />}
            defaultOpen
          >
            {table.columns.map((column) => (
              <ColumnTreeItem
                column={column}
                key={`${table.schema}.${table.name}.${column.name}`}
              />
            ))}
          </TableObjectGroup>
          <TableObjectGroup
            title="Index"
            count={table.indexes.length}
            icon={<Carrot size={13} className="database-indexes" />}
            defaultOpen
            onContextMenu={(event) => onIndexGroupContextMenu(event, table)}
          >
            {table.indexes.length > 0 ? (
              table.indexes.map((index) => (
                <button
                  type="button"
                  className={`database-tree-item database-object-row database-leaf-row${
                    activeObjectKey ===
                    createObjectKey(
                      "index",
                      table.schema,
                      index.name,
                      table.name,
                    )
                      ? " active"
                      : ""
                  }`}
                  key={index.name}
                  onClick={() => onOpenIndex(table, index)}
                  data-database-object-key={createObjectKey(
                    "index",
                    table.schema,
                    index.name,
                    table.name,
                  )}
                >
                  <Leaf size={13} className="database-index" />
                  <span className="database-object-label">
                    {formatIndexLabel(index)}
                  </span>
                </button>
              ))
            ) : (
              <div className="database-tree-empty">No indexes found</div>
            )}
          </TableObjectGroup>
          <TableObjectGroup
            title="Triggers"
            count={table.triggers.length}
            icon={<Sigma size={13} className="database-index-triggers" />}
            defaultOpen
            onContextMenu={(event) => onTriggerGroupContextMenu(event, table)}
          >
            {table.triggers.length > 0 ? (
              table.triggers.map((trigger) => (
                <button
                  type="button"
                  className={`database-tree-item database-object-row database-leaf-row${
                    activeObjectKey ===
                    createObjectKey(
                      "trigger",
                      table.schema,
                      trigger.name,
                      table.name,
                    )
                      ? " active"
                      : ""
                  }`}
                  key={trigger.name}
                  onClick={() => onOpenTrigger(table, trigger)}
                  data-database-object-key={createObjectKey(
                    "trigger",
                    table.schema,
                    trigger.name,
                    table.name,
                  )}
                >
                  <Zap size={13} className="database-index-trigger" />
                  <span className="database-object-label">
                    {formatTriggerLabel(trigger)}
                  </span>
                </button>
              ))
            ) : (
              <div className="database-tree-empty">No triggers found</div>
            )}
          </TableObjectGroup>
          <TableObjectGroup
            title="Partitions"
            count={table.partitions.length}
            icon={<Component size={13} />}
            defaultOpen
          >
            {table.partitions.length > 0 ? (
              table.partitions.map((partition) => (
                <div
                  className="database-tree-item database-object-row database-leaf-row"
                  key={partition.name}
                >
                  <Box size={13} />
                  <span className="database-object-label">
                    {formatPartitionLabel(partition)}
                  </span>
                </div>
              ))
            ) : (
              <div className="database-tree-empty">No partitions found</div>
            )}
          </TableObjectGroup>
        </div>
      ) : null}
    </div>
  );
}

function TableObjectGroup({
  title,
  count,
  icon,
  defaultOpen = false,
  onContextMenu,
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  defaultOpen?: boolean;
  onContextMenu?: (event: React.MouseEvent) => void;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="database-table-object-group">
      <button
        className="database-tree-item database-table-object-group-button database-object-row"
        type="button"
        onClick={() => setOpen((current) => !current)}
        onContextMenu={onContextMenu}
      >
        <ChevronDown size={13} className={open ? "open" : undefined} />
        {icon}
        <span className="database-object-label">{title}</span>
        <span className="database-object-count">{count}</span>
      </button>
      {open ? <div className="database-nested-children">{children}</div> : null}
    </div>
  );
}

export function createObjectKey(
  objectType: string,
  schema: string,
  name: string,
  tableName = "",
): string {
  return [objectType, schema, tableName, name].join(":").toLowerCase();
}

function formatEstimatedRowCount(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count)) {
    return "?";
  }

  return `${Intl.NumberFormat(undefined, { notation: "compact" }).format(count)}`;
}

function ColumnTreeItem({ column }: { column: DatabaseColumn }): JSX.Element {
  const [open, setOpen] = useState(false);
  const hasMetadata = column.metadata.length > 0;

  return (
    <div className="database-column-tree-item">
      <button
        className="database-tree-item database-column-button"
        type="button"
        onClick={() => {
          if (hasMetadata) {
            setOpen((current) => !current);
          }
        }}
      >
        {hasMetadata ? (
          <ChevronDown size={13} className={open ? "open" : undefined} />
        ) : (
          <span className="database-tree-indent" />
        )}

        {hasMetadata &&
        column.metadata.find((m) => m.label === "Key" && m.value === "PRI") ? (
          <Key
            size={13}
            className="database-tree-column-metadata primary-key"
          />
        ) : hasMetadata &&
          column.metadata.find(
            (m) => m.label === "Key" && m.value === "FOR",
          ) ? (
          <GitBranch
            size={13}
            className="database-tree-column-metadata foreign-key"
          />
        ) : (
          <Cpu
            size={13}
            className={
              hasMetadata &&
              column.metadata.find(
                (m) => m.label === "Null" && m.value === "Nullable",
              )
                ? "database-tree-column-metadata nullable"
                : "database-tree-column-metadata not-nullable"
            }
          />
        )}

        <span>{column.name}</span>
        {hasMetadata && (
          <strong>
            {column.metadata.find((m) => m.label === "Type")?.value}
          </strong>
        )}
      </button>
      {open && hasMetadata ? (
        <div className="database-column-metadata">
          {column.metadata.map((metadata) => (
            <div
              className="database-tree-item database-column-metadata-item"
              key={`${column.name}-${metadata.label}`}
            >
              <Puzzle size={12} />
              <span>{metadata.label}</span>
              <span className="metadata-pill-value">{metadata.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatObjectName(table: DatabaseTable): string {
  return table.schema ? `${table.name}` : table.name;
}

function formatIndexLabel(index: DatabaseTable["indexes"][number]): string {
  const columns =
    index.columns.length > 0 ? index.columns.join(", ") : "(expression)";
  return `${index.name} ${columns} ${index.type || "INDEX"}`;
}

function formatTriggerLabel(
  trigger: DatabaseTable["triggers"][number],
): string {
  return [trigger.name, trigger.timing, trigger.event]
    .filter(Boolean)
    .join(" ");
}

function formatPartitionLabel(
  partition: DatabaseTable["partitions"][number],
): string {
  return [
    partition.name,
    partition.method,
    partition.expression ? `(${partition.expression})` : "",
    partition.description,
  ]
    .filter(Boolean)
    .join(" ");
}
