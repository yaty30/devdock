import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Database,
  File,
  LoaderCircle,
  Play,
  RefreshCcw,
  Save,
  Search,
  Table2,
  X,
} from "lucide-react";
import { Panel } from "../../components/common/Panel";
import { ConfirmDialog } from "../../components/dialogs/ConfirmDialog";
import type {
  DatabaseConnection,
  DatabaseExecutionRecord,
  DatabaseWorkspaceTab,
} from "../../types";
import { clamp } from "../../utils/math";

type QuerySheet = {
  id: string;
  name: string;
  sql: string;
  savedName: string;
  savedSql: string;
};

type SheetConnectionState = {
  sheets: QuerySheet[];
  activeSheetId: string;
  openSheetIds: string[];
};

type SheetContextMenu =
  | { kind: "sheets"; x: number; y: number }
  | { kind: "sheet"; sheetId: string; x: number; y: number };

type ResultRow = {
  actor_id: number;
  first_name: string;
  last_name: string;
  last_update: string;
};

type ResultMeta = {
  rows: number;
  duration: string;
  queriedAt: string;
  status: "success" | "error";
  errorMessage?: string;
};

type MessageEntry = {
  id: string;
  tone: "success" | "error";
  text: string;
  time: string;
};

type ColumnMetadata = Array<{ label: string; value: string }>;

type DatabaseColumn = {
  name: string;
  metadata: ColumnMetadata;
};

type DatabaseTable = {
  name: string;
  columns: DatabaseColumn[];
};

type DatabaseDragState = {
  startX: number;
  startExplorerWidth: number;
  minExplorerWidth: number;
  maxExplorerWidth: number;
};

type DatabaseEditorDragState = {
  startY: number;
  startEditorHeight: number;
  minEditorHeight: number;
  maxEditorHeight: number;
};

type ExecutionTarget = {
  sql: string;
  from: number;
  to: number;
};

type LastExecutionTarget = ExecutionTarget & {
  sheetId: string;
};

type SheetDeleteRequest = {
  sheetId: string;
  sheetName: string;
};

type SheetCloseRequest = {
  sheetId: string;
  sheetName: string;
};

type ResultColumnKey = keyof ResultRow;

type ResultColumn = {
  key: ResultColumnKey;
  label: string;
  minWidth: number;
};

type ResultColumnDragState = {
  key: ResultColumnKey;
  startX: number;
  startWidth: number;
};

type DatabaseCompletionData = {
  keywords: string[];
  tables: string[];
  columns: string[];
};

const DEFAULT_SQL = `select actor_id, first_name, last_name, last_update
from sakila.actor
where actor_id <= 4
order by actor_id;`;

const DATABASE_EXPLORER_MIN_WIDTH = 220;
const DATABASE_EXPLORER_MAX_WIDTH = 420;
const DATABASE_QUERY_MIN_WIDTH = 600;
const DATABASE_SPLITTER_SIZE = 16;
const DEFAULT_EXPLORER_WIDTH = 320;
const DEFAULT_PAGE_SIZE = 5;
const DEFAULT_EDITOR_HEIGHT = 260;
const DATABASE_EDITOR_MIN_HEIGHT = 160;
const DATABASE_OUTPUT_MIN_HEIGHT = 160;
const DATABASE_EDITOR_SPLITTER_SIZE = 14;

const RESULT_COLUMNS: ResultColumn[] = [
  { key: "actor_id", label: "actor_id", minWidth: 92 },
  { key: "first_name", label: "first_name", minWidth: 132 },
  { key: "last_name", label: "last_name", minWidth: 132 },
  { key: "last_update", label: "last_update", minWidth: 210 },
];

const DEFAULT_RESULT_COLUMN_WIDTHS: Record<ResultColumnKey, number> = {
  actor_id: 110,
  first_name: 160,
  last_name: 160,
  last_update: 240,
};

const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--cm-sql-keyword)", fontWeight: "800" },
  { tag: tags.string, color: "var(--cm-sql-string)" },
  { tag: tags.number, color: "var(--cm-sql-number)" },
  { tag: tags.comment, color: "var(--cm-sql-comment)", fontStyle: "italic" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--cm-sql-function)",
    fontWeight: "750",
  },
  { tag: tags.operator, color: "var(--cm-sql-operator)" },
  { tag: tags.atom, color: "var(--cm-sql-atom)" },
  { tag: tags.variableName, color: "var(--cm-sql-name)" },
]);

const setExecutedSqlRange = StateEffect.define<ExecutionTarget | null>();

const executedSqlHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, transaction) {
    let decorations = value.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (effect.is(setExecutedSqlRange)) {
        const target = effect.value;
        decorations = target
          ? Decoration.set([
              Decoration.mark({ class: "cm-executed-sql" }).range(
                target.from,
                target.to,
              ),
            ])
          : Decoration.none;
      }
    }

    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "ON",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "INSERT",
  "UPDATE",
  "DELETE",
  "LIMIT",
  "OFFSET",
  "AND",
  "OR",
  "AS",
  "DISTINCT",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
];

let querySheetSequence = 0;

const SAMPLE_TABLES: DatabaseTable[] = [
  {
    name: "actor",
    columns: [
      {
        name: "actor_id",
        metadata: [
          { label: "Type", value: "SMALLINT UNSIGNED" },
          { label: "Key", value: "Primary key" },
          { label: "Null", value: "Not nullable" },
          { label: "Default", value: "None" },
          { label: "Extra", value: "Auto increment" },
        ],
      },
      {
        name: "first_name",
        metadata: [
          { label: "Type", value: "VARCHAR(45)" },
          { label: "Null", value: "Not nullable" },
          { label: "Collation", value: "utf8mb4_0900_ai_ci" },
        ],
      },
      {
        name: "last_name",
        metadata: [
          { label: "Type", value: "VARCHAR(45)" },
          { label: "Null", value: "Not nullable" },
          { label: "Index", value: "idx_actor_last_name" },
        ],
      },
      {
        name: "email",
        metadata: [
          { label: "Type", value: "VARCHAR(255)" },
          { label: "Null", value: "Nullable" },
        ],
      },
      {
        name: "address",
        metadata: [
          { label: "Type", value: "VARCHAR(255)" },
          { label: "Null", value: "Nullable" },
        ],
      },
      {
        name: "last_update",
        metadata: [
          { label: "Type", value: "TIMESTAMP" },
          { label: "Null", value: "Not nullable" },
          { label: "Default", value: "CURRENT_TIMESTAMP" },
          { label: "On update", value: "CURRENT_TIMESTAMP" },
        ],
      },
      {
        name: "created_at",
        metadata: [
          { label: "Type", value: "TIMESTAMP" },
          { label: "Null", value: "Not nullable" },
          { label: "Default", value: "CURRENT_TIMESTAMP" },
        ],
      },
    ],
  },
  {
    name: "film",
    columns: [
      { name: "film_id", metadata: [{ label: "Type", value: "INT UNSIGNED" }] },
      { name: "title", metadata: [{ label: "Type", value: "VARCHAR(128)" }] },
      { name: "rating", metadata: [{ label: "Type", value: "VARCHAR(10)" }] },
      {
        name: "last_update",
        metadata: [{ label: "Type", value: "TIMESTAMP" }],
      },
    ],
  },
  {
    name: "customer",
    columns: [
      {
        name: "customer_id",
        metadata: [{ label: "Type", value: "INT UNSIGNED" }],
      },
      {
        name: "first_name",
        metadata: [{ label: "Type", value: "VARCHAR(45)" }],
      },
      {
        name: "last_name",
        metadata: [{ label: "Type", value: "VARCHAR(45)" }],
      },
      { name: "email", metadata: [{ label: "Type", value: "VARCHAR(80)" }] },
    ],
  },
  {
    name: "rental",
    columns: [
      {
        name: "rental_id",
        metadata: [{ label: "Type", value: "INT UNSIGNED" }],
      },
      { name: "rental_date", metadata: [{ label: "Type", value: "DATETIME" }] },
      {
        name: "customer_id",
        metadata: [{ label: "Type", value: "INT UNSIGNED" }],
      },
      { name: "film_id", metadata: [{ label: "Type", value: "INT UNSIGNED" }] },
    ],
  },
];

const SAMPLE_RESULT_ROWS: ResultRow[] = [
  {
    actor_id: 1,
    first_name: "PENELOPE",
    last_name: "GUINESS",
    last_update: "2026-05-05 09:18:22",
  },
  {
    actor_id: 2,
    first_name: "NICK",
    last_name: "WAHLBERG",
    last_update: "2026-05-05 09:18:22",
  },
  {
    actor_id: 3,
    first_name: "ED",
    last_name: "CHASE",
    last_update: "2026-05-05 09:18:22",
  },
  {
    actor_id: 4,
    first_name: "JENNIFER",
    last_name: "DAVIS",
    last_update: "2026-05-05 09:18:22",
  },
];

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

export function DatabaseWorkspace({
  connection,
  activeTab,
  executionHistory,
  queryCount,
  lastRefreshTime,
  onExecution,
  onRefresh,
}: {
  connection: DatabaseConnection;
  activeTab: DatabaseWorkspaceTab;
  executionHistory: DatabaseExecutionRecord[];
  queryCount: number;
  lastRefreshTime: string;
  onExecution: (record: DatabaseExecutionRecord) => void;
  onRefresh: () => void;
}): JSX.Element {
  return (
    <section className="database-screen resizable-panel-screen">
      {activeTab === "connection" ? (
        <ConnectionActionWorkspace
          connection={connection}
          onExecution={onExecution}
          onRefresh={onRefresh}
        />
      ) : (
        <DatabaseMonitor
          connection={connection}
          executionHistory={executionHistory}
          queryCount={queryCount}
          lastRefreshTime={lastRefreshTime}
        />
      )}
    </section>
  );
}

function ConnectionActionWorkspace({
  connection,
  onExecution,
  onRefresh,
}: {
  connection: DatabaseConnection;
  onExecution: (record: DatabaseExecutionRecord) => void;
  onRefresh: () => void;
}): JSX.Element {
  const initialSheet = useMemo(() => createQuerySheet("Untitled-1"), []);
  const gridRef = useRef<HTMLDivElement>(null);
  const queryPanelRef = useRef<HTMLElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const executingRef = useRef(false);
  const dragRef = useRef<DatabaseDragState | null>(null);
  const editorDragRef = useRef<DatabaseEditorDragState | null>(null);
  const [filter, setFilter] = useState("");
  const [sheetStateByConnection, setSheetStateByConnection] = useState<
    Record<string, SheetConnectionState>
  >(() => ({
    [connection.id]: {
      sheets: [initialSheet],
      activeSheetId: initialSheet.id,
      openSheetIds: [initialSheet.id],
    },
  }));
  const [contextMenu, setContextMenu] = useState<SheetContextMenu | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<SheetDeleteRequest | null>(
    null,
  );
  const [closeRequest, setCloseRequest] = useState<SheetCloseRequest | null>(
    null,
  );
  const [renamingSheetId, setRenamingSheetId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [activeOutputTab, setActiveOutputTab] = useState<
    "results" | "messages"
  >("results");
  const [resultRows, setResultRows] = useState<ResultRow[]>(SAMPLE_RESULT_ROWS);
  const [resultMeta, setResultMeta] = useState<ResultMeta>({
    rows: SAMPLE_RESULT_ROWS.length,
    duration: "0.0 ms",
    queriedAt: new Date().toISOString(),
    status: "success",
  });
  const [resultPage, setResultPage] = useState(1);
  const [resultPageSize, setResultPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [messages, setMessages] = useState<MessageEntry[]>([
    {
      id: "initial-message",
      tone: "success",
      text: "Ready. Mock execution is available for local UI development.",
      time: new Date().toISOString(),
    },
  ]);
  const [explorerWidth, setExplorerWidth] = useState(DEFAULT_EXPLORER_WIDTH);
  const [editorHeight, setEditorHeight] = useState(DEFAULT_EDITOR_HEIGHT);
  const [lastExecutionTarget, setLastExecutionTarget] =
    useState<LastExecutionTarget | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const completionData = useMemo(
    () => createDatabaseCompletionData(SAMPLE_TABLES),
    [],
  );

  useEffect(() => {
    setSheetStateByConnection((current) => {
      if (current[connection.id]?.sheets.length) {
        return current;
      }

      const sheet = createQuerySheet("Untitled-1");
      return {
        ...current,
        [connection.id]: {
          sheets: [sheet],
          activeSheetId: sheet.id,
          openSheetIds: [sheet.id],
        },
      };
    });
  }, [connection.id]);

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
  const openSheets = sheetState.openSheetIds
    .map((sheetId) => sheets.find((sheet) => sheet.id === sheetId))
    .filter((sheet): sheet is QuerySheet => Boolean(sheet));
  const activeSheet =
    openSheets.find((sheet) => sheet.id === sheetState.activeSheetId) ??
    openSheets[0] ??
    null;
  const filteredTables = useMemo(() => {
    const normalized = filter.trim().toLowerCase();
    if (!normalized) {
      return SAMPLE_TABLES;
    }
    return SAMPLE_TABLES.filter(
      (table) =>
        table.name.includes(normalized) ||
        table.columns.some((column) => column.name.includes(normalized)),
    );
  }, [filter]);

  const gridStyle = {
    "--database-explorer-width": `${explorerWidth}px`,
    "--database-editor-height": `${editorHeight}px`,
  } as CSSProperties;

  function updateCurrentConnectionState(
    updater: (state: SheetConnectionState) => SheetConnectionState,
  ): void {
    setSheetStateByConnection((current) => {
      const existing = current[connection.id] ?? createInitialSheetState();
      return { ...current, [connection.id]: updater(existing) };
    });
  }

  function createNewSheet(): void {
    updateCurrentConnectionState((state) => {
      const sheet = createQuerySheet(nextUntitledName(state.sheets));
      return {
        sheets: [...state.sheets, sheet],
        activeSheetId: sheet.id,
        openSheetIds: [...state.openSheetIds, sheet.id],
      };
    });
    setContextMenu(null);
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
    updateCurrentConnectionState((state) => {
      const removedIndex = state.sheets.findIndex(
        (sheet) => sheet.id === sheetId,
      );
      const remaining = state.sheets.filter((sheet) => sheet.id !== sheetId);

      if (remaining.length === 0) {
        const replacement = createQuerySheet("Untitled-1");
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

    // TODO: persist query sheets through backend storage once database connections are real.
    updateCurrentConnectionState((state) => ({
      ...state,
      sheets: state.sheets.map((sheet) =>
        sheet.id === activeSheet.id
          ? { ...sheet, savedName: sheet.name, savedSql: sheet.sql }
          : sheet,
      ),
    }));
    setMessages((current) => [
      {
        id: `message-${Date.now()}`,
        tone: "success",
        text: `${activeSheet.name} saved locally for this session.`,
        time: new Date().toISOString(),
      },
      ...current,
    ]);
  }

  function addMessage(tone: MessageEntry["tone"], text: string): void {
    setMessages((current) => [
      {
        id: `message-${Date.now()}-${Math.round(Math.random() * 10000)}`,
        tone,
        text,
        time: new Date().toISOString(),
      },
      ...current,
    ]);
  }

  async function runMockQuery(
    target: ExecutionTarget,
    sheetId: string,
    source: "execute" | "reload",
  ): Promise<void> {
    if (executingRef.current) {
      return;
    }

    executingRef.current = true;
    setIsExecuting(true);
    const query = target.sql.trim();
    const startedAt = Date.now();
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 180));

      const isError =
        query.length === 0 ||
        !/^\s*(select|desc|insert|update|delete)\b/i.test(query) ||
        /\b(error|fail|invalid)\b/i.test(query);
      const durationMs = Math.max(
        2,
        Date.now() - startedAt + 8 + Math.random() * 18,
      );
      const duration = `${durationMs.toFixed(1)} ms`;
      const rows = isError ? 0 : SAMPLE_RESULT_ROWS.length;
      const status = isError ? "error" : "success";
      const now = new Date().toISOString();
      const errorMessage =
        "Mock SQL execution failed. Use a valid-looking SQL statement without error keywords.";

      setResultRows(isError ? [] : SAMPLE_RESULT_ROWS);
      setResultMeta({
        rows,
        duration,
        queriedAt: now,
        status,
        errorMessage: isError ? errorMessage : undefined,
      });
      setResultPage(1);
      addMessage(
        status,
        isError
          ? errorMessage
          : source === "reload"
            ? `Last SQL fragment reloaded. ${rows} rows returned in ${duration}.`
            : `Query executed successfully. ${rows} rows returned in ${duration}.`,
      );
      setActiveOutputTab(isError ? "messages" : "results");
      setLastExecutionTarget({ ...target, sheetId });

      // TODO: replace mock SQL execution with a backend/main-process database executor.
      onExecution({
        id: `execution-${Date.now()}-${Math.round(Math.random() * 10000)}`,
        time: now,
        connection: connection.name,
        user: connection.user,
        query: query || "(empty query)",
        duration,
        status,
        rows,
      });
    } finally {
      executingRef.current = false;
      setIsExecuting(false);
    }
  }

  const executeFromEditorView = useCallback(
    (view: EditorView): void => {
      if (!activeSheet || executingRef.current) {
        return;
      }

      const target = getExecutionTarget(view.state);
      if (!target) {
        addMessage(
          "error",
          "No executable SQL statement was found at the cursor.",
        );
        setActiveOutputTab("messages");
        return;
      }

      view.dispatch({ effects: setExecutedSqlRange.of(target) });
      void runMockQuery(target, activeSheet.id, "execute");
    },
    [activeSheet, connection.name, connection.user],
  );

  function executeFromActiveEditor(): void {
    const view = editorViewRef.current;
    if (!view) {
      addMessage("error", "SQL editor is not ready yet.");
      setActiveOutputTab("messages");
      return;
    }

    executeFromEditorView(view);
  }

  function reloadLastExecution(): void {
    if (executingRef.current) {
      return;
    }

    if (!lastExecutionTarget) {
      addMessage("error", "No previous SQL execution is available to reload.");
      setActiveOutputTab("messages");
      return;
    }

    const view = editorViewRef.current;
    if (view && activeSheet?.id === lastExecutionTarget.sheetId) {
      view.dispatch({ effects: setExecutedSqlRange.of(lastExecutionTarget) });
    }

    void runMockQuery(
      lastExecutionTarget,
      lastExecutionTarget.sheetId,
      "reload",
    );
  }

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
            onClick={onRefresh}
          >
            <RefreshCcw size={16} />
          </button>
        }
      >
        <div className="database-connection-summary">
          <div>
            <strong>{connection.name}</strong>
            <span>{connection.type}</span>
          </div>
          <StatusPill status={connection.status} />
        </div>

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

        <div className="database-object-tree">
          <ObjectTreeGroup title="Schemas" defaultOpen>
            <div className="database-tree-item schema-item">
              <Database size={15} />
              <span>sakila</span>
            </div>
          </ObjectTreeGroup>
          <ObjectTreeGroup
            title="Sheets"
            defaultOpen
            onContextMenu={openSheetsContextMenu}
          >
            {sheets.map((sheet) => {
              const unsaved =
                sheet.name !== sheet.savedName || sheet.sql !== sheet.savedSql;
              return (
                <div
                  className={`database-tree-item database-sheet-tree-item${
                    activeSheet?.id === sheet.id ? " active" : ""
                  }`}
                  key={sheet.id}
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
                  {unsaved ? <span className="database-unsaved-dot" /> : null}
                </div>
              );
            })}
          </ObjectTreeGroup>
          <ObjectTreeGroup
            title={`Tables (${SAMPLE_TABLES.length})`}
            defaultOpen
          >
            {filteredTables.length > 0 ? (
              filteredTables.map((table) => (
                <TableTreeItem table={table} key={table.name} />
              ))
            ) : (
              <div className="database-tree-empty">No objects match.</div>
            )}
          </ObjectTreeGroup>
          <ObjectTreeGroup title="Views">
            <div className="database-tree-empty">No dummy views.</div>
          </ObjectTreeGroup>
          <ObjectTreeGroup title="Procedures / Functions">
            <div className="database-tree-empty">Not configured.</div>
          </ObjectTreeGroup>
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
        className="panel database-query-panel"
        ref={queryPanelRef}
        style={gridStyle}
        onPointerDown={clearExecutedSqlHighlight}
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
                  className={`query-tab${active ? " active" : ""}`}
                  key={sheet.id}
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
              className="icon-button secondary"
              type="button"
              aria-label="Save sheet"
              title="Save sheet"
              onClick={saveActiveSheet}
              disabled={!activeSheet}
            >
              <Save size={16} />
            </button>
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
          onViewReady={(view) => {
            editorViewRef.current = view;
          }}
          completionData={completionData}
        />
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
                className={activeOutputTab === "results" ? "active" : undefined}
                type="button"
                role="tab"
                aria-selected={activeOutputTab === "results"}
                onClick={() => setActiveOutputTab("results")}
              >
                Results
              </button>
              <button
                className={
                  activeOutputTab === "messages" ? "active" : undefined
                }
                type="button"
                role="tab"
                aria-selected={activeOutputTab === "messages"}
                onClick={() => setActiveOutputTab("messages")}
              >
                Messages
              </button>
            </div>
            <button
              className="icon-button secondary database-output-reload"
              type="button"
              aria-label="Reload results"
              title="Reload results"
              onClick={reloadLastExecution}
              disabled={!lastExecutionTarget || isExecuting}
            >
              <RefreshCcw size={15} />
            </button>
          </div>
          {activeOutputTab === "results" ? (
            <ResultGrid
              rows={resultRows}
              meta={resultMeta}
              page={resultPage}
              pageSize={resultPageSize}
              onPageChange={setResultPage}
              onPageSizeChange={(pageSize) => {
                setResultPageSize(pageSize);
                setResultPage(1);
              }}
            />
          ) : (
            <MessageLog messages={messages} />
          )}
        </div>
      </section>

      {contextMenu ? (
        <SheetContextMenuView
          menu={contextMenu}
          onNewSheet={createNewSheet}
          onRename={startRename}
          onDelete={requestDeleteSheet}
        />
      ) : null}
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
    </div>
  );
}

function ObjectTreeGroup({
  title,
  defaultOpen = false,
  onContextMenu,
  children,
}: {
  title: string;
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

function TableTreeItem({ table }: { table: DatabaseTable }): JSX.Element {
  const [open, setOpen] = useState(table.name === "actor");

  return (
    <div className="database-table-tree-item">
      <button
        className="database-tree-item database-tree-button"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown size={14} className={open ? "open" : undefined} />
        <Table2 size={15} />
        <span>{`${table.name} (${table.columns.length})`}</span>
      </button>
      {open ? (
        <div className="database-column-list">
          {table.columns.map((column, index) => (
            <ColumnTreeItem
              column={column}
              defaultOpen={table.name === "actor" && index === 0}
              key={column.name}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ColumnTreeItem({
  column,
  defaultOpen = false,
}: {
  column: DatabaseColumn;
  defaultOpen?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
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

        <Cpu size={13} />
        <span>{column.name}</span>
      </button>
      {open && hasMetadata ? (
        <div className="database-column-metadata">
          {column.metadata.map((metadata) => (
            <span
              className="metadata-pill"
              key={`${column.name}-${metadata.label}`}
            >
              <span className="metadata-pill-label">{metadata.label}</span>
              <span className="metadata-pill-value">{metadata.value}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SheetContextMenuView({
  menu,
  onNewSheet,
  onRename,
  onDelete,
}: {
  menu: SheetContextMenu;
  onNewSheet: () => void;
  onRename: (sheetId: string) => void;
  onDelete: (sheetId: string) => void;
}): JSX.Element {
  return (
    <div
      className="database-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {menu.kind === "sheets" ? (
        <button type="button" role="menuitem" onClick={onNewSheet}>
          New sheet
        </button>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => onRename(menu.sheetId)}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => onDelete(menu.sheetId)}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}

function SqlEditor({
  sheetId,
  value,
  onChange,
  onExecute,
  onViewReady,
  completionData,
}: {
  sheetId: string;
  value: string;
  onChange: (value: string) => void;
  onExecute: (view: EditorView) => void;
  onViewReady: (view: EditorView) => void;
  completionData: DatabaseCompletionData;
}): JSX.Element {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);
  const completionDataRef = useRef(completionData);
  const activeSheetIdRef = useRef(sheetId);

  useEffect(() => {
    onChangeRef.current = onChange;
    onExecuteRef.current = onExecute;
    completionDataRef.current = completionData;
  }, [completionData, onChange, onExecute]);

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) {
      return undefined;
    }

    const editor = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: createSqlEditorExtensions(
          () => completionDataRef.current,
          (nextValue) => {
            onChangeRef.current(nextValue);
          },
          (view) => onExecuteRef.current(view),
        ),
      }),
    });

    viewRef.current = editor;
    onViewReady(editor);

    return () => {
      editor.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = viewRef.current;
    if (!editor) {
      return;
    }

    const currentValue = editor.state.doc.toString();
    const sheetChanged = activeSheetIdRef.current !== sheetId;

    if (sheetChanged || value !== currentValue) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        effects: sheetChanged ? setExecutedSqlRange.of(null) : undefined,
      });
    }

    activeSheetIdRef.current = sheetId;
  }, [sheetId, value]);

  return (
    <div
      className="database-sql-editor-shell"
      ref={editorHostRef}
      aria-label="SQL editor"
    />
  );
}

function ResultGrid({
  rows,
  meta,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  rows: ResultRow[];
  meta: ResultMeta;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}): JSX.Element {
  const columnDragRef = useRef<ResultColumnDragState | null>(null);
  const [columnWidths, setColumnWidths] = useState<
    Record<ResultColumnKey, number>
  >(DEFAULT_RESULT_COLUMN_WIDTHS);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = clamp(page, 1, pageCount);
  const pageRows = rows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

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
      startWidth: columnWidths[column.key],
    };
  };

  const resizeColumn = (event: PointerEvent<HTMLSpanElement>): void => {
    const drag = columnDragRef.current;
    if (!drag) {
      return;
    }

    const column = RESULT_COLUMNS.find((item) => item.key === drag.key);
    if (!column) {
      return;
    }

    setColumnWidths((current) => ({
      ...current,
      [drag.key]: Math.max(
        column.minWidth,
        drag.startWidth + event.clientX - drag.startX,
      ),
    }));
  };

  const stopColumnResize = (event: PointerEvent<HTMLSpanElement>): void => {
    if (
      columnDragRef.current &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    columnDragRef.current = null;
  };

  return (
    <div className="database-result-region">
      <div className="database-result-scroll">
        <table className="recent-builds-table database-result-table">
          <colgroup>
            {RESULT_COLUMNS.map((column) => (
              <col
                key={column.key}
                style={{ width: `${columnWidths[column.key]}px` }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              {RESULT_COLUMNS.map((column) => (
                <th key={column.key}>
                  <span className="database-result-th-content">
                    {column.label}
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
                    >
                      <ArrowLeftRight size={13} />
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.actor_id}>
                {RESULT_COLUMNS.map((column) => (
                  <td key={`${row.actor_id}-${column.key}`}>
                    {row[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="database-empty-state">No result rows.</p>
        ) : null}
      </div>
      <div
        className={`database-result-footer${meta.status === "error" ? " error" : ""}`}
      >
        <span className="database-result-footer-summary">
          {meta.status === "error"
            ? `Error · ${meta.errorMessage ?? "Execution failed"}`
            : `${meta.rows} rows fetched · Page ${currentPage} of ${pageCount} · ${meta.duration}`}
        </span>
        <time>{formatCompactTime(meta.queriedAt)}</time>
        <div className="database-pagination-controls">
          <select
            value={pageSize}
            aria-label="Result page size"
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            disabled={meta.status === "error"}
          >
            {[5, 10, 25].map((size) => (
              <option value={size} key={size}>{`${size} rows`}</option>
            ))}
          </select>
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Previous result page"
            title="Previous result page"
            disabled={meta.status === "error" || currentPage <= 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Next result page"
            title="Next result page"
            disabled={meta.status === "error" || currentPage >= pageCount}
            onClick={() => onPageChange(Math.min(pageCount, currentPage + 1))}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageLog({ messages }: { messages: MessageEntry[] }): JSX.Element {
  return (
    <div className="database-message-log">
      {messages.map((message) => (
        <div className={`database-message ${message.tone}`} key={message.id}>
          <time>{formatCompactTime(message.time)}</time>
          <span>{message.text}</span>
        </div>
      ))}
    </div>
  );
}

function HistoryQueryCell({
  query,
  expanded,
  onToggle,
}: {
  query: string;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  const showToggle = query.length > 100 || /\s/.test(query.slice(100));
  const preview =
    query.length > 100 ? `${query.slice(0, 100).trimEnd()}...` : query;

  if (!showToggle) {
    return <span className="database-query-preview">{query}</span>;
  }

  return (
    <div className={`database-history-query${expanded ? " expanded" : ""}`}>
      {expanded ? (
        <pre>{formatSqlForDisplay(query)}</pre>
      ) : (
        <span className="database-query-preview">{preview}</span>
      )}
      <button
        className="database-query-toggle"
        type="button"
        onClick={onToggle}
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}

function DatabaseMonitor({
  connection,
  executionHistory,
  queryCount,
  lastRefreshTime,
}: {
  connection: DatabaseConnection;
  executionHistory: DatabaseExecutionRecord[];
  queryCount: number;
  lastRefreshTime: string;
}): JSX.Element {
  const [expandedQueryIds, setExpandedQueryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const summaryItems = [
    { label: "Connection", value: connection.name },
    { label: "Database Type", value: connection.type },
    { label: "Status", value: <StatusPill status={connection.status} /> },
    { label: "Host", value: connection.host },
    { label: "Port", value: connection.port },
    { label: "Current User", value: connection.user },
    { label: "Current Schema", value: connection.schema },
    { label: "Last Refresh", value: formatCompactTime(lastRefreshTime) },
    { label: "Latency", value: connection.latency },
    { label: "Uptime", value: connection.uptime },
    { label: "Active Sessions", value: String(connection.activeSessions) },
    { label: "Query Count", value: String(queryCount) },
  ];
  const visibleHistory = executionHistory.slice(0, 100);

  function toggleExpandedQuery(entryId: string): void {
    setExpandedQueryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }

  return (
    <div className="database-monitor-layout">
      <div className="database-summary-grid">
        {summaryItems.map((item) => (
          <div className="database-summary-card" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      <Panel
        title="Execution History"
        className="database-history-panel"
        // titleMeta={
        //   <span className="database-history-count">
        //     {executionHistory.length} stored
        //   </span>
        // }
      >
        <div className="database-history-scroll">
          <table className="recent-builds-table database-history-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Connection</th>
                <th>User</th>
                <th>Query</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>
              {visibleHistory.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatCompactTime(entry.time)}</td>
                  <td>{entry.connection}</td>
                  <td>{entry.user}</td>
                  <td className="database-query-cell">
                    <HistoryQueryCell
                      query={entry.query}
                      expanded={expandedQueryIds.has(entry.id)}
                      onToggle={() => toggleExpandedQuery(entry.id)}
                    />
                  </td>
                  <td>{entry.duration}</td>
                  <td>
                    <span
                      className={`status-pill ${
                        entry.status === "success" ? "success" : "failed"
                      }`}
                    >
                      {entry.status === "success" ? "Success" : "Error"}
                    </span>
                  </td>
                  <td>{entry.rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleHistory.length === 0 ? (
            <p className="database-empty-state">No query executions yet.</p>
          ) : null}
        </div>
        <div className="table-footer">
          <span>
            Showing {visibleHistory.length} of {executionHistory.length}{" "}
            executions
          </span>
          <span>Newest first, up to 1000 retained</span>
        </div>
      </Panel>
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: DatabaseConnection["status"];
}): JSX.Element {
  const label =
    status === "connected"
      ? "Connected"
      : status === "error"
        ? "Error"
        : "Disconnected";
  const className =
    status === "connected"
      ? "success"
      : status === "error"
        ? "failed"
        : "stopped";
  return <span className={`status-pill ${className}`}>{label}</span>;
}

function createQuerySheet(name: string, sql = DEFAULT_SQL): QuerySheet {
  querySheetSequence += 1;
  return {
    id: `query-sheet-${Date.now()}-${querySheetSequence}`,
    name,
    sql,
    savedName: name,
    savedSql: sql,
  };
}

function createInitialSheetState(): SheetConnectionState {
  const sheet = createQuerySheet("Untitled-1");
  return { sheets: [sheet], activeSheetId: sheet.id, openSheetIds: [sheet.id] };
}

function nextUntitledName(sheets: QuerySheet[]): string {
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

function createSqlEditorExtensions(
  getCompletionData: () => DatabaseCompletionData,
  onChange: (value: string) => void,
  onExecute: (view: EditorView) => void,
): Extension[] {
  return [
    basicSetup,
    sql(),
    syntaxHighlighting(sqlHighlightStyle),
    executedSqlHighlightField,
    EditorState.transactionExtender.of((transaction) =>
      transaction.docChanged ? { effects: setExecutedSqlRange.of(null) } : null,
    ),
    EditorView.domEventHandlers({
      focus(_event, view) {
        view.dispatch({ effects: setExecutedSqlRange.of(null) });
        return false;
      },
      mousedown(_event, view) {
        view.dispatch({ effects: setExecutedSqlRange.of(null) });
        return false;
      },
    }),
    autocompletion({
      activateOnTyping: true,
      override: [
        (context) => sqlCompletionSource(context, getCompletionData()),
      ],
    }),
    Prec.highest(
      keymap.of([
        {
          key: "Ctrl-Enter",
          run(view) {
            onExecute(view);
            return true;
          },
        },
        {
          key: "Mod-Enter",
          run(view) {
            onExecute(view);
            return true;
          },
        },
        {
          key: "Tab",
          run(view) {
            if (completionStatus(view.state) === "active") {
              return acceptCompletion(view);
            }

            const word = view.state.wordAt(view.state.selection.main.head);
            if (!word || word.to - word.from < 2) {
              return false;
            }

            return startCompletion(view);
          },
        },
        ...defaultKeymap,
      ]),
    ),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString());
      }
    }),
    EditorView.theme({
      "&": {
        height: "100%",
        color: "var(--text)",
        backgroundColor: "var(--terminal-bg)",
        fontSize: "var(--database-code-font-size, 12px)",
      },
      ".cm-scroller": {
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
        lineHeight: "1.55",
      },
      ".cm-content": {
        minHeight: "100%",
        padding: "14px 15px",
      },
      ".cm-gutters": {
        color: "var(--muted)",
        backgroundColor:
          "color-mix(in srgb, var(--terminal-bg) 88%, var(--surface))",
        borderRightColor: "var(--terminal-border)",
      },
      ".cm-activeLineGutter, .cm-activeLine": {
        backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)",
      },
      ".cm-cursor": {
        borderLeftColor: "var(--text)",
      },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
      },
      ".cm-tooltip": {
        color: "var(--text)",
        backgroundColor: "var(--surface)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow)",
      },
    }),
  ];
}

function getExecutionTarget(state: EditorState): ExecutionTarget | null {
  const sqlText = state.doc.toString();
  const selection = state.selection.main;

  if (!selection.empty) {
    return trimExecutionRange(sqlText, selection.from, selection.to);
  }

  if (!sqlText.includes(";")) {
    return trimExecutionRange(sqlText, 0, sqlText.length);
  }

  const cursor = selection.head;
  let statementStart = 0;
  let previousTarget: ExecutionTarget | null = null;

  for (let index = 0; index <= sqlText.length; index += 1) {
    const atStatementEnd = index === sqlText.length || sqlText[index] === ";";
    if (!atStatementEnd) {
      continue;
    }

    const currentTarget = trimExecutionRange(sqlText, statementStart, index);
    if (!currentTarget) {
      statementStart = index + 1;
      continue;
    }

    if (cursor < currentTarget.from) {
      return previousTarget ?? currentTarget;
    }

    if (cursor <= index + 1) {
      return currentTarget;
    }

    previousTarget = currentTarget;
    statementStart = index + 1;
  }

  return previousTarget;
}

function trimExecutionRange(
  sqlText: string,
  rawFrom: number,
  rawTo: number,
): ExecutionTarget | null {
  let from = rawFrom;
  let to = rawTo;

  while (from < to && /\s/.test(sqlText[from])) {
    from += 1;
  }

  while (to > from && /\s/.test(sqlText[to - 1])) {
    to -= 1;
  }

  if (from >= to) {
    return null;
  }

  return { sql: sqlText.slice(from, to), from, to };
}

function createDatabaseCompletionData(
  tables: DatabaseTable[],
): DatabaseCompletionData {
  const columns = Array.from(
    new Set(
      tables.flatMap((table) => table.columns.map((column) => column.name)),
    ),
  ).sort();

  return {
    keywords: SQL_KEYWORDS,
    tables: tables.map((table) => table.name).sort(),
    columns,
  };
}

function sqlCompletionSource(
  context: CompletionContext,
  data: DatabaseCompletionData,
): CompletionResult | null {
  const word = context.matchBefore(/[\w.]+/);
  const typedLength = word ? context.pos - word.from : 0;

  if (!word || typedLength < 2) {
    return null;
  }

  const beforeCursor = context.state.doc
    .sliceString(Math.max(0, context.pos - 160), context.pos)
    .toLowerCase();
  const contextKind = detectSqlCompletionContext(beforeCursor);
  const options = buildSqlCompletionOptions(data, contextKind);

  return {
    from: word.from,
    options,
    validFor: /^[\w.]*$/,
  };
}

function detectSqlCompletionContext(
  textBeforeCursor: string,
): "table" | "column" | "keyword" {
  if (/\b(from|join)\s+[\w.]*$/.test(textBeforeCursor)) {
    return "table";
  }

  if (
    /\b(select|where|order\s+by|group\s+by|having|on)\b[\s\S]*$/.test(
      textBeforeCursor,
    )
  ) {
    return "column";
  }

  return "keyword";
}

function buildSqlCompletionOptions(
  data: DatabaseCompletionData,
  contextKind: "table" | "column" | "keyword",
): Completion[] {
  const keywordOptions = data.keywords.map((label) => ({
    label,
    type: "keyword",
    boost: contextKind === "keyword" ? 80 : 10,
  }));
  const tableOptions = data.tables.map((label) => ({
    label,
    type: "class",
    boost: contextKind === "table" ? 100 : 25,
  }));
  const columnOptions = data.columns.map((label) => ({
    label,
    type: "property",
    boost: contextKind === "column" ? 100 : 20,
  }));

  if (contextKind === "table") {
    return [...tableOptions, ...keywordOptions, ...columnOptions];
  }

  if (contextKind === "column") {
    return [...columnOptions, ...keywordOptions, ...tableOptions];
  }

  return [...keywordOptions, ...tableOptions, ...columnOptions];
}

function formatSqlForDisplay(query: string): string {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  let formatted = normalized
    .replace(
      /\s+(from|where|group\s+by|order\s+by|having|values|set)\b/gi,
      "\n$1",
    )
    .replace(/\s+(and|or)\s+/gi, "\n      $1 ")
    .replace(/,\s*/g, ",\n    ");

  formatted = formatted.replace(/^select\s+/i, "select\n    ");
  formatted = formatted.replace(
    /\n(from|where|group\s+by|order\s+by|having|values|set)\b/gi,
    (match) => match.toLowerCase(),
  );

  return formatted;
}

function formatCompactTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}
