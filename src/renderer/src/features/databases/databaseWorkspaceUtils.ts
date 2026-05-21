import type {
  DatabaseConnection,
  DatabaseConnectionType,
  DatabaseMetadata,
  DatabaseStatementExecutionResult,
  DatabaseTable,
  DatabaseWorksheet,
  DatabaseWorksheetState,
} from "../../types";
import { clamp } from "../../utils/math";
import { formatCompactTime } from "./databaseFormatters";
import type {
  DatabaseMetadataState,
  MessageEntry,
  QuerySheet,
  ResultColumn,
  ResultRow,
  ResultTab,
  SheetConnectionState,
  SheetOutputState,
} from "./DatabaseWorkspace";

const DEFAULT_SQL = "";
const DEFAULT_PAGE_SIZE = 5;
const DATABASE_METADATA_LOAD_TIMEOUT_MS = 30_000;
let querySheetSequence = 0;

export function createQuerySheet(name: string, sql = DEFAULT_SQL): QuerySheet {
  querySheetSequence += 1;
  return {
    id: `query-sheet-${Date.now()}-${querySheetSequence}`,
    name,
    sql,
    savedName: name,
    savedSql: sql,
    savedAt: null,
    savedOrder: null,
    output: createEmptySheetOutput(),
  };
}

export function createQuerySheetFromPersisted(
  sheet: DatabaseWorksheet,
  index: number,
): QuerySheet {
  return {
    id: sheet.sheetId,
    name: sheet.sheetName,
    sql: sheet.sql,
    savedName: sheet.sheetName,
    savedSql: sheet.sql,
    savedAt: sheet.savedAt,
    savedOrder: Number.isFinite(sheet.sortOrder) ? sheet.sortOrder : index,
    sheetMode: sheet.sheetMode,
    objectBinding: sheet.objectBinding,
    output: createEmptySheetOutput(),
  };
}

export function sheetStateFromPersisted(
  persistedState: DatabaseWorksheetState,
): SheetConnectionState {
  const sheets = persistedState.sheets
    .filter(isPersistableWorksheet)
    .map(createQuerySheetFromPersisted);
  if (sheets.length === 0) {
    return createInitialSheetState();
  }
  const openSheetIds = persistedState.sheets
    .filter(isPersistableWorksheet)
    .filter((sheet) => sheet.isOpen)
    .map((sheet) => sheet.sheetId);
  const activeSheetId =
    persistedState.activeSheetId &&
    sheets.some((sheet) => sheet.id === persistedState.activeSheetId)
      ? persistedState.activeSheetId
      : (openSheetIds[0] ?? sheets[0]?.id ?? "");

  return {
    sheets,
    activeSheetId,
    openSheetIds: openSheetIds.length
      ? openSheetIds
      : activeSheetId
        ? [activeSheetId]
        : [],
  };
}

export function serializePersistedWorksheetState(
  connectionId: string,
  state: SheetConnectionState,
): DatabaseWorksheetState {
  const persistedSheets = state.sheets
    .filter(isPersistableSheet)
    .map((sheet, index) => ({
      connectionId,
      sheetId: sheet.id,
      sheetName: sheet.name.trim() || "Untitled",
      sql: sheet.sql,
      savedAt: new Date().toISOString(),
      isOpen: state.openSheetIds.includes(sheet.id),
      sortOrder: index,
      sheetMode: sheet.sheetMode,
      objectBinding: sheet.objectBinding,
    }));
  const activeSheetId = persistedSheets.some(
    (sheet) => sheet.sheetId === state.activeSheetId,
  )
    ? state.activeSheetId
    : null;

  return { connectionId, sheets: persistedSheets, activeSheetId };
}

export function worksheetStateNeedsPersist(
  state: SheetConnectionState,
): boolean {
  return state.sheets.some((sheet, index) => {
    if (!isPersistableSheet(sheet)) {
      return false;
    }

    return (
      sheet.savedAt === null ||
      sheet.savedOrder !== index ||
      sheet.name !== sheet.savedName ||
      sheet.sql !== sheet.savedSql
    );
  });
}

export function isPersistableSheet(sheet: QuerySheet): boolean {
  return (
    sheet.sheetMode !== "object-backed" &&
    sheet.sheetMode !== "transient-preview"
  );
}

function isPersistableWorksheet(sheet: DatabaseWorksheet): boolean {
  return (
    sheet.sheetMode !== "object-backed" &&
    sheet.sheetMode !== "transient-preview"
  );
}

export function markWorksheetStateSnapshotSaved(
  current: SheetConnectionState,
  snapshot: SheetConnectionState,
  savedAt: string,
): SheetConnectionState {
  const snapshotSheets = new Map(
    snapshot.sheets.map((sheet, index) => [
      sheet.id,
      { name: sheet.name, sql: sheet.sql, order: index },
    ]),
  );

  return {
    ...current,
    sheets: current.sheets.map((sheet) => {
      if (!isPersistableSheet(sheet)) {
        return sheet;
      }

      const snapshotSheet = snapshotSheets.get(sheet.id);
      if (
        !snapshotSheet ||
        sheet.name !== snapshotSheet.name ||
        sheet.sql !== snapshotSheet.sql
      ) {
        return sheet;
      }

      return {
        ...sheet,
        savedName: snapshotSheet.name,
        savedSql: snapshotSheet.sql,
        savedAt,
        savedOrder: snapshotSheet.order,
      };
    }),
  };
}

export async function persistSavedWorksheetState(
  connectionId: string,
  state: SheetConnectionState,
): Promise<DatabaseWorksheetState> {
  return window.ivsDashboard.saveDatabaseWorksheetState(
    serializePersistedWorksheetState(connectionId, state),
  );
}

export function createEmptySheetOutput(): SheetOutputState {
  return {
    hasExecuted: false,
    activeOutputTab: "results",
    resultTabs: [],
    activeResultTabId: null,
    messages: [],
    lastExecutionTarget: null,
  };
}

export function prependSheetMessage(
  output: SheetOutputState,
  tone: MessageEntry["tone"],
  text: string,
  markExecuted = false,
): SheetOutputState {
  return {
    ...output,
    hasExecuted: output.hasExecuted || markExecuted,
    messages: [
      {
        id: `message-${Date.now()}-${Math.round(Math.random() * 10000)}`,
        tone,
        text,
        time: new Date().toISOString(),
      },
      ...output.messages,
    ],
  };
}

export function createEmptyMetadata(): DatabaseMetadata {
  return {
    schemas: [],
    tables: [],
    views: [],
    procedures: [],
    functions: [],
    types: [],
    sequences: [],
    packages: [],
    objectCounts: {},
  };
}

export function createIdleMetadataState(): DatabaseMetadataState {
  return { status: "idle", metadata: createEmptyMetadata() };
}

export function createLoadingMetadataState(
  metadata = createEmptyMetadata(),
): DatabaseMetadataState {
  return { status: "loading", metadata };
}

export async function fetchDatabaseMetadata(
  connection: DatabaseConnection,
): Promise<DatabaseMetadata> {
  return normalizeDatabaseMetadata(
    await withTimeout(
      window.ivsDashboard.getDatabaseMetadata(connection),
      DATABASE_METADATA_LOAD_TIMEOUT_MS,
      "Database metadata loading timed out. You can still run SQL; retry Object Explorer when the database is reachable.",
    ),
  );
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: number | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  });
}

export function normalizeDatabaseMetadata(
  metadata: Partial<DatabaseMetadata>,
): DatabaseMetadata {
  const fallback = createEmptyMetadata();
  return {
    schemas: Array.isArray(metadata.schemas)
      ? metadata.schemas
      : fallback.schemas,
    tables: Array.isArray(metadata.tables)
      ? metadata.tables.map((table) => ({
          ...table,
          estimatedRowCount:
            typeof table.estimatedRowCount === "number"
              ? table.estimatedRowCount
              : table.estimatedRowCount === null
                ? null
                : undefined,
          columns: Array.isArray(table.columns) ? table.columns : [],
          indexes: Array.isArray(table.indexes) ? table.indexes : [],
          triggers: Array.isArray(table.triggers) ? table.triggers : [],
          partitions: Array.isArray(table.partitions) ? table.partitions : [],
        }))
      : fallback.tables,
    views: Array.isArray(metadata.views) ? metadata.views : [],
    procedures: Array.isArray(metadata.procedures) ? metadata.procedures : [],
    functions: Array.isArray(metadata.functions) ? metadata.functions : [],
    types: Array.isArray(metadata.types) ? metadata.types : [],
    sequences: Array.isArray(metadata.sequences) ? metadata.sequences : [],
    packages: Array.isArray(metadata.packages) ? metadata.packages : [],
    objectCounts:
      metadata.objectCounts && typeof metadata.objectCounts === "object"
        ? metadata.objectCounts
        : {},
  };
}

export function createInitialSheetState(): SheetConnectionState {
  const sheet = createQuerySheet("Untitled-1");
  return { sheets: [sheet], activeSheetId: sheet.id, openSheetIds: [sheet.id] };
}

export function splitSqlStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sqlText.length; index += 1) {
    const char = sqlText[index];
    const next = sqlText[index + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }

    if (char === ";") {
      const statement = sqlText.slice(start, index).trim();
      if (statement) {
        statements.push(statement);
      }
      start = index + 1;
    }
  }

  const tail = sqlText.slice(start).trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
}

export function createResultTabs(
  results: DatabaseStatementExecutionResult[],
): ResultTab[] {
  const baseNames = results.map(
    (result, index) =>
      detectStatementTableName(result.statement) ?? `Statement ${index + 1}`,
  );
  const names = disambiguateTabNames(baseNames);

  return results.map((result, index) => ({
    id: `result-${Date.now()}-${index}`,
    name: names[index],
    statementSql: result.statement,
    rows: result.rows,
    columns: result.columns.map((column) => ({
      key: column.key,
      label: column.label,
      databaseType: column.type,
      kind: inferResultColumnKind(column.type, result.rows, column.key),
      minWidth: calculateColumnMinimumWidth(column.label, column.type),
      weight:
        column.type && /text|char|json|blob/i.test(column.type) ? 1.25 : 1,
    })),
    meta: {
      hasRun: true,
      rows: result.rowsFetched,
      rowsAffected: result.rowsAffected,
      duration: formatDurationMs(result.durationMs),
      queriedAt: new Date().toISOString(),
      status: result.status,
      errorMessage: result.errorMessage,
    },
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    columnWidths: {},
  }));
}

export function selectInitialResultTabId(tabs: ResultTab[]): string | null {
  return (
    tabs.find((tab) => tab.rows.length > 0)?.id ??
    tabs[tabs.length - 1]?.id ??
    null
  );
}

export function createBatchMessages(
  results: DatabaseStatementExecutionResult[],
  time: string,
  source: "execute" | "reload",
): MessageEntry[] {
  const succeeded = results.filter((result) => result.status === "success");
  const failed = results.filter((result) => result.status === "error");
  const messages: MessageEntry[] = [
    {
      id: `message-${Date.now()}-summary`,
      tone: failed.length > 0 ? "error" : "success",
      text: `${results.length} ${pluralize("statement", results.length)} ${
        source === "reload" ? "reloaded" : "executed"
      }. ${succeeded.length} succeeded, ${failed.length} failed.`,
      time,
    },
  ];

  results.forEach((result, index) => {
    if (result.status === "error") {
      messages.push({
        id: `message-${Date.now()}-${index}-error`,
        tone: "error",
        text: `Statement ${index + 1} failed: ${
          result.errorMessage ?? "Execution failed."
        }`,
        time,
      });
      return;
    }

    if (result.rowsFetched > 0) {
      messages.push({
        id: `message-${Date.now()}-${index}-fetched`,
        tone: "success",
        text: `Statement ${index + 1}: ${result.rowsFetched} ${pluralize(
          "row",
          result.rowsFetched,
        )} fetched in ${formatDurationMs(result.durationMs)}.`,
        time,
      });
      return;
    }

    if (result.rowsAffected !== undefined) {
      messages.push({
        id: `message-${Date.now()}-${index}-affected`,
        tone: "success",
        text: `Statement ${index + 1}: ${result.rowsAffected} ${pluralize(
          "row",
          result.rowsAffected,
        )} affected in ${formatDurationMs(result.durationMs)}.`,
        time,
      });
      return;
    }

    messages.push({
      id: `message-${Date.now()}-${index}-success`,
      tone: "success",
      text: `Statement ${index + 1}: Succeeded in ${formatDurationMs(
        result.durationMs,
      )}.`,
      time,
    });
  });

  return messages;
}

export function hasSuccessfulSchemaChange(
  results: DatabaseStatementExecutionResult[],
): boolean {
  return results.some(
    (result) =>
      result.status === "success" &&
      isSchemaChangingStatement(result.statement),
  );
}

export function hasSuccessfulRowCountChange(
  results: DatabaseStatementExecutionResult[],
): boolean {
  return results.some(
    (result) =>
      result.status === "success" &&
      ((result.rowsAffected ?? 0) > 0 ||
        /^\s*truncate(?:\s+table)?\s+/i.test(result.statement)) &&
      /^\s*(insert|delete|truncate|load\s+data)\b/i.test(result.statement),
  );
}

export function isSchemaChangingStatement(statement: string): boolean {
  return /^\s*(create|drop|alter|rename|truncate)\s+(table|view|procedure|function|index|trigger|schema|database)\b/i.test(
    statement,
  );
}

export function detectStatementTableName(statement: string): string | null {
  const normalized = statement.replace(/\s+/g, " ").trim();
  const patterns = [
    /\bselect\b[\s\S]*?\bfrom\s+([`"\w.]+)/i,
    /\bdesc(?:ribe)?\s+([`"\w.]+)/i,
    /\binsert\s+into\s+([`"\w.]+)/i,
    /\bupdate\s+([`"\w.]+)/i,
    /\bdelete\s+from\s+([`"\w.]+)/i,
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([`"\w.]+)/i,
    /\balter\s+table\s+([`"\w.]+)/i,
    /\bdrop\s+table\s+(?:if\s+exists\s+)?([`"\w.]+)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match?.[1]) {
      return stripSchemaPrefix(match[1]);
    }
  }

  return null;
}

export function stripSchemaPrefix(identifier: string): string {
  const cleaned = identifier
    .replace(/^[`"']|[`"']$/g, "")
    .replace(/[),;].*$/, "");
  const parts = cleaned.split(".");
  return parts[parts.length - 1]?.replace(/^[`"']|[`"']$/g, "") || cleaned;
}

export function disambiguateTabNames(names: string[]): string[] {
  const counts = new Map<string, number>();
  return names.map((name) => {
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

export function inferResultColumnKind(
  type: string | undefined,
  rows: ResultRow[],
  key: string,
): ResultColumn["kind"] {
  if (type && /int|decimal|float|double|numeric|bit/i.test(type)) {
    return "number";
  }
  if (type && /date|time|year/i.test(type)) {
    return "date";
  }

  const sampleValue = rows.find((row) => row[key] !== null)?.[key];
  if (typeof sampleValue === "number") {
    return "number";
  }
  if (typeof sampleValue === "string") {
    return "text";
  }
  return "unknown";
}

export function calculateColumnMinimumWidth(
  label: string,
  type?: string,
): number {
  return clamp((label.length + (type?.length ?? 0) + 6) * 8, 90, 240);
}

export function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

export function formatDurationMs(durationMs: number): string {
  return `${Math.max(1, durationMs).toFixed(1)} ms`;
}

export function formatObjectName(table: DatabaseTable): string {
  return table.schema ? `${table.name}` : table.name;
}

export function quoteSqlIdentifier(
  identifier: string,
  connectionType: DatabaseConnectionType,
): string {
  if (connectionType === "Oracle") {
    return `"${identifier.replace(/"/g, "\"\"")}"`;
  }

  return `\`${identifier.replace(/`/g, "``")}\``;
}

export function quoteQualifiedTableName(
  table: DatabaseTable,
  connectionType: DatabaseConnectionType,
): string {
  return table.schema
    ? `${quoteSqlIdentifier(table.schema, connectionType)}.${quoteSqlIdentifier(table.name, connectionType)}`
    : quoteSqlIdentifier(table.name, connectionType);
}

export function createInsertTemplate(
  table: DatabaseTable,
  connectionType: DatabaseConnectionType,
): string {
  const columns = table.columns.map((column) => column.name);
  if (columns.length === 0) {
    return `INSERT INTO ${quoteQualifiedTableName(table, connectionType)} (\n  column_1\n) VALUES (\n  value_1\n);`;
  }

  const columnLines = columns
    .map(
      (column, index) =>
        `  ${quoteSqlIdentifier(column, connectionType)}${index < columns.length - 1 ? "," : ""}`,
    )
    .join("\n");
  const valueLines = columns
    .map(
      (_, index) =>
        `  value_${index + 1}${index < columns.length - 1 ? "," : ""}`,
    )
    .join("\n");

  return `INSERT INTO ${quoteQualifiedTableName(table, connectionType)} (\n${columnLines}\n) VALUES (\n${valueLines}\n);`;
}

export function createSelectTemplate(
  table: DatabaseTable,
  connectionType: DatabaseConnectionType,
): string {
  const columns = table.columns.map((column) => column.name);
  const columnLines =
    columns.length > 0
      ? columns
          .map(
            (column, index) =>
              `  ${quoteSqlIdentifier(column, connectionType)}${index < columns.length - 1 ? "," : ""}`,
          )
          .join("\n")
      : "  column_1";

  return `SELECT\n${columnLines}\nFROM ${quoteQualifiedTableName(table, connectionType)};`;
}

export function limitSelectTemplate(
  sql: string,
  connectionType: DatabaseConnectionType,
  rowLimit: number,
): string {
  const baseSql = sql.replace(/;\s*$/, "");
  return connectionType === "Oracle"
    ? `${baseSql}\nFETCH FIRST ${rowLimit} ROWS ONLY;`
    : `${baseSql}\nLIMIT ${rowLimit};`;
}

export function appendSqlStatement(sql: string, statement: string): string {
  const trimmedSql = sql.trimEnd();
  return trimmedSql ? `${trimmedSql}\n\n${statement}` : statement;
}

export function createExecutionHistoryMessage(
  result: DatabaseStatementExecutionResult,
): string {
  if (result.status === "error") {
    return result.errorMessage
      ? `Failed: ${result.errorMessage}`
      : "Execution failed.";
  }

  if (result.rowsFetched > 0) {
    return `${result.rowsFetched} ${pluralize(
      "row",
      result.rowsFetched,
    )} fetched in ${formatDurationMs(result.durationMs)}.`;
  }

  if (result.rowsAffected !== undefined) {
    return `${result.rowsAffected} ${pluralize(
      "row",
      result.rowsAffected,
    )} affected in ${formatDurationMs(result.durationMs)}.`;
  }

  return `Succeeded in ${formatDurationMs(result.durationMs)}.`;
}

export function ensureSqlTerminator(sqlText: string): string {
  const trimmed = sqlText.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

export function nextHistorySheetName(
  time: string,
  sheets: QuerySheet[],
): string {
  const minute = formatHistorySheetMinute(time);
  const prefix = `History ${minute} #`;
  const sequence =
    sheets.reduce((max, sheet) => {
      const match = new RegExp(`^${escapeRegExp(prefix)}(\\d+)`).exec(
        sheet.name,
      );
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0) + 1;
  return disambiguateSheetName(`History ${minute} #${sequence}`, sheets);
}

export function formatHistorySheetMinute(value: string): string {
  return formatCompactTime(value).slice(0, 16);
}

export function disambiguateSheetName(
  name: string,
  sheets: QuerySheet[],
): string {
  const names = new Set(sheets.map((sheet) => sheet.name.toLowerCase()));
  if (!names.has(name.toLowerCase())) {
    return name;
  }

  let suffix = 2;
  while (names.has(`${name} (${suffix})`.toLowerCase())) {
    suffix += 1;
  }
  return `${name} (${suffix})`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function nextUntitledName(sheets: QuerySheet[]): string {
  const usedNumbers = new Set<number>();
  for (const sheet of sheets) {
    const match = /^Untitled-(\d+)$/i.exec(sheet.name);
    if (match) {
      usedNumbers.add(Number(match[1]));
    }
  }

  let nextNumber = 1;
  while (usedNumbers.has(nextNumber)) {
    nextNumber += 1;
  }
  return `Untitled-${nextNumber}`;
}
