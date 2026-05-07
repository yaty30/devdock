import { useState, type ReactNode } from "react";
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
import type { DatabaseColumn, DatabaseTable } from "../../types";

export function ObjectTreeGroup({
  title,
  defaultOpen = false,
  onContextMenu,
  children,
}: {
  title: string | JSX.Element;
  defaultOpen?: boolean;
  onContextMenu?: (event: React.MouseEvent) => void;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="database-tree-group">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
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
  onContextMenu,
}: {
  table: DatabaseTable;
  onContextMenu: (event: React.MouseEvent) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="database-table-tree-item">
      <button
        className="database-tree-item database-tree-button database-object-row"
        type="button"
        onClick={() => setOpen((current) => !current)}
        onContextMenu={onContextMenu}
      >
        <ChevronDown size={14} className={open ? "open" : undefined} />
        <Table2 size={15} />
        <span className="database-object-label">{`${formatObjectName(table)}`}</span>
        <span className="database-object-count">{table.columns.length}</span>
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
          >
            {table.indexes.length > 0 ? (
              table.indexes.map((index) => (
                <div
                  className="database-tree-item database-object-row database-leaf-row"
                  key={index.name}
                >
                  <Leaf size={13} className="database-index" />
                  <span className="database-object-label">
                    {formatIndexLabel(index)}
                  </span>
                </div>
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
          >
            {table.triggers.length > 0 ? (
              table.triggers.map((trigger) => (
                <div
                  className="database-tree-item database-object-row database-leaf-row"
                  key={trigger.name}
                >
                  <Zap size={13} className="database-index-trigger" />
                  <span className="database-object-label">
                    {formatTriggerLabel(trigger)}
                  </span>
                </div>
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
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="database-table-object-group">
      <button
        className="database-tree-item database-table-object-group-button database-object-row"
        type="button"
        onClick={() => setOpen((current) => !current)}
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
