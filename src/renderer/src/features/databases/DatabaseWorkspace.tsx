import {
  Fragment,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
  DatabaseMetadata,
  DatabaseQueryValue,
  DatabaseSslMode,
  DatabaseStatementExecutionResult,
  DatabaseTable,
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
import { ObjectTreeGroup, TableTreeItem } from "./ObjectExplorerTree";
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
  createLoadingMetadataState,
  createQuerySheet,
  createResultTabs,
  createSelectTemplate,
  ensureSqlTerminator,
  fetchDatabaseMetadata,
  formatDurationMs,
  formatObjectName,
  hasSuccessfulSchemaChange,
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

export type QuerySheet = {
  id: string;
  name: string;
  sql: string;
  savedName: string;
  savedSql: string;
  savedAt: string | null;
  output: SheetOutputState;
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
  | { kind: "table"; table: DatabaseTable; x: number; y: number };

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
  const queryPanelRef = useRef<HTMLElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const executingRef = useRef(false);
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
  const [renameDraft, setRenameDraft] = useState("");
  const [explorerWidth, setExplorerWidth] = useState(DEFAULT_EXPLORER_WIDTH);
  const [editorHeight, setEditorHeight] = useState(DEFAULT_EDITOR_HEIGHT);
  const [isExecuting, setIsExecuting] = useState(false);
  const [metadataStateByConnection, setMetadataStateByConnection] = useState<
    Record<string, DatabaseMetadataState>
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

    let cancelled = false;
    metadataLoadStartedRef.current.add(metadataLoadKey);
    setMetadataStateByConnection((current) => ({
      ...current,
      [connection.id]: createLoadingMetadataState(
        current[connection.id]?.metadata,
      ),
    }));

    void fetchDatabaseMetadata(effectiveConnection)
      .then((metadataResult) => {
        if (cancelled) {
          return;
        }
        setMetadataStateByConnection((current) => ({
          ...current,
          [connection.id]: { status: "loaded", metadata: metadataResult },
        }));
      })
      .catch((error: unknown) => {
        if (cancelled) {
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

    return () => {
      cancelled = true;
    };
  }, [connection.id, databaseStatus, effectiveConnection, selectedSchema]);

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
  const activeOutput = activeSheet?.output ?? createEmptySheetOutput();
  const activeResultTab =
    activeOutput.resultTabs.find(
      (tab) => tab.id === activeOutput.activeResultTabId,
    ) ??
    activeOutput.resultTabs[0] ??
    null;
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
    const metadataLoadKey = `${connection.id}:${selectedSchema}`;
    metadataLoadStartedRef.current.add(metadataLoadKey);
    setMetadataStateByConnection((current) => ({
      ...current,
      [connection.id]: createLoadingMetadataState(
        current[connection.id]?.metadata,
      ),
    }));

    void fetchDatabaseMetadata(effectiveConnection)
      .then((metadataResult) => {
        setMetadataStateByConnection((current) => ({
          ...current,
          [connection.id]: { status: "loaded", metadata: metadataResult },
        }));
        onRefresh();
      })
      .catch((error: unknown) => {
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
    setSelectedSchemaByConnection((current) => ({
      ...current,
      [connection.id]: schema,
    }));
    setFilter("");
    setMetadataStateByConnection((current) => ({
      ...current,
      [connection.id]: createLoadingMetadataState(
        current[connection.id]?.metadata,
      ),
    }));
    metadataLoadStartedRef.current.delete(`${connection.id}:${schema}`);
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

      const batch = await window.ivsDashboard.executeDatabaseStatements(
        effectiveConnection,
        statements,
      );
      const now = new Date().toISOString();
      const resultTabs = createResultTabs(batch.results);
      const activeResultTabId = selectInitialResultTabId(resultTabs);
      const messages = createBatchMessages(batch.results, now, source);
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

      batch.results.forEach((result, index) => {
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

      if (hasSuccessfulSchemaChange(batch.results)) {
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

  function insertTableTemplate(table: DatabaseTable): void {
    const template = createInsertTemplate(table);
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

  function appendTableSelectTemplate(table: DatabaseTable): void {
    const template = createSelectTemplate(table);
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

        <div className="database-object-tree">
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
                <span className="database-tree-count">{sheets.length}</span>
              </>
            }
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
            title={
              <>
                <span>Tables</span>
                <span className="database-tree-count">
                  {metadata.tables.length}
                </span>
              </>
            }
            defaultOpen
          >
            {filteredTables.length > 0 ? (
              filteredTables.map((table) => (
                <TableTreeItem
                  table={table}
                  key={`${table.schema}.${table.name}`}
                  onContextMenu={(event) => openTableContextMenu(event, table)}
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
                  {metadata.views.length}
                </span>
              </>
            }
          >
            {metadata.views.length > 0 ? (
              metadata.views.map((viewName) => (
                <div className="database-tree-item view-item" key={viewName}>
                  <View size={15} />
                  <span>{viewName}</span>
                </div>
              ))
            ) : (
              <div className="database-tree-empty">No views loaded.</div>
            )}
          </ObjectTreeGroup>
          <ObjectTreeGroup
            title={
              <>
                <span>Procedures</span>
                <span className="database-tree-count">
                  {metadata.procedures.length}
                </span>
              </>
            }
          >
            {metadata.procedures.length > 0 ? (
              metadata.procedures.map((procedure) => (
                <div
                  className="database-tree-item procedure-item"
                  key={procedure}
                >
                  <Microchip size={15} />
                  <span>{procedure}</span>
                </div>
              ))
            ) : (
              <div className="database-tree-empty">No procedures loaded.</div>
            )}
          </ObjectTreeGroup>
          <ObjectTreeGroup
            title={
              <>
                <span>Functions</span>
                <span className="database-tree-count">
                  {metadata.functions.length}
                </span>
              </>
            }
          >
            {metadata.functions.length > 0 ? (
              metadata.functions.map((routineFunction) => (
                <div
                  className="database-tree-item function-item"
                  key={routineFunction}
                >
                  <SquareFunction size={15} />
                  <span>{routineFunction}</span>
                </div>
              ))
            ) : (
              <div className="database-tree-empty">No functions loaded.</div>
            )}
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
      {autoSaveError ? (
        <div className="app-snackbar database-autosave-snackbar invalid">
          {autoSaveError}
        </div>
      ) : null}
    </div>
  );
}
