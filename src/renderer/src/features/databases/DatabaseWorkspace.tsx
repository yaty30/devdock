import {
  Fragment,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  autocompletion,
  acceptCompletion,
  completionStatus,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap } from "@codemirror/commands";
import { sql } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  EditorState,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import {
  ArrowLeftRight,
  BetweenHorizonalStart,
  Box,
  Braces,
  Carrot,
  ChevronDown,
  ChevronRight,
  Columns3,
  Component,
  Cpu,
  Database,
  Eye,
  EyeOff,
  File,
  FileText,
  Ghost,
  GitBranch,
  GitCompare,
  Key,
  Leaf,
  LoaderCircle,
  Maximize2,
  Microchip,
  Play,
  Puzzle,
  RefreshCcw,
  Share,
  Sigma,
  SquareFunction,
  SquareMousePointer,
  Table2,
  Trash2,
  View,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { Panel } from "../../components/common/Panel";
import {
  AppSelect,
  type AppSelectOption,
} from "../../components/common/AppSelect";
import { ConfirmDialog } from "../../components/dialogs/ConfirmDialog";
import { Modal } from "../../components/dialogs/Modal";
import type {
  DatabaseConnection,
  DatabaseConnectionType,
  DatabaseColumn,
  DatabaseExecutionRecord,
  DatabaseIndex,
  DatabaseMetadata,
  DatabaseObjectCollectionName,
  DatabaseQueryValue,
  DatabaseSslMode,
  DatabaseStatementExecutionResult,
  DatabaseTable,
  DatabaseTrigger,
  DatabaseWorksheet,
  DatabaseWorksheetState,
  DatabaseWorkspaceTab,
  OracleConnectionMode,
} from "../../types";
import { clamp } from "../../utils/math";
import { DatabaseMonitor, StatusPill } from "./DatabaseMonitor";
import { ResultTabsPanel } from "./DatabaseResults";
import { formatCompactTime, formatSqlForDisplay } from "./databaseFormatters";
import { MessageLog } from "./MessageLog";
import {
  ObjectTreeGroup,
  TableTreeItem,
  createObjectKey,
} from "./ObjectExplorerTree";
import { ResultExportMenu } from "./ResultExportMenu";
import { SheetContextMenuView } from "./SheetContextMenuView";
import {
  SqlEditor,
  createDatabaseCompletionData,
  getExecutionTarget,
  setExecutedSqlRange,
} from "./SqlEditor";
import {
  appendSqlStatement,
  createBatchMessages,
  createEmptyMetadata,
  createEmptySheetOutput,
  createExecutionHistoryMessage,
  createIdleMetadataState,
  createInitialSheetState,
  createInsertTemplate,
  limitSelectTemplate,
  createLoadingMetadataState,
  createQuerySheet,
  createResultTabs,
  createSelectTemplate,
  ensureSqlTerminator,
  fetchDatabaseMetadata,
  formatDurationMs,
  formatObjectName,
  hasSuccessfulRowCountChange,
  hasSuccessfulSchemaChange,
  isPersistableSheet,
  markWorksheetStateSnapshotSaved,
  nextHistorySheetName,
  nextUntitledName,
  persistSavedWorksheetState,
  prependSheetMessage,
  selectInitialResultTabId,
  sheetStateFromPersisted,
  splitSqlStatements,
  worksheetStateNeedsPersist,
} from "./databaseWorkspaceUtils";

export type DatabaseObjectType =
  | "table"
  | "view"
  | "procedure"
  | "function"
  | "type"
  | "sequence"
  | "package"
  | "trigger"
  | "index";

export type QuerySheet = {
  id: string;
  name: string;
  sql: string;
  savedName: string;
  savedSql: string;
  savedAt: string | null;
  output: SheetOutputState;
  savedOrder: number | null;
  sheetMode?: "normal" | "object-backed" | "transient-preview";
  objectBinding?: {
    connectionId: string;
    objectType: DatabaseObjectType;
    schema: string;
    name: string;
    tableName?: string;
    isNew?: boolean;
  };
};

export type SheetOutputTab = "results" | "messages";

export type SheetOutputState = {
  hasExecuted: boolean;
  activeOutputTab: SheetOutputTab;
  resultTabs: ResultTab[];
  activeResultTabId: string | null;
  messages: MessageEntry[];
  lastExecutionTarget: LastExecutionTarget | null;
};

export type SheetConnectionState = {
  sheets: QuerySheet[];
  activeSheetId: string;
  openSheetIds: string[];
};

export type SheetContextMenu =
  | { kind: "sheets"; x: number; y: number }
  | { kind: "sheet"; sheetId: string; x: number; y: number }
  | { kind: "table"; table: DatabaseTable; x: number; y: number }
  | {
      kind: "object-group";
      objectType: DatabaseObjectType;
      table?: DatabaseTable;
      x: number;
      y: number;
    };

export type HistoryRerunRequest = {
  id: string;
  record: DatabaseExecutionRecord;
};

export type ResultRow = Record<string, DatabaseQueryValue>;

export type ResultMeta = {
  hasRun: boolean;
  rows: number;
  duration: string;
  queriedAt: string;
  status: "success" | "error";
  errorMessage?: string;
  rowsAffected?: number;
};

export type ResultPaginationState = {
  baseSql: string;
  nextOffset: number;
  pageSize: number;
  hasMore: boolean;
  loading: boolean;
  errorMessage?: string;
};

export type MessageEntry = {
  id: string;
  tone: "success" | "error";
  text: string;
  time: string;
};

export type DatabaseMetadataState =
  | { status: "idle"; metadata: DatabaseMetadata; errorMessage?: undefined }
  | { status: "loading"; metadata: DatabaseMetadata; errorMessage?: undefined }
  | { status: "loaded"; metadata: DatabaseMetadata; errorMessage?: undefined }
  | { status: "error"; metadata: DatabaseMetadata; errorMessage: string };

export type DatabaseDragState = {
  startX: number;
  startExplorerWidth: number;
  minExplorerWidth: number;
  maxExplorerWidth: number;
};

export type DatabaseEditorDragState = {
  startY: number;
  startEditorHeight: number;
  minEditorHeight: number;
  maxEditorHeight: number;
};

export type ExecutionTarget = {
  sql: string;
  from: number;
  to: number;
};

export type LastExecutionTarget = ExecutionTarget & {
  sheetId: string;
};

export type SheetDeleteRequest = {
  sheetId: string;
  sheetName: string;
};

export type SheetCloseRequest = {
  sheetId: string;
  sheetName: string;
};

export type ResultColumnKey = string;

export type ResultColumn = {
  key: ResultColumnKey;
  label: string;
  databaseType?: string;
  kind: "number" | "text" | "date" | "unknown";
  minWidth: number;
  weight: number;
};

export type ResultTab = {
  id: string;
  name: string;
  statementSql: string;
  rows: ResultRow[];
  columns: ResultColumn[];
  meta: ResultMeta;
  page: number;
  pageSize: number;
  columnWidths: Partial<Record<ResultColumnKey, number>>;
  pagination?: ResultPaginationState;
};

export type DatabaseCompletionData = {
  keywords: string[];
  tables: string[];
  columns: string[];
};

const DATABASE_EXPLORER_MIN_WIDTH = 220;
const DATABASE_EXPLORER_MAX_WIDTH = 420;
const DATABASE_QUERY_MIN_WIDTH = 600;
const DATABASE_SPLITTER_SIZE = 16;
const DEFAULT_EXPLORER_WIDTH = 320;
const WORKSHEET_AUTO_SAVE_DELAY_MS = 1500;
const DEFAULT_EDITOR_HEIGHT = 260;
const DATABASE_EDITOR_MIN_HEIGHT = 160;
const DATABASE_OUTPUT_MIN_HEIGHT = 160;
const DATABASE_EDITOR_SPLITTER_SIZE = 14;
const SELECT_INCREMENTAL_PAGE_SIZE = 50;
const ORACLE_LAZY_OBJECT_COLLECTIONS = [
  "views",
  "procedures",
  "functions",
  "types",
  "sequences",
  "packages",
] as const;

type OracleLazyObjectCollection =
  (typeof ORACLE_LAZY_OBJECT_COLLECTIONS)[number];

const OBJECT_TYPE_BY_COLLECTION: Record<
  OracleLazyObjectCollection,
  DatabaseObjectType
> = {
  views: "view",
  procedures: "procedure",
  functions: "function",
  types: "type",
  sequences: "sequence",
  packages: "package",
};

const databaseSheetStateCache: Record<string, SheetConnectionState> = {};

export function DatabaseWorkspaceTabs({
  connectionName,
  activeTab,
  onTabChange,
}: {
  connectionName: string;
  activeTab: DatabaseWorkspaceTab;
  onTabChange: (tab: DatabaseWorkspaceTab) => void;
}): JSX.Element {
  return (
    <div
      className="tabs database-workspace-tabs"
      role="tablist"
      aria-label="Database workspace"
    >
      <button
        className={`tab${activeTab === "connection" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeTab === "connection"}
        onClick={() => onTabChange("connection")}
      >
        {connectionName}
      </button>
      <button
        className={`tab${activeTab === "monitor" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeTab === "monitor"}
        onClick={() => onTabChange("monitor")}
      >
        Monitor
      </button>
    </div>
  );
}

function moveSheetToTarget(
  sheets: QuerySheet[],
  draggedSheetId: string,
  targetSheetId: string,
): QuerySheet[] {
  const fromIndex = sheets.findIndex((sheet) => sheet.id === draggedSheetId);
  const toIndex = sheets.findIndex((sheet) => sheet.id === targetSheetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return sheets;
  }

  const nextSheets = [...sheets];
  const [movedSheet] = nextSheets.splice(fromIndex, 1);
  nextSheets.splice(toIndex, 0, movedSheet);
  return nextSheets;
}

function sortOpenSheetIdsBySheetOrder(
  openSheetIds: string[],
  sheets: QuerySheet[],
): string[] {
  const openSet = new Set(openSheetIds);
  return sheets
    .filter((sheet) => openSet.has(sheet.id))
    .map((sheet) => sheet.id);
}

type ObjectBinding = NonNullable<QuerySheet["objectBinding"]>;

function parseDatabaseObjectName(
  value: string,
  fallbackSchema: string,
): { schema: string; name: string } {
  const parts = splitQualifiedName(value.trim());
  if (parts.length >= 2) {
    return {
      schema: normalizeIdentifier(parts[parts.length - 2]),
      name: normalizeIdentifier(parts[parts.length - 1]),
    };
  }

  return {
    schema: normalizeIdentifier(fallbackSchema),
    name: normalizeIdentifier(parts[0] ?? ""),
  };
}

function splitQualifiedName(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inBacktick = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "`") {
      inBacktick = !inBacktick;
      current += char;
      continue;
    }
    if (char === "." && !inBacktick) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current || parts.length > 0) {
    parts.push(current);
  }
  return parts.filter((part) => part.trim().length > 0);
}

function normalizeIdentifier(value: string): string {
  const trimmed = value.trim().replace(/;$/, "");
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1).replace(/``/g, "`");
  }
  return trimmed;
}

function quoteSqlIdentifier(
  value: string,
  connectionType: DatabaseConnectionType,
): string {
  if (connectionType === "Oracle") {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }

  return `\`${value.replace(/`/g, "``")}\``;
}

function formatQualifiedIdentifier(
  schema: string,
  name: string,
  connectionType: DatabaseConnectionType,
): string {
  return schema
    ? `${quoteSqlIdentifier(schema, connectionType)}.${quoteSqlIdentifier(name, connectionType)}`
    : quoteSqlIdentifier(name, connectionType);
}

function formatObjectEditorName(
  objectType: DatabaseObjectType,
  schema: string,
  name: string,
  tableName?: string,
  isNew = false,
): string {
  if (isNew || !name) {
    return tableName
      ? `New ${objectType} on ${tableName}`
      : `New ${objectType}`;
  }

  if (objectType === "index" && tableName) {
    return schema ? `${schema}.${tableName}.${name}` : `${tableName}.${name}`;
  }

  return schema ? `${schema}.${name}` : name;
}

function createObjectTemplate(
  objectType: DatabaseObjectType,
  connectionType: DatabaseConnectionType,
  table?: DatabaseTable,
): string {
  const tableName = table
    ? formatQualifiedIdentifier(table.schema, table.name, connectionType)
    : "table_name";
  const templates: Record<DatabaseObjectType, string> = {
    table: limitSelectTemplate(`SELECT *\nFROM ${tableName};`, connectionType, 100),
    view: "CREATE OR REPLACE VIEW __object_name__\nAS\nSELECT *\nFROM table_name;",
    procedure:
      "DELIMITER //\n\nCREATE PROCEDURE __object_name__()\nBEGIN\n\nEND //\n\nDELIMITER ;",
    function:
      "DELIMITER //\n\nCREATE FUNCTION __object_name__() RETURNS int\nREADS SQL DATA\nBEGIN\n  RETURN 0;\nEND //\n\nDELIMITER ;",
    type: "CREATE OR REPLACE TYPE __object_name__ AS OBJECT (\n\n);",
    sequence: "CREATE SEQUENCE __object_name__ START WITH 1 INCREMENT BY 1;",
    package:
      "CREATE OR REPLACE PACKAGE __object_name__ AS\n\nEND __object_name__;",
    trigger: `DELIMITER //\n\nCREATE TRIGGER __object_name__\nBEFORE INSERT ON ${tableName}\nFOR EACH ROW\nBEGIN\n\nEND //\n\nDELIMITER ;`,
    index: `ALTER TABLE ${tableName} ADD INDEX __object_name__ (column_name);`,
  };
  return templates[objectType];
}

function findCreateStatement(
  row: Record<string, unknown> | undefined,
  objectType: DatabaseObjectType,
): string {
  if (!row) {
    return "";
  }

  const preferredKeys: Record<DatabaseObjectType, string[]> = {
    table: [],
    index: [],
    view: ["DDL", "Create View"],
    procedure: ["DDL", "Create Procedure"],
    function: ["DDL", "Create Function"],
    type: ["DDL"],
    sequence: ["DDL"],
    package: ["DDL"],
    trigger: ["DDL", "SQL Original Statement", "Create Trigger"],
  };
  const entries = Object.entries(row);
  for (const preferredKey of preferredKeys[objectType]) {
    const match = entries.find(
      ([key]) => key.toLowerCase() === preferredKey.toLowerCase(),
    );
    if (match?.[1]) {
      return String(match[1]);
    }
  }

  const fallback = entries.find(([key]) => /create|statement|ddl/i.test(key));
  return fallback?.[1] ? String(fallback[1]) : "";
}

function formatLoadedObjectSql(
  objectType: DatabaseObjectType,
  createSql: string,
): string {
  if (objectType === "view") {
    return createSql.replace(/^CREATE\s+VIEW/i, "CREATE OR REPLACE VIEW");
  }

  if (
    objectType === "procedure" ||
    objectType === "function" ||
    objectType === "type" ||
    objectType === "package" ||
    objectType === "trigger"
  ) {
    return `DELIMITER //\n\n${createSql} //\n\nDELIMITER ;`;
  }

  return createSql;
}

function applyObjectNameToTemplate(
  sql: string,
  objectType: DatabaseObjectType,
  schema: string,
  name: string,
  connectionType: DatabaseConnectionType,
): string {
  const qualifiedName = formatQualifiedIdentifier(schema, name, connectionType);
  const localName = quoteSqlIdentifier(name, connectionType);
  const replacement = objectType === "index" ? localName : qualifiedName;
  const placeholderPatterns: Record<DatabaseObjectType, RegExp[]> = {
    table: [],
    view: [/__object_name__/g, /\bview_name\b/g],
    procedure: [/__object_name__/g, /\bproc_name\b/g],
    function: [/__object_name__/g, /\bfun_name\b/g],
    type: [/__object_name__/g, /\btype_name\b/g],
    sequence: [/__object_name__/g, /\bsequence_name\b/g],
    package: [/__object_name__/g, /\bpackage_name\b/g],
    trigger: [/__object_name__/g, /\btrigger_name\b/g],
    index: [/__object_name__/g, /\bindex_name\b/g],
  };

  return placeholderPatterns[objectType].reduce(
    (nextSql, pattern) => nextSql.replace(pattern, replacement),
    sql,
  );
}

function createObjectSaveSql(
  binding: ObjectBinding,
  sql: string,
  isNew: boolean,
  connectionType: DatabaseConnectionType,
): string {
  if (isNew || binding.objectType === "view") {
    return sql;
  }

  const qualifiedName = formatQualifiedIdentifier(
    binding.schema,
    binding.name,
    connectionType,
  );
  if (
    binding.objectType === "procedure" ||
    binding.objectType === "function" ||
    binding.objectType === "type" ||
    binding.objectType === "sequence" ||
    binding.objectType === "package"
  ) {
    return `DROP ${binding.objectType.toUpperCase()} IF EXISTS ${qualifiedName};\n${sql}`;
  }
  if (binding.objectType === "trigger") {
    return `DROP TRIGGER IF EXISTS ${qualifiedName};\n${sql}`;
  }
  if (binding.objectType === "index" && binding.tableName) {
    const qualifiedTable = formatQualifiedIdentifier(
      binding.schema,
      binding.tableName,
      connectionType,
    );
    if (binding.name.toUpperCase() === "PRIMARY") {
      return `ALTER TABLE ${qualifiedTable} DROP PRIMARY KEY;\n${sql}`;
    }
    return `ALTER TABLE ${qualifiedTable} DROP INDEX ${quoteSqlIdentifier(
      binding.name,
      connectionType,
    )};\n${sql}`;
  }

  return sql;
}

function createIndexDefinitionSql(
  table: DatabaseTable,
  index: DatabaseIndex,
  connectionType: DatabaseConnectionType,
): string {
  const qualifiedTable = formatQualifiedIdentifier(
    table.schema,
    table.name,
    connectionType,
  );
  const columns = index.columns.length
    ? index.columns
        .map((column) => quoteSqlIdentifier(column, connectionType))
        .join(", ")
    : "column_name";
  if (index.name.toUpperCase() === "PRIMARY") {
    return `ALTER TABLE ${qualifiedTable} ADD PRIMARY KEY (${columns});`;
  }

  return `ALTER TABLE ${qualifiedTable} ADD INDEX ${quoteSqlIdentifier(
    index.name,
    connectionType,
  )} (${columns});`;
}

function splitSqlStatementsWithDelimiters(sqlText: string): string[] {
  if (!/^\s*DELIMITER\s+/im.test(sqlText)) {
    return splitSqlStatements(sqlText);
  }

  const statements: string[] = [];
  const lines = sqlText.split(/\r?\n/);
  let delimiter = ";";
  let buffer = "";

  for (const line of lines) {
    const delimiterMatch = line.match(/^\s*DELIMITER\s+(.+)\s*$/i);
    if (delimiterMatch) {
      delimiter = delimiterMatch[1].trim();
      continue;
    }

    buffer = buffer ? `${buffer}\n${line}` : line;
    const trimmedBuffer = buffer.trimEnd();
    if (trimmedBuffer.endsWith(delimiter)) {
      const statement = trimmedBuffer.slice(0, -delimiter.length).trim();
      if (statement) {
        statements.push(statement);
      }
      buffer = "";
    }
  }

  const tail = buffer.trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
}

function normalizeExecutableStatement(statement: string): string {
  return statement.trim().replace(/;+\s*$/u, "");
}

function isIncrementallyPageableSelect(
  statement: string,
  connectionType: DatabaseConnectionType,
): boolean {
  const normalized = normalizeExecutableStatement(statement);
  if (!/^(?:\(\s*)?(?:select|with)\b/iu.test(normalized)) {
    return false;
  }
  if (/\bfor\s+update\b/iu.test(normalized)) {
    return false;
  }
  if (connectionType === "MySQL") {
    return !/\blimit\b/iu.test(normalized);
  }
  return !/(\bfetch\s+(?:first|next)\b|\boffset\b|\brownum\b)/iu.test(
    normalized,
  );
}

function createIncrementalSelectStatement({
  statement,
  connectionType,
  offset,
  pageSize,
}: {
  statement: string;
  connectionType: DatabaseConnectionType;
  offset: number;
  pageSize: number;
}): string {
  const normalized = normalizeExecutableStatement(statement);
  if (connectionType === "MySQL") {
    return `${normalized} LIMIT ${pageSize} OFFSET ${offset}`;
  }
  return `${normalized} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
}

function prepareIncrementalExecutionStatements(
  statements: string[],
  connectionType: DatabaseConnectionType,
): { executionStatements: string[]; pageableStatements: boolean[] } {
  const pageableStatements = statements.map((statement) =>
    isIncrementallyPageableSelect(statement, connectionType),
  );
  return {
    executionStatements: statements.map((statement, index) =>
      pageableStatements[index]
        ? createIncrementalSelectStatement({
            statement,
            connectionType,
            offset: 0,
            pageSize: SELECT_INCREMENTAL_PAGE_SIZE,
          })
        : statement,
    ),
    pageableStatements,
  };
}

function withLogicalStatements(
  results: DatabaseStatementExecutionResult[],
  statements: string[],
): DatabaseStatementExecutionResult[] {
  return results.map((result, index) => ({
    ...result,
    statement: statements[index] ?? result.statement,
  }));
}

function applyInitialResultPagination(
  tabs: ResultTab[],
  statements: string[],
  pageableStatements: boolean[],
): ResultTab[] {
  return tabs.map((tab, index) => {
    if (!pageableStatements[index] || tab.meta.status !== "success") {
      return tab;
    }
    return {
      ...tab,
      pagination: {
        baseSql: statements[index] ?? tab.statementSql,
        nextOffset: tab.rows.length,
        pageSize: SELECT_INCREMENTAL_PAGE_SIZE,
        hasMore: tab.rows.length === SELECT_INCREMENTAL_PAGE_SIZE,
        loading: false,
      },
    };
  });
}

function escapeSqlStringLiteral(value: string): string {
  return value.replace(/'/gu, "''");
}

function createOracleObjectDefinitionStatement(
  objectType: DatabaseObjectType,
  objectName: string,
  schemaName: string,
): string {
  const ddlTypeByObject: Partial<Record<DatabaseObjectType, string>> = {
    view: "VIEW",
    procedure: "PROCEDURE",
    function: "FUNCTION",
    type: "TYPE",
    sequence: "SEQUENCE",
    package: "PACKAGE",
    trigger: "TRIGGER",
  };
  const ddlType = ddlTypeByObject[objectType];
  if (!ddlType) {
    return "";
  }
  return `SELECT DBMS_METADATA.GET_DDL('${ddlType}', '${escapeSqlStringLiteral(
    objectName,
  )}', '${escapeSqlStringLiteral(schemaName)}') AS DDL FROM DUAL`;
}

export function DatabaseWorkspace({
  connection,
  databaseStatus,
  activeTab,
  onTabChange,
  executionHistory,
  queryCount,
  lastRefreshTime,
  onExecution,
  onRefresh,
  onSheetSaved,
  deletedConnectionId,
}: {
  connection: DatabaseConnection;
  databaseStatus:
    | "idle"
    | "connecting"
    | "connected"
    | "sleeping"
    | "disconnected"
    | "reconnecting"
    | "error";
  activeTab: DatabaseWorkspaceTab;
  onTabChange: (tab: DatabaseWorkspaceTab) => void;
  executionHistory: DatabaseExecutionRecord[];
  queryCount: number;
  lastRefreshTime: string;
  onExecution: (record: DatabaseExecutionRecord) => void;
  onRefresh: () => void;
  onSheetSaved: () => void;
  deletedConnectionId?: string | null;
}): JSX.Element {
  const [rerunRequest, setRerunRequest] = useState<HistoryRerunRequest | null>(
    null,
  );

  return (
    <section className="database-screen resizable-panel-screen">
      <div
        className={`database-workspace-view${activeTab === "connection" ? " active" : ""}`}
      >
        <ConnectionActionWorkspace
          connection={connection}
          databaseStatus={databaseStatus}
          onExecution={onExecution}
          onRefresh={onRefresh}
          onSheetSaved={onSheetSaved}
          deletedConnectionId={deletedConnectionId}
          rerunRequest={rerunRequest}
        />
      </div>
      <div
        className={`database-workspace-view${activeTab === "monitor" ? " active" : ""}`}
      >
        <DatabaseMonitor
          connection={connection}
          executionHistory={executionHistory}
          queryCount={queryCount}
          lastRefreshTime={lastRefreshTime}
          onRerun={(record) => {
            if (record.status !== "success") {
              return;
            }

            setRerunRequest({ id: `${record.id}-${Date.now()}`, record });
            onTabChange("connection");
          }}
        />
      </div>
    </section>
  );
}

function ConnectionActionWorkspace({
  connection,
  databaseStatus,
  onExecution,
  onRefresh,
  onSheetSaved,
  deletedConnectionId,
  rerunRequest,
}: {
  connection: DatabaseConnection;
  databaseStatus:
    | "idle"
    | "connecting"
    | "connected"
    | "sleeping"
    | "disconnected"
    | "reconnecting"
    | "error";
  onExecution: (record: DatabaseExecutionRecord) => void;
  onRefresh: () => void;
  onSheetSaved: () => void;
  deletedConnectionId?: string | null;
  rerunRequest: HistoryRerunRequest | null;
}): JSX.Element {
  const initialSheet = useMemo(() => createQuerySheet("Untitled-1"), []);
  const gridRef = useRef<HTMLDivElement>(null);
  const objectTreeRef = useRef<HTMLDivElement>(null);
  const queryPanelRef = useRef<HTMLElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const executingRef = useRef(false);
  const loadingMoreTabsRef = useRef<Set<string>>(new Set());
  const dragRef = useRef<DatabaseDragState | null>(null);
  const editorDragRef = useRef<DatabaseEditorDragState | null>(null);
  const latestSheetStateRef = useRef<SheetConnectionState | null>(null);
  const loadedWorksheetConnectionIdsRef = useRef<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [sheetStateByConnection, setSheetStateByConnection] = useState<
    Record<string, SheetConnectionState>
  >(() => {
    const cachedState = databaseSheetStateCache[connection.id];
    return {
      [connection.id]: cachedState ?? {
        sheets: [initialSheet],
        activeSheetId: initialSheet.id,
        openSheetIds: [initialSheet.id],
      },
    };
  });
  const [contextMenu, setContextMenu] = useState<SheetContextMenu | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<SheetDeleteRequest | null>(
    null,
  );
  const [closeRequest, setCloseRequest] = useState<SheetCloseRequest | null>(
    null,
  );
  const [renamingSheetId, setRenamingSheetId] = useState<string | null>(null);
  const [draggingSheetId, setDraggingSheetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [explorerWidth, setExplorerWidth] = useState(DEFAULT_EXPLORER_WIDTH);
  const [editorHeight, setEditorHeight] = useState(DEFAULT_EDITOR_HEIGHT);
  const [isExecuting, setIsExecuting] = useState(false);
  const [resultFullscreenOpen, setResultFullscreenOpen] = useState(false);
  const [metadataStateByConnection, setMetadataStateByConnection] = useState<
    Record<string, DatabaseMetadataState>
  >({});
  const [loadingObjectCollections, setLoadingObjectCollections] = useState<
    Record<string, boolean>
  >({});
  const [selectedSchemaByConnection, setSelectedSchemaByConnection] = useState<
    Record<string, string>
  >(() => ({
    [connection.id]: connection.database || connection.schema || "",
  }));
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  const [loadedWorksheetConnectionIds, setLoadedWorksheetConnectionIds] =
    useState<Set<string>>(() => new Set());
  const persistedWorksheetTimerRef = useRef<number | null>(null);
  const handledRerunRequestIdRef = useRef<string | null>(null);
  const metadataLoadStartedRef = useRef<Set<string>>(new Set());
  const activeMetadataLoadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setSheetStateByConnection((current) => {
      if (current[connection.id]?.sheets.length) {
        return current;
      }

      const cachedState = databaseSheetStateCache[connection.id];
      if (cachedState?.sheets.length) {
        return {
          ...current,
          [connection.id]: cachedState,
        };
      }

      const sheet = createQuerySheet("Untitled-1", "");
      return {
        ...current,
        [connection.id]: {
          sheets: [sheet],
          activeSheetId: sheet.id,
          openSheetIds: [sheet.id],
        },
      };
    });
    setSelectedSchemaByConnection((current) =>
      current[connection.id] !== undefined
        ? current
        : {
            ...current,
            [connection.id]: connection.database || connection.schema || "",
          },
    );
  }, [connection.id]);

  useEffect(() => {
    if (loadedWorksheetConnectionIds.has(connection.id)) {
      return undefined;
    }

    if (databaseSheetStateCache[connection.id]?.sheets.length) {
      setLoadedWorksheetConnectionIds((current) =>
        new Set(current).add(connection.id),
      );
      return undefined;
    }

    let cancelled = false;
    void window.ivsDashboard
      .getDatabaseWorksheetState(connection.id)
      .then((persistedState) => {
        if (cancelled) {
          return;
        }

        setLoadedWorksheetConnectionIds((current) =>
          new Set(current).add(connection.id),
        );
        if (persistedState.sheets.length === 0) {
          return;
        }

        setSheetStateByConnection((current) => ({
          ...current,
          [connection.id]: sheetStateFromPersisted(persistedState),
        }));
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setLoadedWorksheetConnectionIds((current) =>
            new Set(current).add(connection.id),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connection.id, loadedWorksheetConnectionIds]);

  useEffect(() => {
    if (!deletedConnectionId) {
      return;
    }

    setSheetStateByConnection((current) => {
      const next = { ...current };
      delete next[deletedConnectionId];
      return next;
    });
    setMetadataStateByConnection((current) => {
      const next = { ...current };
      delete next[deletedConnectionId];
      return next;
    });
    setLoadedWorksheetConnectionIds((current) => {
      const next = new Set(current);
      next.delete(deletedConnectionId);
      return next;
    });
    delete databaseSheetStateCache[deletedConnectionId];
    setSelectedSchemaByConnection((current) => {
      const next = { ...current };
      delete next[deletedConnectionId];
      return next;
    });
    for (const key of metadataLoadStartedRef.current) {
      if (key.startsWith(`${deletedConnectionId}:`)) {
        metadataLoadStartedRef.current.delete(key);
      }
    }
    if (
      activeMetadataLoadKeyRef.current?.startsWith(`${deletedConnectionId}:`)
    ) {
      activeMetadataLoadKeyRef.current = null;
    }
  }, [deletedConnectionId]);

  useEffect(() => {
    return () => {
      if (persistedWorksheetTimerRef.current !== null) {
        window.clearTimeout(persistedWorksheetTimerRef.current);
        persistedWorksheetTimerRef.current = null;
      }

      const latestState = latestSheetStateRef.current;
      if (
        latestState &&
        loadedWorksheetConnectionIdsRef.current.has(connection.id) &&
        worksheetStateNeedsPersist(latestState)
      ) {
        databaseSheetStateCache[connection.id] = latestState;
        void persistSavedWorksheetState(connection.id, latestState).catch(
          (error) => console.error(error),
        );
      }
    };
  }, [connection.id]);

  const selectedSchema =
    selectedSchemaByConnection[connection.id] ??
    connection.database ??
    connection.schema ??
    "";
  const effectiveConnection = useMemo(
    () => ({
      ...connection,
      schema: selectedSchema || connection.schema,
      database: selectedSchema || connection.database,
    }),
    [connection, selectedSchema],
  );

  useEffect(() => {
    if (databaseStatus !== "connected" && databaseStatus !== "reconnecting") {
      return;
    }

    const metadataLoadKey = `${connection.id}:${selectedSchema}`;
    if (metadataLoadStartedRef.current.has(metadataLoadKey)) {
      return;
    }

    metadataLoadStartedRef.current.add(metadataLoadKey);
    activeMetadataLoadKeyRef.current = metadataLoadKey;
    setMetadataStateByConnection((current) => ({
      ...current,
      [connection.id]: createLoadingMetadataState(
        current[connection.id]?.metadata,
      ),
    }));

    void fetchDatabaseMetadata(effectiveConnection)
      .then((metadataResult) => {
        if (activeMetadataLoadKeyRef.current !== metadataLoadKey) {
          return;
        }
        setMetadataStateByConnection((current) => ({
          ...current,
          [connection.id]: { status: "loaded", metadata: metadataResult },
        }));
      })
      .catch((error: unknown) => {
        if (activeMetadataLoadKeyRef.current !== metadataLoadKey) {
          return;
        }
        setMetadataStateByConnection((current) => ({
          ...current,
          [connection.id]: {
            status: "error",
            metadata: current[connection.id]?.metadata ?? createEmptyMetadata(),
            errorMessage:
              error instanceof Error
                ? error.message
                : "Database metadata could not be loaded.",
          },
        }));
      });
  }, [connection.id, databaseStatus, effectiveConnection, selectedSchema]);

  useEffect(() => {
    if (databaseStatus === "connected" || databaseStatus === "reconnecting") {
      return;
    }

    setMetadataStateByConnection((current) => ({
      ...current,
      [connection.id]: createIdleMetadataState(),
    }));

    for (const key of Array.from(metadataLoadStartedRef.current)) {
      if (key.startsWith(`${connection.id}:`)) {
        metadataLoadStartedRef.current.delete(key);
      }
    }
    if (activeMetadataLoadKeyRef.current?.startsWith(`${connection.id}:`)) {
      activeMetadataLoadKeyRef.current = null;
    }
  }, [connection.id, databaseStatus]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    function closeContextMenu(): void {
      setContextMenu(null);
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const sheetState = sheetStateByConnection[connection.id] ?? {
    sheets: [],
    activeSheetId: "",
    openSheetIds: [],
  };
  const sheets = sheetState.sheets;
  const visibleSheetList = sheets.filter(isPersistableSheet);
  const openSheets = sheetState.openSheetIds
    .map((sheetId) => sheets.find((sheet) => sheet.id === sheetId))
    .filter((sheet): sheet is QuerySheet => Boolean(sheet));
  const activeSheet =
    openSheets.find((sheet) => sheet.id === sheetState.activeSheetId) ??
    openSheets[0] ??
    null;
  const activeObjectKey = activeSheet?.objectBinding
    ? createObjectKey(
        activeSheet.objectBinding.objectType,
        activeSheet.objectBinding.schema,
        activeSheet.objectBinding.name,
        activeSheet.objectBinding.tableName,
      )
    : null;
  const activeOutput = activeSheet?.output ?? createEmptySheetOutput();
  const activeResultTab =
    activeOutput.resultTabs.find(
      (tab) => tab.id === activeOutput.activeResultTabId,
    ) ??
    activeOutput.resultTabs[0] ??
    null;

  useEffect(() => {
    if (activeOutput.resultTabs.length === 0 && resultFullscreenOpen) {
      setResultFullscreenOpen(false);
    }
  }, [activeOutput.resultTabs.length, resultFullscreenOpen]);

  const metadataState =
    metadataStateByConnection[connection.id] ?? createIdleMetadataState();
  const metadata = metadataState.metadata;
  const metadataLoading = metadataState.status === "loading";
  const filteredTables = useMemo(() => {
    const normalized = filter.trim().toLowerCase();
    if (!normalized) {
      return metadata.tables;
    }
    return metadata.tables.filter(
      (table) =>
        table.name.toLowerCase().includes(normalized) ||
        table.schema.toLowerCase().includes(normalized) ||
        formatObjectName(table).toLowerCase().includes(normalized) ||
        table.columns.some((column) =>
          column.name.toLowerCase().includes(normalized),
        ),
    );
  }, [filter, metadata.tables]);
  const completionData = useMemo(
    () => createDatabaseCompletionData(metadata.tables),
    [metadata.tables],
  );
  const schemaOptions = useMemo<Array<AppSelectOption<string>>>(() => {
    const options: Array<AppSelectOption<string>> = [
      { value: "", label: "Default schema" },
    ];
    if (selectedSchema && !metadata.schemas.includes(selectedSchema)) {
      options.push({ value: selectedSchema, label: selectedSchema });
    }
    metadata.schemas.forEach((schema) => {
      options.push({ value: schema, label: schema });
    });
    return options;
  }, [metadata.schemas, selectedSchema]);

  const gridStyle = {
    "--database-explorer-width": `${explorerWidth}px`,
    "--database-editor-height": `${editorHeight}px`,
  } as CSSProperties;

  useEffect(() => {
    latestSheetStateRef.current = sheetState;
    if (sheetState.sheets.length > 0) {
      databaseSheetStateCache[connection.id] = sheetState;
    }
  }, [connection.id, sheetState]);

  useEffect(() => {
    loadedWorksheetConnectionIdsRef.current = loadedWorksheetConnectionIds;
  }, [loadedWorksheetConnectionIds]);

  useEffect(() => {
    if (!autoSaveError) {
      return undefined;
    }

    const timer = window.setTimeout(() => setAutoSaveError(null), 4200);
    return () => window.clearTimeout(timer);
  }, [autoSaveError]);

  useEffect(() => {
    if (!activeObjectKey || !objectTreeRef.current) {
      return;
    }

    const target = Array.from(
      objectTreeRef.current.querySelectorAll<HTMLElement>(
        "[data-database-object-key]",
      ),
    ).find((element) => element.dataset.databaseObjectKey === activeObjectKey);
    target?.scrollIntoView({ block: "nearest" });
  }, [activeObjectKey]);

  useEffect(() => {
    if (!loadedWorksheetConnectionIds.has(connection.id)) {
      return undefined;
    }

    if (persistedWorksheetTimerRef.current !== null) {
      window.clearTimeout(persistedWorksheetTimerRef.current);
    }

    if (!worksheetStateNeedsPersist(sheetState)) {
      return undefined;
    }

    persistedWorksheetTimerRef.current = window.setTimeout(() => {
      persistedWorksheetTimerRef.current = null;
      const snapshot = sheetState;
      const savedAt = new Date().toISOString();

      void persistSavedWorksheetState(connection.id, snapshot)
        .then(() => {
          setSheetStateByConnection((current) => {
            const state = current[connection.id];
            if (!state) {
              return current;
            }
            const nextState = markWorksheetStateSnapshotSaved(
              state,
              snapshot,
              savedAt,
            );
            databaseSheetStateCache[connection.id] = nextState;
            return {
              ...current,
              [connection.id]: nextState,
            };
          });
          setAutoSaveError(null);
        })
        .catch((error) => {
          console.error(error);
          setAutoSaveError(
            error instanceof Error
              ? error.message
              : "SQL sheet auto-save failed.",
          );
        });
    }, WORKSHEET_AUTO_SAVE_DELAY_MS);

    return () => {
      if (persistedWorksheetTimerRef.current !== null) {
        window.clearTimeout(persistedWorksheetTimerRef.current);
        persistedWorksheetTimerRef.current = null;
      }
    };
  }, [connection.id, loadedWorksheetConnectionIds, sheetState]);

  function updateCurrentConnectionState(
    updater: (state: SheetConnectionState) => SheetConnectionState,
  ): void {
    setSheetStateByConnection((current) => {
      const existing = current[connection.id] ?? createInitialSheetState();
      return { ...current, [connection.id]: updater(existing) };
    });
  }

  function updateSheetOutput(
    sheetId: string,
    updater: (output: SheetOutputState) => SheetOutputState,
  ): void {
    updateCurrentConnectionState((state) => ({
      ...state,
      sheets: state.sheets.map((sheet) =>
        sheet.id === sheetId
          ? { ...sheet, output: updater(sheet.output) }
          : sheet,
      ),
    }));
  }

  function updateActiveSheetOutput(
    updater: (output: SheetOutputState) => SheetOutputState,
  ): void {
    if (!activeSheet) {
      return;
    }

    updateSheetOutput(activeSheet.id, updater);
  }

  function updateActiveResultTab(updater: (tab: ResultTab) => ResultTab): void {
    updateActiveSheetOutput((output) => ({
      ...output,
      resultTabs: output.resultTabs.map((tab) =>
        tab.id === output.activeResultTabId ? updater(tab) : tab,
      ),
    }));
  }

  function refreshMetadata(): void {
    const canLoadMetadata =
      databaseStatus === "connected" || databaseStatus === "reconnecting";
    if (!canLoadMetadata) {
      setMetadataStateByConnection((current) => ({
        ...current,
        [connection.id]: {
          status: "error",
          metadata: createEmptyMetadata(),
          errorMessage:
            "Connect to the database before refreshing Object Explorer.",
        },
      }));
      return;
    }

    const metadataLoadKey = `${connection.id}:${selectedSchema}`;
    metadataLoadStartedRef.current.add(metadataLoadKey);
    activeMetadataLoadKeyRef.current = metadataLoadKey;
    setMetadataStateByConnection((current) => ({
      ...current,
      [connection.id]: createLoadingMetadataState(
        current[connection.id]?.metadata,
      ),
    }));

    void fetchDatabaseMetadata(effectiveConnection)
      .then((metadataResult) => {
        if (activeMetadataLoadKeyRef.current !== metadataLoadKey) {
          return;
        }
        setMetadataStateByConnection((current) => ({
          ...current,
          [connection.id]: { status: "loaded", metadata: metadataResult },
        }));
        onRefresh();
      })
      .catch((error: unknown) => {
        if (activeMetadataLoadKeyRef.current !== metadataLoadKey) {
          return;
        }
        setMetadataStateByConnection((current) => ({
          ...current,
          [connection.id]: {
            status: "error",
            metadata: current[connection.id]?.metadata ?? createEmptyMetadata(),
            errorMessage:
              error instanceof Error
                ? error.message
                : "Database metadata could not be loaded.",
          },
        }));
      });
  }

  function changeSchema(schema: string): void {
    const canLoadMetadata =
      databaseStatus === "connected" || databaseStatus === "reconnecting";

    setSelectedSchemaByConnection((current) => ({
      ...current,
      [connection.id]: schema,
    }));
    setFilter("");
    setMetadataStateByConnection((current) => ({
      ...current,
      [connection.id]: canLoadMetadata
        ? createLoadingMetadataState(current[connection.id]?.metadata)
        : createIdleMetadataState(),
    }));
    metadataLoadStartedRef.current.delete(`${connection.id}:${schema}`);
    activeMetadataLoadKeyRef.current = `${connection.id}:${schema}`;
  }

  function createObjectCollectionLoadKey(
    collection: DatabaseObjectCollectionName,
  ): string {
    return `${connection.id}:${selectedSchema}:${collection}`;
  }

  function getObjectCollectionCount(
    collection: OracleLazyObjectCollection,
  ): number {
    return metadata.objectCounts[collection] ?? metadata[collection].length;
  }

  function isObjectCollectionLoading(
    collection: OracleLazyObjectCollection,
  ): boolean {
    return Boolean(loadingObjectCollections[createObjectCollectionLoadKey(collection)]);
  }

  function loadObjectCollection(collection: OracleLazyObjectCollection): void {
    if (connection.type !== "Oracle") {
      return;
    }

    if (metadata[collection].length > 0 || getObjectCollectionCount(collection) === 0) {
      return;
    }

    const loadKey = createObjectCollectionLoadKey(collection);
    if (loadingObjectCollections[loadKey]) {
      return;
    }

    setLoadingObjectCollections((current) => ({ ...current, [loadKey]: true }));
    void window.ivsDashboard
      .getDatabaseObjectNames(effectiveConnection, collection)
      .then((objectNames) => {
        setMetadataStateByConnection((current) => {
          const currentState = current[connection.id];
          const currentMetadata = currentState?.metadata ?? createEmptyMetadata();
          const nextMetadata = {
            ...currentMetadata,
            [collection]: objectNames,
          };
          return {
            ...current,
            [connection.id]: {
              status: "loaded",
              metadata: nextMetadata,
            },
          };
        });
      })
      .catch((error) => console.error(error))
      .finally(() => {
        setLoadingObjectCollections((current) => {
          const next = { ...current };
          delete next[loadKey];
          return next;
        });
      });
  }

  function renderObjectCollectionItems(
    collection: OracleLazyObjectCollection,
    icon: ReactNode,
  ): ReactNode {
    const objectType = OBJECT_TYPE_BY_COLLECTION[collection];
    const items = metadata[collection];
    const loading = isObjectCollectionLoading(collection);

    if (loading) {
      return (
        <div className="database-tree-empty database-tree-loading">
          <LoaderCircle className="button-spinner" size={14} />
          <span>Loading...</span>
        </div>
      );
    }

    if (items.length === 0) {
      const count = getObjectCollectionCount(collection);
      return (
        <div className="database-tree-empty">
          {connection.type === "Oracle" && count > 0
            ? "Open to load objects."
            : `No ${collection} loaded.`}
        </div>
      );
    }

    return items.map((objectName) => {
      const parsed = parseDatabaseObjectName(objectName, selectedSchema);
      const objectKey = createObjectKey(objectType, parsed.schema, parsed.name);
      return (
        <div
          className={`database-tree-item ${objectType}-item${
            activeObjectKey === objectKey ? " active" : ""
          }`}
          key={objectName}
          onClick={() => void openObjectSheet(objectType, objectName)}
          data-database-object-key={objectKey}
        >
          {icon}
          <span>{objectName}</span>
        </div>
      );
    });
  }

  function createNewSheet(): void {
    updateCurrentConnectionState((state) => {
      const sheet = createQuerySheet(nextUntitledName(state.sheets), "");
      return {
        sheets: [...state.sheets, sheet],
        activeSheetId: sheet.id,
        openSheetIds: [...state.openSheetIds, sheet.id],
      };
    });
    setContextMenu(null);
  }

  async function executeRawSql(sqlText: string): Promise<void> {
    const statements = splitSqlStatementsWithDelimiters(sqlText);
    const result = await window.ivsDashboard.executeDatabaseStatements(
      effectiveConnection,
      statements,
    );
    const firstError = result.results.find((item) => item.status === "error");
    if (firstError?.errorMessage) {
      throw new Error(firstError.errorMessage);
    }
  }

  async function openObjectSheet(
    objectType: DatabaseObjectType,
    objectName: string,
    options: {
      table?: DatabaseTable;
      index?: DatabaseIndex;
      trigger?: DatabaseTrigger;
      isNew?: boolean;
    } = {},
  ): Promise<void> {
    const parsedObject = parseDatabaseObjectName(
      objectName,
      options.table?.schema ?? selectedSchema,
    );
    const tableName = options.table?.name;
    const sheetName = formatObjectEditorName(
      objectType,
      parsedObject.schema,
      parsedObject.name,
      tableName,
      options.isNew,
    );
    const existing = sheetState.sheets.find(
      (sheet) =>
        sheet.objectBinding?.connectionId === connection.id &&
        sheet.objectBinding.objectType === objectType &&
        sheet.objectBinding.schema === parsedObject.schema &&
        sheet.objectBinding.name === parsedObject.name &&
        (sheet.objectBinding.tableName ?? "") === (tableName ?? "") &&
        !options.isNew,
    );
    if (existing) {
      selectSheet(existing.id);
      return;
    }
    const initialSql = options.isNew
      ? createObjectTemplate(objectType, connection.type, options.table)
      : `-- Loading ${objectType} definition...`;
    const created = createQuerySheet(sheetName, initialSql);
    created.sheetMode = "object-backed";
    created.objectBinding = {
      connectionId: connection.id,
      objectType,
      schema: parsedObject.schema,
      name: options.isNew ? "" : parsedObject.name,
      tableName,
      isNew: options.isNew,
    };
    updateCurrentConnectionState((state) => ({
      sheets: [...state.sheets, created],
      activeSheetId: created.id,
      openSheetIds: [...state.openSheetIds, created.id],
    }));
    if (options.isNew) {
      setContextMenu(null);
      return;
    }
    try {
      const nextSql = await loadObjectDefinition(
        objectType,
        parsedObject.schema,
        parsedObject.name,
        options.table,
        options.index,
      );
      updateCurrentConnectionState((state) => ({
        ...state,
        sheets: state.sheets.map((s) =>
          s.id === created.id
            ? { ...s, sql: nextSql, savedSql: nextSql, savedName: sheetName }
            : s,
        ),
      }));
      if (objectType === "table") {
        void runSqlInSheet(created.id, nextSql);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `Could not load ${objectType} definition.`;
      addMessage("error", message, created.id);
    }
  }

  async function loadObjectDefinition(
    objectType: DatabaseObjectType,
    schema: string,
    name: string,
    table?: DatabaseTable,
    index?: DatabaseIndex,
  ): Promise<string> {
    if (objectType === "table") {
      const tableSql = createSelectTemplate(
        table ?? {
          schema,
          name,
          columns: [],
          indexes: [],
          triggers: [],
          partitions: [],
        },
        connection.type,
      );
      return limitSelectTemplate(tableSql, connection.type, 100);
    }

    if (objectType === "index" && table && index) {
      return createIndexDefinitionSql(table, index, connection.type);
    }

    const target = formatQualifiedIdentifier(schema, name, connection.type);
    const statement =
      connection.type === "Oracle"
        ? createOracleObjectDefinitionStatement(
            objectType,
            name,
            schema ||
              effectiveConnection.schema ||
              effectiveConnection.database ||
              effectiveConnection.user,
          )
        : objectType === "view"
          ? `SHOW CREATE VIEW ${target};`
          : objectType === "procedure"
            ? `SHOW CREATE PROCEDURE ${target};`
            : objectType === "function"
              ? `SHOW CREATE FUNCTION ${target};`
              : objectType === "trigger"
                ? `SHOW CREATE TRIGGER ${target};`
                : "";
    if (!statement) {
      return `-- Failed to load ${objectType} definition`;
    }

    const batch = await window.ivsDashboard.executeDatabaseStatements(
      effectiveConnection,
      [statement],
    );
    const row = batch.results[0]?.rows?.[0] as
      | Record<string, unknown>
      | undefined;
    const createSql = findCreateStatement(row, objectType);
    return createSql
      ? formatLoadedObjectSql(objectType, createSql)
      : `-- Failed to load ${objectType} definition`;
  }

  function selectSheet(sheetId: string): void {
    updateCurrentConnectionState((state) => ({
      ...state,
      activeSheetId: sheetId,
      openSheetIds: state.openSheetIds.includes(sheetId)
        ? state.openSheetIds
        : [...state.openSheetIds, sheetId],
    }));
  }

  function beginSheetDrag(
    event: DragEvent<HTMLElement>,
    sheetId: string,
  ): void {
    setDraggingSheetId(sheetId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", sheetId);
  }

  function allowSheetDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function dropSheet(event: DragEvent<HTMLElement>, targetSheetId: string): void {
    event.preventDefault();
    const draggedSheetId =
      draggingSheetId || event.dataTransfer.getData("text/plain");
    if (!draggedSheetId || draggedSheetId === targetSheetId) {
      setDraggingSheetId(null);
      return;
    }

    updateCurrentConnectionState((state) => {
      const nextSheets = moveSheetToTarget(
        state.sheets,
        draggedSheetId,
        targetSheetId,
      );
      if (nextSheets === state.sheets) {
        return state;
      }

      return {
        ...state,
        sheets: nextSheets,
        openSheetIds: sortOpenSheetIdsBySheetOrder(
          state.openSheetIds,
          nextSheets,
        ),
      };
    });
    setDraggingSheetId(null);
  }

  function updateActiveSheetSql(sql: string): void {
    if (!activeSheet) {
      return;
    }

    updateCurrentConnectionState((state) => ({
      ...state,
      sheets: state.sheets.map((sheet) =>
        sheet.id === activeSheet.id ? { ...sheet, sql } : sheet,
      ),
    }));
  }

  function startRename(sheetId: string): void {
    const sheet = sheets.find((item) => item.id === sheetId);
    if (!sheet) {
      return;
    }

    setRenamingSheetId(sheet.id);
    setRenameDraft(sheet.name);
    setContextMenu(null);
  }

  function commitRename(): void {
    if (!renamingSheetId) {
      return;
    }

    const nextName = renameDraft.trim();
    if (!nextName) {
      setRenamingSheetId(null);
      return;
    }

    updateCurrentConnectionState((state) => ({
      ...state,
      sheets: state.sheets.map((sheet) =>
        sheet.id === renamingSheetId ? { ...sheet, name: nextName } : sheet,
      ),
    }));
    setRenamingSheetId(null);
  }

  function requestDeleteSheet(sheetId: string): void {
    const sheet = sheets.find((item) => item.id === sheetId);
    if (!sheet) {
      return;
    }

    setDeleteRequest({ sheetId: sheet.id, sheetName: sheet.name });
    setContextMenu(null);
  }

  function deleteSheet(sheetId: string): void {
    const deleted = sheets.find((sheet) => sheet.id === sheetId);
    updateCurrentConnectionState((state) => {
      const removedIndex = state.sheets.findIndex(
        (sheet) => sheet.id === sheetId,
      );
      const remaining = state.sheets.filter((sheet) => sheet.id !== sheetId);

      if (remaining.length === 0) {
        const replacement = createQuerySheet("Untitled-1", "");
        return {
          sheets: [replacement],
          activeSheetId: replacement.id,
          openSheetIds: [replacement.id],
        };
      }

      const nearestSheet =
        remaining[Math.min(Math.max(removedIndex, 0), remaining.length - 1)];
      const openSheetIds = state.openSheetIds.filter(
        (openSheetId) => openSheetId !== sheetId,
      );
      const activeSheetId =
        state.activeSheetId === sheetId
          ? (openSheetIds[0] ?? nearestSheet.id)
          : state.activeSheetId;

      return { sheets: remaining, activeSheetId, openSheetIds };
    });
    setDeleteRequest(null);
    if (deleted?.savedAt) {
      void window.ivsDashboard
        .deleteDatabaseWorksheet(connection.id, sheetId)
        .catch((error) => console.error(error));
    }
  }

  function closeSheetTab(sheetId: string): void {
    const sheet = sheets.find((item) => item.id === sheetId);
    if (!sheet) {
      return;
    }

    if (sheet.sql !== sheet.savedSql || sheet.name !== sheet.savedName) {
      setCloseRequest({ sheetId: sheet.id, sheetName: sheet.name });
      return;
    }

    closeSheetTabConfirmed(sheetId, false);
  }

  function closeSheetTabConfirmed(
    sheetId: string,
    discardUnsaved: boolean,
  ): void {
    updateCurrentConnectionState((state) => {
      const closedIndex = state.openSheetIds.indexOf(sheetId);
      const nextOpenSheetIds = state.openSheetIds.filter(
        (openSheetId) => openSheetId !== sheetId,
      );
      const nearestOpenSheetId =
        nextOpenSheetIds[
          Math.min(Math.max(closedIndex, 0), nextOpenSheetIds.length - 1)
        ] ?? state.sheets.find((sheet) => sheet.id !== sheetId)?.id;
      const openSheetIds = nextOpenSheetIds.length
        ? nextOpenSheetIds
        : nearestOpenSheetId
          ? [nearestOpenSheetId]
          : [];
      const activeSheetId =
        state.activeSheetId === sheetId
          ? (openSheetIds[0] ?? "")
          : state.activeSheetId;

      return {
        ...state,
        activeSheetId,
        openSheetIds,
        sheets: discardUnsaved
          ? state.sheets.map((sheet) =>
              sheet.id === sheetId
                ? { ...sheet, name: sheet.savedName, sql: sheet.savedSql }
                : sheet,
            )
          : state.sheets,
      };
    });
    setCloseRequest(null);
  }

  function saveActiveSheet(): void {
    if (!activeSheet) {
      return;
    }
    if (activeSheet.sheetMode === "transient-preview") {
      addMessage("error", "This table preview sheet is not savable.");
      return;
    }
    if (
      activeSheet.sheetMode === "object-backed" &&
      activeSheet.objectBinding
    ) {
      const binding = activeSheet.objectBinding;
      void (async () => {
        try {
          if (binding.objectType === "table") {
            addMessage("error", "Table preview editors are not savable.");
            return;
          }

          const objectName =
            binding.isNew || !binding.name
              ? window.prompt(
                  `Name for new ${binding.objectType}:`,
                  binding.name || "",
                )
              : binding.name;
          if (objectName === null) {
            return;
          }
          if (!objectName.trim()) {
            addMessage("error", "Object name is required.");
            return;
          }

          const parsedObject = parseDatabaseObjectName(
            objectName,
            binding.schema || selectedSchema,
          );
          const nextBinding = {
            ...binding,
            schema: parsedObject.schema,
            name: parsedObject.name,
            isNew: false,
          };
          const nextSql = applyObjectNameToTemplate(
            activeSheet.sql,
            nextBinding.objectType,
            parsedObject.schema,
            parsedObject.name,
            connection.type,
          );
          await executeRawSql(
            createObjectSaveSql(
              nextBinding,
              nextSql,
              binding.isNew === true,
              connection.type,
            ),
          );
          refreshMetadata();
          addMessage(
            "success",
            `${binding.isNew ? "Created" : "Updated"} ${nextBinding.objectType} ${nextBinding.name}.`,
          );
          const savedAt = new Date().toISOString();
          const savedName = formatObjectEditorName(
            nextBinding.objectType,
            nextBinding.schema,
            nextBinding.name,
            nextBinding.tableName,
            false,
          );
          updateCurrentConnectionState((state) => ({
            ...state,
            sheets: state.sheets.map((sheet) =>
              sheet.id === activeSheet.id
                ? {
                    ...sheet,
                    name: savedName,
                    sql: nextSql,
                    savedSql: nextSql,
                    savedName,
                    savedAt,
                    objectBinding: nextBinding,
                  }
                : sheet,
            ),
          }));
        } catch (error) {
          addMessage(
            "error",
            error instanceof Error ? error.message : "Object update failed.",
          );
        }
      })();
      return;
    }

    const savedAt = new Date().toISOString();
    const snapshot = sheetState;

    void persistSavedWorksheetState(connection.id, snapshot)
      .then(() => {
        setSheetStateByConnection((current) => {
          const state = current[connection.id];
          if (!state) {
            return current;
          }
          const nextState = markWorksheetStateSnapshotSaved(
            state,
            snapshot,
            savedAt,
          );
          databaseSheetStateCache[connection.id] = nextState;
          return {
            ...current,
            [connection.id]: nextState,
          };
        });
        setAutoSaveError(null);
        onSheetSaved();
      })
      .catch((error) => {
        console.error(error);
        setAutoSaveError(
          error instanceof Error
            ? error.message
            : "SQL sheet auto-save failed.",
        );
        addMessage(
          "error",
          error instanceof Error ? error.message : "Sheet could not be saved.",
          activeSheet.id,
        );
      });
  }

  function addMessage(
    tone: MessageEntry["tone"],
    text: string,
    sheetId = activeSheet?.id,
  ): void {
    if (!sheetId) {
      return;
    }

    updateSheetOutput(sheetId, (output) =>
      prependSheetMessage(output, tone, text, true),
    );
  }

  function setSheetExecutionError(sheetId: string, message: string): void {
    updateSheetOutput(sheetId, (output) =>
      prependSheetMessage(
        {
          ...output,
          hasExecuted: true,
          activeOutputTab: "messages",
          resultTabs: [],
          activeResultTabId: null,
        },
        "error",
        message,
      ),
    );
  }

  async function runDatabaseQuery(
    target: ExecutionTarget,
    sheetId: string,
    source: "execute" | "reload",
  ): Promise<void> {
    if (executingRef.current) {
      return;
    }

    executingRef.current = true;
    setIsExecuting(true);
    try {
      const statements = splitSqlStatements(target.sql);
      if (statements.length === 0) {
        setSheetExecutionError(
          sheetId,
          "No executable SQL statement was found.",
        );
        return;
      }

      const { executionStatements, pageableStatements } =
        prepareIncrementalExecutionStatements(statements, connection.type);

      const batch = await window.ivsDashboard.executeDatabaseStatements(
        effectiveConnection,
        executionStatements,
      );
      const now = new Date().toISOString();
      const logicalResults = withLogicalStatements(batch.results, statements);
      const resultTabs = applyInitialResultPagination(
        createResultTabs(logicalResults),
        statements,
        pageableStatements,
      );
      const activeResultTabId = selectInitialResultTabId(resultTabs);
      const messages = createBatchMessages(logicalResults, now, source);
      const activeOutputTab = resultTabs.some(
        (tab) => tab.meta.status === "success" && tab.columns.length > 0,
      )
        ? "results"
        : "messages";

      updateSheetOutput(sheetId, (output) => ({
        ...output,
        hasExecuted: true,
        activeOutputTab,
        resultTabs,
        activeResultTabId,
        messages,
        lastExecutionTarget: { ...target, sheetId },
      }));

      logicalResults.forEach((result, index) => {
        onExecution({
          id:
            result.executionRecordId ??
            `execution-${Date.now()}-${index}-${Math.round(
              Math.random() * 10000,
            )}`,
          time: result.executedAt ?? now,
          connectionId: connection.id,
          connection: connection.name,
          user: effectiveConnection.user,
          query: result.statement || "(empty query)",
          duration: formatDurationMs(result.durationMs),
          status: result.status,
          rows:
            result.rowsFetched > 0
              ? result.rowsFetched
              : (result.rowsAffected ?? 0),
          rowsAffected: result.rowsAffected,
          errorMessage: result.errorMessage,
          message:
            result.executionMessage ?? createExecutionHistoryMessage(result),
        });
      });

      if (
        hasSuccessfulSchemaChange(logicalResults) ||
        hasSuccessfulRowCountChange(logicalResults)
      ) {
        refreshMetadata();
      }
    } catch (error) {
      setSheetExecutionError(
        sheetId,
        error instanceof Error ? error.message : "SQL execution failed.",
      );
    } finally {
      executingRef.current = false;
      setIsExecuting(false);
    }
  }

  async function loadMoreResultRows(tabId: string): Promise<void> {
    if (isExecuting || loadingMoreTabsRef.current.has(tabId)) {
      return;
    }

    const state = sheetStateByConnection[connection.id];
    const targetSheet = state?.sheets.find((sheet) =>
      sheet.output.resultTabs.some((tab) => tab.id === tabId),
    );
    const targetTab = targetSheet?.output.resultTabs.find(
      (tab) => tab.id === tabId,
    );
    const pageRequest = targetTab?.pagination;
    if (!targetSheet || !pageRequest || pageRequest.loading || !pageRequest.hasMore) {
      return;
    }

    loadingMoreTabsRef.current.add(tabId);
    updateSheetOutput(targetSheet.id, (output) => ({
      ...output,
      resultTabs: output.resultTabs.map((tab) =>
        tab.id === tabId && tab.pagination
          ? {
              ...tab,
              pagination: {
                ...tab.pagination,
                loading: true,
                errorMessage: undefined,
              },
            }
          : tab,
      ),
    }));

    try {
      const nextStatement = createIncrementalSelectStatement({
        statement: pageRequest.baseSql,
        connectionType: connection.type,
        offset: pageRequest.nextOffset,
        pageSize: pageRequest.pageSize,
      });
      const batch = await window.ivsDashboard.executeDatabaseStatements(
        effectiveConnection,
        [nextStatement],
      );
      const result = batch.results[0];
      if (!result || result.status !== "success") {
        throw new Error(
          result?.errorMessage || "Failed to load additional rows.",
        );
      }

      updateSheetOutput(targetSheet.id, (output) => ({
        ...output,
        resultTabs: output.resultTabs.map((tab) => {
          if (tab.id !== tabId || !tab.pagination) {
            return tab;
          }
          const rows = [...tab.rows, ...result.rows];
          return {
            ...tab,
            rows,
            meta: {
              ...tab.meta,
              rows: rows.length,
              duration: formatDurationMs(result.durationMs),
              queriedAt: new Date().toISOString(),
            },
            pagination: {
              ...tab.pagination,
              nextOffset: tab.pagination.nextOffset + result.rowsFetched,
              hasMore: result.rowsFetched === tab.pagination.pageSize,
              loading: false,
              errorMessage: undefined,
            },
          };
        }),
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load additional rows.";
      updateSheetOutput(targetSheet.id, (output) => ({
        ...output,
        resultTabs: output.resultTabs.map((tab) =>
          tab.id === tabId && tab.pagination
            ? {
                ...tab,
                pagination: {
                  ...tab.pagination,
                  loading: false,
                  errorMessage: message,
                  hasMore: false,
                },
              }
            : tab,
        ),
      }));
      addMessage("error", message, targetSheet.id);
    } finally {
      loadingMoreTabsRef.current.delete(tabId);
    }
  }

  const executeFromEditorView = useCallback(
    (view: EditorView): void => {
      if (!activeSheet || executingRef.current || metadataLoading) {
        return;
      }

      const target = getExecutionTarget(view.state);
      if (!target) {
        setSheetExecutionError(
          activeSheet.id,
          "No executable SQL statement was found at the cursor.",
        );
        return;
      }

      view.dispatch({ effects: setExecutedSqlRange.of(target) });
      void runDatabaseQuery(target, activeSheet.id, "execute");
    },
    [activeSheet, effectiveConnection, metadataLoading],
  );

  function executeFromActiveEditor(): void {
    const view = editorViewRef.current;
    if (!view) {
      addMessage("error", "SQL editor is not ready yet.");
      updateActiveSheetOutput((output) => ({
        ...output,
        hasExecuted: true,
        activeOutputTab: "messages",
      }));
      return;
    }

    executeFromEditorView(view);
  }

  function reloadLastExecution(): void {
    if (executingRef.current || metadataLoading) {
      return;
    }

    if (!activeOutput.lastExecutionTarget) {
      addMessage("error", "No previous SQL execution is available to reload.");
      updateActiveSheetOutput((output) => ({
        ...output,
        hasExecuted: true,
        activeOutputTab: "messages",
      }));
      return;
    }

    const view = editorViewRef.current;
    if (view && activeSheet?.id === activeOutput.lastExecutionTarget.sheetId) {
      view.dispatch({
        effects: setExecutedSqlRange.of(activeOutput.lastExecutionTarget),
      });
    }

    void runDatabaseQuery(
      activeOutput.lastExecutionTarget,
      activeOutput.lastExecutionTarget.sheetId,
      "reload",
    );
  }

  function rerunHistoryRecord(record: DatabaseExecutionRecord): void {
    if (executingRef.current || metadataLoading) {
      return;
    }
    if (record.status !== "success") {
      addMessage("error", "Only successful SQL executions can be re-run.");
      updateActiveSheetOutput((output) => ({
        ...output,
        hasExecuted: true,
        activeOutputTab: "messages",
      }));
      return;
    }

    const formattedSql = ensureSqlTerminator(formatSqlForDisplay(record.query));
    const createdSheet = createQuerySheet(
      nextHistorySheetName(record.time, sheetState.sheets),
      formattedSql,
    );

    updateCurrentConnectionState((state) => ({
      sheets: [...state.sheets, createdSheet],
      activeSheetId: createdSheet.id,
      openSheetIds: [...state.openSheetIds, createdSheet.id],
    }));

    void runDatabaseQuery(
      { sql: formattedSql, from: 0, to: formattedSql.length },
      createdSheet.id,
      "execute",
    );
  }

  useEffect(() => {
    if (!rerunRequest || handledRerunRequestIdRef.current === rerunRequest.id) {
      return;
    }

    handledRerunRequestIdRef.current = rerunRequest.id;
    rerunHistoryRecord(rerunRequest.record);
  }, [rerunRequest]);

  function clearExecutedSqlHighlight(): void {
    editorViewRef.current?.dispatch({ effects: setExecutedSqlRange.of(null) });
  }

  function openSheetsContextMenu(event: React.MouseEvent): void {
    event.preventDefault();
    setContextMenu({ kind: "sheets", x: event.clientX, y: event.clientY });
  }

  function openSheetContextMenu(
    event: React.MouseEvent,
    sheetId: string,
  ): void {
    event.preventDefault();
    setContextMenu({
      kind: "sheet",
      sheetId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function openTableContextMenu(
    event: React.MouseEvent,
    table: DatabaseTable,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: "table",
      table,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function openObjectGroupContextMenu(
    event: React.MouseEvent,
    objectType: DatabaseObjectType,
    table?: DatabaseTable,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: "object-group",
      objectType,
      table,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function createTemplateSheet(
    objectType: DatabaseObjectType,
    table?: DatabaseTable,
  ): void {
    void openObjectSheet(objectType, "", { table, isNew: true });
  }

  function insertTableTemplate(table: DatabaseTable): void {
    const template = createInsertTemplate(table, connection.type);
    const view = editorViewRef.current;

    if (!activeSheet) {
      const sheet = createQuerySheet(
        nextUntitledName(sheetState.sheets),
        template,
      );
      updateCurrentConnectionState((state) => ({
        sheets: [...state.sheets, sheet],
        activeSheetId: sheet.id,
        openSheetIds: [...state.openSheetIds, sheet.id],
      }));
      setContextMenu(null);
      return;
    }

    if (view) {
      const selection = view.state.selection.main;
      const prefix =
        selection.from > 0 &&
        !/\n\s*$/.test(view.state.doc.sliceString(0, selection.from))
          ? "\n\n"
          : "";
      view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: `${prefix}${template}`,
        },
      });
    } else {
      updateActiveSheetSql(
        `${activeSheet.sql}${activeSheet.sql ? "\n\n" : ""}${template}`,
      );
    }
    setContextMenu(null);
  }

  async function runSqlInSheet(sheetId: string, sql: string): Promise<void> {
    await runDatabaseQuery(
      { sql, from: 0, to: sql.length },
      sheetId,
      "execute",
    );
  }

  function appendTableSelectTemplate(table: DatabaseTable): void {
    const template = createSelectTemplate(table, connection.type);
    const view = editorViewRef.current;

    if (!activeSheet) {
      const sheet = createQuerySheet(
        nextUntitledName(sheetState.sheets),
        template,
      );
      updateCurrentConnectionState((state) => ({
        sheets: [...state.sheets, sheet],
        activeSheetId: sheet.id,
        openSheetIds: [...state.openSheetIds, sheet.id],
      }));
      void runSqlInSheet(sheet.id, template);
      setContextMenu(null);
      return;
    }

    const nextSql = appendSqlStatement(activeSheet.sql, template);
    if (view) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: nextSql,
        },
      });
    } else {
      updateActiveSheetSql(nextSql);
    }
    void runSqlInSheet(activeSheet.id, nextSql);
    setContextMenu(null);
  }

  function openTableInNewTab(table: DatabaseTable): void {
    void openObjectSheet("table", table.name, { table });
    setContextMenu(null);
  }

  const startResize = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const grid = gridRef.current;
    const availableWidth = grid
      ? grid.clientWidth - DATABASE_SPLITTER_SIZE
      : DATABASE_EXPLORER_MAX_WIDTH + DATABASE_QUERY_MIN_WIDTH;
    const maxExplorerWidth = Math.min(
      DATABASE_EXPLORER_MAX_WIDTH,
      Math.max(
        DATABASE_EXPLORER_MIN_WIDTH,
        availableWidth - DATABASE_QUERY_MIN_WIDTH,
      ),
    );

    dragRef.current = {
      startX: event.clientX,
      startExplorerWidth: explorerWidth,
      minExplorerWidth: DATABASE_EXPLORER_MIN_WIDTH,
      maxExplorerWidth,
    };
  };

  const resizeLayout = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }

    setExplorerWidth(
      clamp(
        drag.startExplorerWidth + event.clientX - drag.startX,
        drag.minExplorerWidth,
        drag.maxExplorerWidth,
      ),
    );
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (
      dragRef.current &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const startEditorResize = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const panelHeight = queryPanelRef.current?.clientHeight ?? 620;
    const headerHeight =
      queryPanelRef.current?.querySelector(".query-workspace-header")
        ?.clientHeight ?? 40;
    const maxEditorHeight = Math.max(
      DATABASE_EDITOR_MIN_HEIGHT,
      panelHeight -
        headerHeight -
        DATABASE_EDITOR_SPLITTER_SIZE -
        DATABASE_OUTPUT_MIN_HEIGHT -
        18,
    );

    editorDragRef.current = {
      startY: event.clientY,
      startEditorHeight: editorHeight,
      minEditorHeight: DATABASE_EDITOR_MIN_HEIGHT,
      maxEditorHeight,
    };
  };

  const resizeEditorLayout = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = editorDragRef.current;
    if (!drag) {
      return;
    }

    setEditorHeight(
      clamp(
        drag.startEditorHeight + event.clientY - drag.startY,
        drag.minEditorHeight,
        drag.maxEditorHeight,
      ),
    );
  };

  const stopEditorResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (
      editorDragRef.current &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    editorDragRef.current = null;
  };

  return (
    <div className="database-workspace-grid" ref={gridRef} style={gridStyle}>
      <Panel
        title="Object Explorer"
        className="database-explorer-panel"
        action={
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Refresh database objects"
            title="Refresh database objects"
            onClick={refreshMetadata}
            disabled={metadataLoading}
          >
            {metadataLoading ? (
              <LoaderCircle className="button-spinner" size={16} />
            ) : (
              <RefreshCcw size={16} />
            )}
          </button>
        }
      >
        <div className="database-connection-summary">
          <div>
            <strong>{connection.name}</strong>
            {/* <span>{connection.type}</span> */}
          </div>
          <StatusPill status={connection.status} />
        </div>

        <label className="database-schema-selector">
          <span>Schema</span>
          <AppSelect
            className="database-schema-select"
            value={selectedSchema}
            options={schemaOptions}
            disabled={metadataLoading && metadata.schemas.length === 0}
            onChange={changeSchema}
            ariaLabel="Schema"
            minDropdownWidth={180}
            showDots={false}
          />
        </label>

        {/* <label className="database-search-field">
          <Search size={14} />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter objects"
            aria-label="Filter database objects"
          />
        </label> */}

        <div className="database-object-tree" ref={objectTreeRef}>
          {metadataLoading ? (
            <div className="database-object-state">
              <LoaderCircle className="button-spinner" size={18} />
              <span>Loading database objects...</span>
            </div>
          ) : null}
          {metadataState.status === "error" ? (
            <div className="database-object-state error">
              <span>{metadataState.errorMessage}</span>
              <button
                className="button secondary compact"
                type="button"
                onClick={refreshMetadata}
              >
                Retry
              </button>
            </div>
          ) : null}
          {/* <ObjectTreeGroup
            title={
              <>
                <span>Schemas</span>
                <span className="database-tree-count">
                  {metadata.schemas.length}
                </span>
              </>
            }
            defaultOpen
          >
            {metadata.schemas.length > 0 ? (
              metadata.schemas.map((schema) => (
                <button
                  className={`database-tree-item schema-item${
                    schema === selectedSchema ? " active" : ""
                  }`}
                  type="button"
                  key={schema}
                  onClick={() => changeSchema(schema)}
                >
                  <Database size={15} />
                  <span>{schema}</span>
                </button>
              ))
            ) : (
              <div className="database-tree-empty">No schemas loaded.</div>
            )}
          </ObjectTreeGroup> */}
          <ObjectTreeGroup
            title={
              <>
                <span>Sheets</span>
                <span className="database-tree-count">
                  {visibleSheetList.length}
                </span>
              </>
            }
            defaultOpen
            onContextMenu={openSheetsContextMenu}
          >
            {visibleSheetList.map((sheet) => {
              const unsaved =
                sheet.name !== sheet.savedName || sheet.sql !== sheet.savedSql;
              return (
                <div
                  className={`database-tree-item database-sheet-tree-item${
                    activeSheet?.id === sheet.id ? " active" : ""
                  }${
                    draggingSheetId === sheet.id
                      ? " database-sheet-dragging"
                      : ""
                  }`}
                  key={sheet.id}
                  draggable={renamingSheetId !== sheet.id}
                  onDragStart={(event) => beginSheetDrag(event, sheet.id)}
                  onDragOver={allowSheetDrop}
                  onDrop={(event) => dropSheet(event, sheet.id)}
                  onDragEnd={() => setDraggingSheetId(null)}
                  onClick={() => selectSheet(sheet.id)}
                  onContextMenu={(event) =>
                    openSheetContextMenu(event, sheet.id)
                  }
                >
                  <File size={15} />
                  {renamingSheetId === sheet.id ? (
                    <input
                      className="database-sheet-rename-input"
                      value={renameDraft}
                      autoFocus
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          commitRename();
                        }
                        if (event.key === "Escape") {
                          setRenamingSheetId(null);
                        }
                      }}
                    />
                  ) : (
                    <span>{sheet.name}</span>
                  )}
                  {sheet.objectBinding ? (
                    <span className="database-tree-count">
                      {sheet.objectBinding.objectType}
                    </span>
                  ) : null}
                  {unsaved ? <span className="database-unsaved-dot" /> : null}
                </div>
              );
            })}
          </ObjectTreeGroup>
          <ObjectTreeGroup
            title={
              <>
                <span>Tables</span>
                <span className="database-tree-count">
                  {metadata.objectCounts.tables ?? metadata.tables.length}
                </span>
              </>
            }
            defaultOpen
            forceOpen={
              activeSheet?.objectBinding?.objectType === "table" ||
              activeSheet?.objectBinding?.objectType === "index" ||
              activeSheet?.objectBinding?.objectType === "trigger"
            }
          >
            {filteredTables.length > 0 ? (
              filteredTables.map((table) => (
                <TableTreeItem
                  table={table}
                  key={`${table.schema}.${table.name}`}
                  activeObjectKey={activeObjectKey}
                  onOpenTable={openTableInNewTab}
                  onOpenIndex={(tableItem, index) =>
                    void openObjectSheet("index", index.name, {
                      table: tableItem,
                      index,
                    })
                  }
                  onOpenTrigger={(tableItem, trigger) =>
                    void openObjectSheet("trigger", trigger.name, {
                      table: tableItem,
                      trigger,
                    })
                  }
                  onContextMenu={(event) => openTableContextMenu(event, table)}
                  onIndexGroupContextMenu={(event, tableItem) =>
                    openObjectGroupContextMenu(event, "index", tableItem)
                  }
                  onTriggerGroupContextMenu={(event, tableItem) =>
                    openObjectGroupContextMenu(event, "trigger", tableItem)
                  }
                />
              ))
            ) : (
              <div className="database-tree-empty">No objects match.</div>
            )}
          </ObjectTreeGroup>
          <ObjectTreeGroup
            title={
              <>
                <span>Views</span>
                <span className="database-tree-count">
                  {getObjectCollectionCount("views")}
                </span>
              </>
            }
            onOpen={() => loadObjectCollection("views")}
            onContextMenu={(event) => openObjectGroupContextMenu(event, "view")}
            forceOpen={activeSheet?.objectBinding?.objectType === "view"}
          >
            {renderObjectCollectionItems("views", <View size={15} />)}
          </ObjectTreeGroup>
          <ObjectTreeGroup
            title={
              <>
                <span>Procedures</span>
                <span className="database-tree-count">
                  {getObjectCollectionCount("procedures")}
                </span>
              </>
            }
            onOpen={() => loadObjectCollection("procedures")}
            onContextMenu={(event) =>
              openObjectGroupContextMenu(event, "procedure")
            }
            forceOpen={activeSheet?.objectBinding?.objectType === "procedure"}
          >
            {renderObjectCollectionItems("procedures", <Microchip size={15} />)}
          </ObjectTreeGroup>
          <ObjectTreeGroup
            title={
              <>
                <span>Functions</span>
                <span className="database-tree-count">
                  {getObjectCollectionCount("functions")}
                </span>
              </>
            }
            onOpen={() => loadObjectCollection("functions")}
            onContextMenu={(event) =>
              openObjectGroupContextMenu(event, "function")
            }
            forceOpen={activeSheet?.objectBinding?.objectType === "function"}
          >
            {renderObjectCollectionItems(
              "functions",
              <SquareFunction size={15} />,
            )}
          </ObjectTreeGroup>
          {connection.type === "Oracle" ? (
            <>
              <ObjectTreeGroup
                title={
                  <>
                    <span>Types</span>
                    <span className="database-tree-count">
                      {getObjectCollectionCount("types")}
                    </span>
                  </>
                }
                onOpen={() => loadObjectCollection("types")}
                onContextMenu={(event) =>
                  openObjectGroupContextMenu(event, "type")
                }
                forceOpen={activeSheet?.objectBinding?.objectType === "type"}
              >
                {renderObjectCollectionItems("types", <Box size={15} />)}
              </ObjectTreeGroup>
              <ObjectTreeGroup
                title={
                  <>
                    <span>Sequences</span>
                    <span className="database-tree-count">
                      {getObjectCollectionCount("sequences")}
                    </span>
                  </>
                }
                onOpen={() => loadObjectCollection("sequences")}
                onContextMenu={(event) =>
                  openObjectGroupContextMenu(event, "sequence")
                }
                forceOpen={
                  activeSheet?.objectBinding?.objectType === "sequence"
                }
              >
                {renderObjectCollectionItems(
                  "sequences",
                  <Sigma size={15} />,
                )}
              </ObjectTreeGroup>
              <ObjectTreeGroup
                title={
                  <>
                    <span>Packages</span>
                    <span className="database-tree-count">
                      {getObjectCollectionCount("packages")}
                    </span>
                  </>
                }
                onOpen={() => loadObjectCollection("packages")}
                onContextMenu={(event) =>
                  openObjectGroupContextMenu(event, "package")
                }
                forceOpen={activeSheet?.objectBinding?.objectType === "package"}
              >
                {renderObjectCollectionItems("packages", <Puzzle size={15} />)}
              </ObjectTreeGroup>
            </>
          ) : null}
        </div>
      </Panel>

      <div
        className="grid-splitter database-workspace-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize database object explorer and query workspace"
        onPointerDown={startResize}
        onPointerMove={resizeLayout}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
      />

      <section
        className={`panel database-query-panel${
          activeOutput.hasExecuted ? " has-output" : " no-output"
        }`}
        ref={queryPanelRef}
        style={gridStyle}
        onPointerDown={clearExecutedSqlHighlight}
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "s"
          ) {
            event.preventDefault();
            saveActiveSheet();
          }
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === "n"
          ) {
            event.preventDefault();
            createNewSheet();
          }
        }}
      >
        <div className="query-workspace-header">
          <div
            className="query-tabs-scroll-container"
            role="tablist"
            aria-label="Query sheets"
          >
            {openSheets.map((sheet) => {
              const active = activeSheet?.id === sheet.id;
              const unsaved =
                sheet.name !== sheet.savedName || sheet.sql !== sheet.savedSql;
              return (
                <div
                  className={`query-tab${active ? " active" : ""}${
                    draggingSheetId === sheet.id ? " query-tab-dragging" : ""
                  }`}
                  key={sheet.id}
                  draggable
                  onDragStart={(event) => beginSheetDrag(event, sheet.id)}
                  onDragOver={allowSheetDrop}
                  onDrop={(event) => dropSheet(event, sheet.id)}
                  onDragEnd={() => setDraggingSheetId(null)}
                >
                  <button
                    className="query-tab-main"
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => selectSheet(sheet.id)}
                  >
                    <span>{sheet.name}</span>
                    {unsaved ? <span className="database-unsaved-dot" /> : null}
                  </button>
                  <button
                    className="query-tab-close"
                    type="button"
                    aria-label={`Close ${sheet.name}`}
                    title={`Close ${sheet.name}`}
                    onClick={() => closeSheetTab(sheet.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="execute-button-container">
            <button
              className="button primary compact"
              type="button"
              onClick={executeFromActiveEditor}
              disabled={!activeSheet || isExecuting}
            >
              {isExecuting ? (
                <LoaderCircle className="button-spinner" size={15} />
              ) : (
                <Play size={15} />
              )}
              <span>Execute</span>
            </button>
          </div>
        </div>
        <SqlEditor
          sheetId={activeSheet?.id ?? "empty"}
          value={activeSheet?.sql ?? ""}
          onChange={updateActiveSheetSql}
          onExecute={executeFromEditorView}
          onSave={saveActiveSheet}
          onNewSheet={createNewSheet}
          onViewReady={(view) => {
            editorViewRef.current = view;
          }}
          completionData={completionData}
        />
        {activeOutput.hasExecuted ? (
          <>
            <div
              className="grid-splitter row-splitter database-editor-result-splitter"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize SQL editor and results area"
              onPointerDown={startEditorResize}
              onPointerMove={resizeEditorLayout}
              onPointerUp={stopEditorResize}
              onPointerCancel={stopEditorResize}
            />
            <div className="database-output-panel">
              <div className="database-output-toolbar">
                <div
                  className="database-output-tabs"
                  role="tablist"
                  aria-label="Query output"
                >
                  <button
                    className={
                      activeOutput.activeOutputTab === "results"
                        ? "active"
                        : undefined
                    }
                    type="button"
                    role="tab"
                    aria-selected={activeOutput.activeOutputTab === "results"}
                    onClick={() =>
                      updateActiveSheetOutput((output) => ({
                        ...output,
                        activeOutputTab: "results",
                      }))
                    }
                  >
                    Results
                  </button>
                  <button
                    className={
                      activeOutput.activeOutputTab === "messages"
                        ? "active"
                        : undefined
                    }
                    type="button"
                    role="tab"
                    aria-selected={activeOutput.activeOutputTab === "messages"}
                    onClick={() =>
                      updateActiveSheetOutput((output) => ({
                        ...output,
                        activeOutputTab: "messages",
                      }))
                    }
                  >
                    Messages
                  </button>
                </div>
                <div className="database-output-actions">
                  <button
                    className="icon-button secondary database-output-reload"
                    type="button"
                    aria-label="Reload results"
                    title="Reload results"
                    onClick={reloadLastExecution}
                    disabled={
                      !activeOutput.lastExecutionTarget ||
                      isExecuting ||
                      metadataLoading
                    }
                  >
                    <RefreshCcw size={15} />
                  </button>
                  <button
                    className="icon-button secondary database-output-reload"
                    type="button"
                    aria-label="Expand results"
                    title="Expand results"
                    onClick={() => setResultFullscreenOpen(true)}
                    disabled={
                      activeOutput.activeOutputTab !== "results" ||
                      activeOutput.resultTabs.length === 0
                    }
                  >
                    <Maximize2 size={15} />
                  </button>
                  <ResultExportMenu
                    resultTab={activeResultTab}
                    connection={connection}
                    sheet={activeSheet}
                  />
                </div>
              </div>
              {activeOutput.activeOutputTab === "results" ? (
                <ResultTabsPanel
                  tabs={activeOutput.resultTabs}
                  activeTabId={activeOutput.activeResultTabId}
                  metadataTables={metadata.tables}
                  onTabChange={(activeResultTabId) =>
                    updateActiveSheetOutput((output) => ({
                      ...output,
                      activeResultTabId,
                    }))
                  }
                  onColumnWidthsChange={(columnWidths) =>
                    updateActiveResultTab((tab) => ({
                      ...tab,
                      columnWidths,
                    }))
                  }
                  onLoadMoreRows={(tabId) => {
                    void loadMoreResultRows(tabId);
                  }}
                />
              ) : (
                <MessageLog messages={activeOutput.messages} />
              )}
            </div>
          </>
        ) : null}
      </section>

      {contextMenu ? (
        <SheetContextMenuView
          menu={contextMenu}
          onNewSheet={createNewSheet}
          onRename={startRename}
          onDelete={requestDeleteSheet}
          onSelectTable={appendTableSelectTemplate}
          onInsertTableTemplate={insertTableTemplate}
          onOpenTableInNewTab={openTableInNewTab}
          onCreateTemplateSheet={createTemplateSheet}
        />
      ) : null}
      <Modal
        open={resultFullscreenOpen && activeOutput.resultTabs.length > 0}
        title="Results"
        subtitle={activeSheet?.name}
        size="xl"
        className="database-result-fullscreen-modal"
        contentClassName="database-result-fullscreen-content"
        closeLabel="Close expanded results"
        onClose={() => setResultFullscreenOpen(false)}
      >
        <ResultTabsPanel
          tabs={activeOutput.resultTabs}
          activeTabId={activeOutput.activeResultTabId}
          metadataTables={metadata.tables}
          onTabChange={(activeResultTabId) =>
            updateActiveSheetOutput((output) => ({
              ...output,
              activeResultTabId,
            }))
          }
          onColumnWidthsChange={(columnWidths) =>
            updateActiveResultTab((tab) => ({
              ...tab,
              columnWidths,
            }))
          }
          onLoadMoreRows={(tabId) => {
            void loadMoreResultRows(tabId);
          }}
        />
      </Modal>
      {deleteRequest ? (
        <ConfirmDialog
          title="Delete sheet?"
          message={`Are you sure you want to delete "${deleteRequest.sheetName}"? This action cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onClose={() => setDeleteRequest(null)}
          onConfirm={() => deleteSheet(deleteRequest.sheetId)}
        />
      ) : null}
      {closeRequest ? (
        <ConfirmDialog
          title="Close unsaved sheet?"
          message={`"${closeRequest.sheetName}" has unsaved changes. Close it and discard those changes?`}
          confirmLabel="Close without saving"
          cancelLabel="Cancel"
          variant="danger"
          onClose={() => setCloseRequest(null)}
          onConfirm={() => closeSheetTabConfirmed(closeRequest.sheetId, true)}
        />
      ) : null}
      {autoSaveError ? (
        <div className="app-snackbar database-autosave-snackbar invalid">
          {autoSaveError}
        </div>
      ) : null}
    </div>
  );
}
