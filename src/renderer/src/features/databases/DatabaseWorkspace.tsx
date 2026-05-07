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
  Box,
  Braces,
  Carrot,
  ChevronDown,
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
  Key,
  Leaf,
  LoaderCircle,
  Microchip,
  Play,
  Puzzle,
  RefreshCcw,
  Save,
  Share,
  Sigma,
  SquareFunction,
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

type QuerySheet = {
  id: string;
  name: string;
  sql: string;
  savedName: string;
  savedSql: string;
  savedAt: string | null;
  output: SheetOutputState;
};

type SheetOutputTab = "results" | "messages";

type SheetOutputState = {
  hasExecuted: boolean;
  activeOutputTab: SheetOutputTab;
  resultTabs: ResultTab[];
  activeResultTabId: string | null;
  messages: MessageEntry[];
  lastExecutionTarget: LastExecutionTarget | null;
};

type SheetConnectionState = {
  sheets: QuerySheet[];
  activeSheetId: string;
  openSheetIds: string[];
};

type SheetContextMenu =
  | { kind: "sheets"; x: number; y: number }
  | { kind: "sheet"; sheetId: string; x: number; y: number }
  | { kind: "table"; table: DatabaseTable; x: number; y: number };

type HistoryRerunRequest = {
  id: string;
  record: DatabaseExecutionRecord;
};

type ExportFormat = "json" | "csv" | "pdf";

type ResultRow = Record<string, DatabaseQueryValue>;

type ResultMeta = {
  hasRun: boolean;
  rows: number;
  duration: string;
  queriedAt: string;
  status: "success" | "error";
  errorMessage?: string;
  rowsAffected?: number;
};

type MessageEntry = {
  id: string;
  tone: "success" | "error";
  text: string;
  time: string;
};

type DatabaseMetadataState =
  | { status: "idle"; metadata: DatabaseMetadata; errorMessage?: undefined }
  | { status: "loading"; metadata: DatabaseMetadata; errorMessage?: undefined }
  | { status: "loaded"; metadata: DatabaseMetadata; errorMessage?: undefined }
  | { status: "error"; metadata: DatabaseMetadata; errorMessage: string };

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

type ResultColumnKey = string;

type ResultColumn = {
  key: ResultColumnKey;
  label: string;
  databaseType?: string;
  kind: "number" | "text" | "date" | "unknown";
  minWidth: number;
  weight: number;
};

type ResultTab = {
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

type DatabaseConnectionModalMode = "add" | "edit";

type DatabaseConnectionDraft = {
  id?: string;
  name: string;
  type: DatabaseConnectionType;
  host: string;
  port: string;
  user: string;
  password: string;
  savePassword: boolean;
  connectionTimeoutSeconds: string;
  database: string;
  sslMode: DatabaseSslMode;
  connectionMode: OracleConnectionMode;
  serviceName: string;
  sid: string;
  connectString: string;
  role: string;
  walletPath: string;
};

type ConnectionFormErrors = Partial<
  Record<keyof DatabaseConnectionDraft, string>
>;

type TestConnectionState =
  | { status: "idle"; message: string }
  | { status: "testing"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const DEFAULT_SQL = "";
const SEQ_RESULT_COLUMN_KEY = "__ui_seq";

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
const DEFAULT_CONNECTION_TIMEOUT_SECONDS = "10";
const DATABASE_METADATA_LOAD_TIMEOUT_MS = 30_000;

const DATABASE_TYPE_OPTIONS: Array<AppSelectOption<DatabaseConnectionType>> = [
  { value: "MySQL", label: "MySQL", dotColor: "#2563eb" },
  { value: "Oracle", label: "Oracle", dotColor: "#ef4444" },
];

const MYSQL_SSL_OPTIONS: Array<AppSelectOption<DatabaseSslMode>> = [
  { value: "disabled", label: "Disabled", dotColor: "var(--muted)" },
  { value: "preferred", label: "Preferred", dotColor: "var(--info)" },
  { value: "required", label: "Required", dotColor: "var(--error)" },
];

const ORACLE_CONNECTION_MODES: Array<AppSelectOption<OracleConnectionMode>> = [
  { value: "serviceName", label: "Service name" },
  { value: "sid", label: "SID" },
  { value: "connectString", label: "Connection string" },
];

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

export function DatabaseConnectionModal({
  open,
  mode,
  connection,
  connections,
  onClose,
  onSave,
  onTestStatus,
  onDeleteRequest,
}: {
  open: boolean;
  mode: DatabaseConnectionModalMode;
  connection?: DatabaseConnection | null;
  connections: DatabaseConnection[];
  onClose: () => void;
  onSave: (connection: DatabaseConnection) => Promise<boolean>;
  onTestStatus: (
    message: string,
    tone: "valid" | "invalid" | "warning",
  ) => void;
  onDeleteRequest?: (connection: DatabaseConnection) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<DatabaseConnectionDraft>(() =>
    createConnectionDraft(connection),
  );
  const [errors, setErrors] = useState<ConnectionFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [testState, setTestState] = useState<TestConnectionState>({
    status: "idle",
    message: "",
  });
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const baselineDraft = createConnectionDraft(connection);
  const dirty =
    mode === "edit" && !areConnectionDraftsEqual(draft, baselineDraft);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(createConnectionDraft(connection));
    setErrors({});
    setSaving(false);
    setTestState({ status: "idle", message: "" });
    setPasswordVisible(false);
    setDiscardConfirmOpen(false);
  }, [connection, open]);

  function requestClose(): void {
    if (dirty) {
      setDiscardConfirmOpen(true);
      return;
    }

    onClose();
  }

  function updateDraft<K extends keyof DatabaseConnectionDraft>(
    key: K,
    value: DatabaseConnectionDraft[K],
  ): void {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setTestState({ status: "idle", message: "" });
  }

  function updateDatabaseType(type: DatabaseConnectionType): void {
    setDraft((current) => ({
      ...current,
      type,
      port: type === "MySQL" ? "3306" : "1521",
      sslMode: type === "MySQL" ? current.sslMode : "disabled",
      connectionMode:
        type === "Oracle" ? current.connectionMode : "serviceName",
      serviceName: type === "Oracle" ? current.serviceName || "XEPDB1" : "",
      sid: type === "Oracle" ? current.sid : "",
      connectString: type === "Oracle" ? current.connectString : "",
      role: type === "Oracle" ? current.role : "",
      walletPath: type === "Oracle" ? current.walletPath : "",
    }));
    setErrors({});
    setTestState({ status: "idle", message: "" });
  }

  function validateDraft(): ConnectionFormErrors {
    return validateConnectionDraft(draft, connections, connection?.id);
  }

  async function testConnection(): Promise<void> {
    if (testState.status === "testing") {
      return;
    }

    onTestStatus("Testing connection...", "warning");
    const nextErrors = validateDraft();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setTestState({
        status: "error",
        message: "Fix validation errors before testing.",
      });
      onTestStatus("Connection test failed", "invalid");
      return;
    }

    setTestState({ status: "testing", message: "Testing connection..." });
    try {
      const result = await window.ivsDashboard.testDatabaseConnection(
        createConnectionFromDraft(draft, connection),
      );
      if (!result.success) {
        setTestState({ status: "error", message: result.message });
        onTestStatus("Connection test failed", "invalid");
        return;
      }

      setTestState({
        status: "success",
        message: result.latency
          ? `Connection test succeeded in ${result.latency}.`
          : result.message,
      });
      onTestStatus("Connection test successful", "valid");
    } catch (error) {
      setTestState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Connection test failed.",
      });
      onTestStatus("Connection test failed", "invalid");
    }
  }

  async function saveConnection(): Promise<void> {
    if (saving) {
      return;
    }

    const nextErrors = validateDraft();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setTestState({
        status: "error",
        message: "Fix validation errors to save.",
      });
      return;
    }

    setSaving(true);
    try {
      const saved = await onSave(createConnectionFromDraft(draft, connection));
      if (!saved) {
        setSaving(false);
      }
    } catch (error) {
      setTestState({
        status: "error",
        message: error instanceof Error ? error.message : "Connection failed.",
      });
      setSaving(false);
    }
  }

  const isOracleConnectString =
    draft.type === "Oracle" && draft.connectionMode === "connectString";

  return (
    <Modal
      open={open}
      title={mode === "add" ? "New database connection" : "Connection settings"}
      subtitle={mode === "add" ? "Database" : connection?.name}
      size="md"
      className="database-connection-modal"
      contentClassName="database-connection-modal-content"
      closeLabel="Close connection dialog"
      onClose={requestClose}
    >
      <form
        className="database-connection-form"
        onSubmit={(event) => {
          event.preventDefault();
          void saveConnection();
        }}
      >
        <section className="database-connection-section">
          <h3 className="database-connection-section-title">Connection</h3>
          <div className="database-connection-form-grid">
            <ConnectionField label="Connection name" error={errors.name}>
              <input
                autoFocus
                type="text"
                value={draft.name}
                onChange={(event) => updateDraft("name", event.target.value)}
              />
            </ConnectionField>
            <ConnectionField label="Database type" error={errors.type}>
              <AppSelect
                className="database-form-select"
                value={draft.type}
                options={DATABASE_TYPE_OPTIONS}
                onChange={updateDatabaseType}
                ariaLabel="Database type"
              />
            </ConnectionField>
          </div>
        </section>

        <section className="database-connection-section">
          <h3 className="database-connection-section-title">Server</h3>
          <div className="database-connection-form-grid">
            <ConnectionField label="Host" error={errors.host}>
              <input
                type="text"
                value={draft.host}
                disabled={isOracleConnectString}
                placeholder={
                  isOracleConnectString
                    ? "Using connection string"
                    : "localhost"
                }
                onChange={(event) => updateDraft("host", event.target.value)}
              />
            </ConnectionField>
            <ConnectionField label="Port" error={errors.port}>
              <input
                type="text"
                inputMode="numeric"
                value={draft.port}
                onChange={(event) => updateDraft("port", event.target.value)}
              />
            </ConnectionField>
            <ConnectionField label="Username" error={errors.user}>
              <input
                type="text"
                value={draft.user}
                onChange={(event) => updateDraft("user", event.target.value)}
              />
            </ConnectionField>
            <ConnectionField label="Password" error={errors.password}>
              <span className="database-password-field">
                <input
                  type={passwordVisible ? "text" : "password"}
                  value={draft.password}
                  autoComplete="current-password"
                  onChange={(event) =>
                    updateDraft("password", event.target.value)
                  }
                />
                <button
                  className="database-password-toggle"
                  type="button"
                  aria-label={
                    passwordVisible ? "Hide password" : "Show password"
                  }
                  title={passwordVisible ? "Hide password" : "Show password"}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  {passwordVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
            </ConnectionField>
            <ConnectionField
              label="Connection timeout (seconds)"
              error={errors.connectionTimeoutSeconds}
            >
              <input
                type="text"
                inputMode="numeric"
                value={draft.connectionTimeoutSeconds}
                onChange={(event) =>
                  updateDraft("connectionTimeoutSeconds", event.target.value)
                }
              />
            </ConnectionField>
            <label className="database-connection-checkbox">
              <input
                type="checkbox"
                checked={draft.savePassword}
                onChange={(event) =>
                  updateDraft("savePassword", event.target.checked)
                }
              />
              <span>Save password</span>
            </label>
          </div>
        </section>

        {draft.type === "MySQL" ? (
          <section className="database-connection-section database-specific-fields">
            <h3 className="database-connection-section-title">MySQL options</h3>
            <div className="database-connection-form-grid">
              <ConnectionField label="Default database/schema">
                <input
                  type="text"
                  value={draft.database}
                  placeholder="sakila"
                  onChange={(event) =>
                    updateDraft("database", event.target.value)
                  }
                />
              </ConnectionField>
              <ConnectionField label="SSL mode">
                <AppSelect
                  className="database-form-select"
                  value={draft.sslMode}
                  options={MYSQL_SSL_OPTIONS}
                  onChange={(value) => updateDraft("sslMode", value)}
                  ariaLabel="SSL mode"
                />
              </ConnectionField>
            </div>
          </section>
        ) : (
          <section className="database-connection-section database-specific-fields">
            <h3 className="database-connection-section-title">
              Oracle options
            </h3>
            <div className="database-connection-form-grid">
              <ConnectionField label="Connection mode">
                <AppSelect
                  className="database-form-select"
                  value={draft.connectionMode}
                  options={ORACLE_CONNECTION_MODES}
                  onChange={(value) => updateDraft("connectionMode", value)}
                  ariaLabel="Connection mode"
                />
              </ConnectionField>
              {draft.connectionMode === "serviceName" ? (
                <ConnectionField
                  label="Service name"
                  error={errors.serviceName}
                >
                  <input
                    type="text"
                    value={draft.serviceName}
                    placeholder="XEPDB1"
                    onChange={(event) =>
                      updateDraft("serviceName", event.target.value)
                    }
                  />
                </ConnectionField>
              ) : null}
              {draft.connectionMode === "sid" ? (
                <ConnectionField label="SID" error={errors.sid}>
                  <input
                    type="text"
                    value={draft.sid}
                    onChange={(event) => updateDraft("sid", event.target.value)}
                  />
                </ConnectionField>
              ) : null}
              {draft.connectionMode === "connectString" ? (
                <ConnectionField
                  label="Connection string"
                  error={errors.connectString}
                >
                  <input
                    type="text"
                    value={draft.connectString}
                    placeholder="localhost:1521/XEPDB1"
                    onChange={(event) =>
                      updateDraft("connectString", event.target.value)
                    }
                  />
                </ConnectionField>
              ) : null}
              <ConnectionField label="Role">
                <input
                  type="text"
                  value={draft.role}
                  placeholder="Optional"
                  onChange={(event) => updateDraft("role", event.target.value)}
                />
              </ConnectionField>
              <ConnectionField label="Wallet / TCPS">
                <input
                  type="text"
                  value={draft.walletPath}
                  placeholder="Optional wallet path"
                  onChange={(event) =>
                    updateDraft("walletPath", event.target.value)
                  }
                />
              </ConnectionField>
            </div>
          </section>
        )}

        {testState.message ? (
          <p className={`database-test-result ${testState.status}`}>
            {testState.message}
          </p>
        ) : null}

        <div className="dialog-actions database-connection-actions">
          <div className="database-connection-actions-left">
            {mode === "edit" && connection ? (
              <button
                className="danger-button database-delete-connection-button"
                type="button"
                onClick={() => onDeleteRequest?.(connection)}
                disabled={saving}
              >
                <Trash2 size={15} />
                Delete Connection
              </button>
            ) : null}
            <button
              className="button secondary compact"
              type="button"
              onClick={() => void testConnection()}
              disabled={testState.status === "testing" || saving}
            >
              {testState.status === "testing" ? "Testing" : "Test connection"}
            </button>
          </div>
          <div className="database-connection-actions-right">
            <button
              className="button secondary compact"
              type="button"
              onClick={requestClose}
            >
              Cancel
            </button>
            <button
              className="button primary compact"
              type="submit"
              disabled={saving}
            >
              {mode === "add" ? "Save connection" : "Save changes"}
            </button>
          </div>
        </div>
      </form>
      {discardConfirmOpen ? (
        <ConfirmDialog
          title="Discard connection changes?"
          message="You have unsaved connection settings. Close without saving?"
          confirmLabel="Discard changes"
          cancelLabel="Cancel"
          variant="warning"
          onClose={() => setDiscardConfirmOpen(false)}
          onConfirm={() => {
            setDiscardConfirmOpen(false);
            onClose();
          }}
        />
      ) : null}
    </Modal>
  );
}

function ConnectionField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="database-connection-field">
      <span>{label}</span>
      {children}
      {error ? <strong>{error}</strong> : null}
    </label>
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
  const [explorerWidth, setExplorerWidth] = useState(DEFAULT_EXPLORER_WIDTH);
  const [editorHeight, setEditorHeight] = useState(DEFAULT_EDITOR_HEIGHT);
  const [isExecuting, setIsExecuting] = useState(false);
  const [metadataStateByConnection, setMetadataStateByConnection] = useState<
    Record<string, DatabaseMetadataState>
  >({});
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
  }, [connection.id]);

  useEffect(() => {
    if (loadedWorksheetConnectionIds.has(connection.id)) {
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
    metadataLoadStartedRef.current.delete(deletedConnectionId);
  }, [deletedConnectionId]);

  useEffect(() => {
    return () => {
      if (persistedWorksheetTimerRef.current !== null) {
        window.clearTimeout(persistedWorksheetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (databaseStatus !== "connected" && databaseStatus !== "reconnecting") {
      return;
    }

    if (
      metadataLoadStartedRef.current.has(connection.id) ||
      metadataStateByConnection[connection.id]
    ) {
      return;
    }

    let cancelled = false;
    metadataLoadStartedRef.current.add(connection.id);
    setMetadataStateByConnection((current) => ({
      ...current,
      [connection.id]: createLoadingMetadataState(
        current[connection.id]?.metadata,
      ),
    }));

    void fetchDatabaseMetadata(connection)
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
  }, [connection, databaseStatus]);

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

  const gridStyle = {
    "--database-explorer-width": `${explorerWidth}px`,
    "--database-editor-height": `${editorHeight}px`,
  } as CSSProperties;

  useEffect(() => {
    if (!loadedWorksheetConnectionIds.has(connection.id)) {
      return undefined;
    }

    if (persistedWorksheetTimerRef.current !== null) {
      window.clearTimeout(persistedWorksheetTimerRef.current);
    }

    persistedWorksheetTimerRef.current = window.setTimeout(() => {
      persistedWorksheetTimerRef.current = null;
      void persistSavedWorksheetState(connection.id, sheetState).catch(
        (error) => console.error(error),
      );
    }, 250);

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
    metadataLoadStartedRef.current.add(connection.id);
    setMetadataStateByConnection((current) => ({
      ...current,
      [connection.id]: createLoadingMetadataState(
        current[connection.id]?.metadata,
      ),
    }));

    void fetchDatabaseMetadata(connection)
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
    const nextState: SheetConnectionState = {
      ...sheetState,
      sheets: sheetState.sheets.map((sheet) =>
        sheet.id === activeSheet.id
          ? {
              ...sheet,
              savedName: sheet.name,
              savedSql: sheet.sql,
              savedAt,
              output: prependSheetMessage(
                sheet.output,
                "success",
                `${sheet.name} saved.`,
              ),
            }
          : sheet,
      ),
    };

    setSheetStateByConnection((current) => ({
      ...current,
      [connection.id]: nextState,
    }));
    void persistSavedWorksheetState(connection.id, nextState)
      .then(() => onSheetSaved())
      .catch((error) => {
        console.error(error);
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
        connection,
        statements,
      );
      const now = new Date().toISOString();
      const resultTabs = createResultTabs(batch.results);
      const activeResultTabId = selectInitialResultTabId(resultTabs);
      const messages = createBatchMessages(batch.results, now, source);
      const activeOutputTab = resultTabs.some((tab) => tab.rows.length > 0)
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
          user: connection.user,
          query: result.statement || "(empty query)",
          duration: formatDurationMs(result.durationMs),
          status: result.status,
          rows:
            result.rowsFetched > 0
              ? result.rowsFetched
              : (result.rowsAffected ?? 0),
          rowsAffected: result.rowsAffected,
          errorMessage: result.errorMessage,
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
    [activeSheet, connection, metadataLoading],
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
          <ObjectTreeGroup
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
                <div className="database-tree-item schema-item" key={schema}>
                  <Database size={15} />
                  <span>{schema}</span>
                </div>
              ))
            ) : (
              <div className="database-tree-empty">No schemas loaded.</div>
            )}
          </ObjectTreeGroup>
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
    </div>
  );
}

function ObjectTreeGroup({
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

function TableTreeItem({
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
          <strong>{column.metadata.find((m) => m.label === "Type")?.value}</strong>
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

function SheetContextMenuView({
  menu,
  onNewSheet,
  onRename,
  onDelete,
  onInsertTableTemplate,
}: {
  menu: SheetContextMenu;
  onNewSheet: () => void;
  onRename: (sheetId: string) => void;
  onDelete: (sheetId: string) => void;
  onInsertTableTemplate: (table: DatabaseTable) => void;
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
      ) : menu.kind === "table" ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => onInsertTableTemplate(menu.table)}
        >
          INSERT INTO {formatQualifiedObjectName(menu.table)}
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
  onSave,
  onViewReady,
  completionData,
}: {
  sheetId: string;
  value: string;
  onChange: (value: string) => void;
  onExecute: (view: EditorView) => void;
  onSave: () => void;
  onViewReady: (view: EditorView) => void;
  completionData: DatabaseCompletionData;
}): JSX.Element {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onExecuteRef = useRef(onExecute);
  const onSaveRef = useRef(onSave);
  const completionDataRef = useRef(completionData);
  const activeSheetIdRef = useRef(sheetId);

  useEffect(() => {
    onChangeRef.current = onChange;
    onExecuteRef.current = onExecute;
    onSaveRef.current = onSave;
    completionDataRef.current = completionData;
  }, [completionData, onChange, onExecute, onSave]);

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
          () => onSaveRef.current(),
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

function ResultTabsPanel({
  tabs,
  activeTabId,
  onTabChange,
  onColumnWidthsChange,
}: {
  tabs: ResultTab[];
  activeTabId: string | null;
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
        columnWidths={activeTab.columnWidths}
        onColumnWidthsChange={onColumnWidthsChange}
      />
    </div>
  );
}

function ResultExportMenu({
  resultTab,
  connection,
  sheet,
}: {
  resultTab: ResultTab | null;
  connection: DatabaseConnection;
  sheet: QuerySheet | null;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const disabled =
    !resultTab ||
    resultTab.rows.length === 0 ||
    resultTab.meta.status === "error";

  function exportResult(format: ExportFormat): void {
    if (!resultTab || disabled) {
      return;
    }

    const exportedAt = new Date().toISOString();
    const baseName = safeFileName(
      `${connection.name}-${sheet?.name ?? "worksheet"}-${resultTab.name}`,
    );

    if (format === "json") {
      downloadBlob(
        `${baseName}.json`,
        "application/json",
        JSON.stringify(resultTab.rows, null, 2),
      );
      return;
    }

    if (format === "csv") {
      downloadBlob(
        `${baseName}.csv`,
        "text/csv;charset=utf-8",
        createCsv(resultTab),
      );
      return;
    }

    downloadBlob(
      `${baseName}.pdf`,
      "application/pdf",
      createResultPdf(
        resultTab,
        connection,
        sheet?.name ?? "Worksheet",
        exportedAt,
      ),
    );
  }

  return (
    <div
      className="build-dropdown database-export-dropdown"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        className={`icon-button secondary database-output-share${open ? " open" : ""}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Export results"
        title="Export results"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Share size={15} />
      </button>
      <div
        className={`build-dropdown-popover${open && !disabled ? " open" : ""}`}
        aria-hidden={!open || disabled}
      >
        <div className="build-dropdown-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => exportResult("json")}
          >
            <Braces size={14} />
            <span>JSON</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => exportResult("csv")}
          >
            <FileText size={14} />
            <span>CSV</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={disabled}
            onClick={() => exportResult("pdf")}
          >
            <File size={14} />
            <span>PDF</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultGrid({
  rows,
  columns,
  meta,
  columnWidths,
  onColumnWidthsChange,
}: {
  rows: ResultRow[];
  columns: ResultColumn[];
  meta: ResultMeta;
  columnWidths: Partial<Record<ResultColumnKey, number>>;
  onColumnWidthsChange: (
    columnWidths: Partial<Record<ResultColumnKey, number>>,
  ) => void;
}): JSX.Element {
  const resultScrollRef = useRef<HTMLDivElement>(null);
  const columnDragRef = useRef<ResultColumnDragState | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const hasColumns = columns.length > 0;
  const displayColumns = useMemo(
    () =>
      hasColumns && rows.length > 0
        ? [createSeqResultColumn(), ...columns]
        : columns,
    [columns, hasColumns, rows.length],
  );
  const calculatedColumns = useMemo(
    () => calculateResultColumnWidths(displayColumns, panelWidth, columnWidths),
    [displayColumns, panelWidth, columnWidths],
  );
  const totalColumnWidth = calculatedColumns.reduce(
    (total, column) => total + column.width,
    0,
  );
  const tableWidth =
    panelWidth > 0 && totalColumnWidth <= panelWidth
      ? "100%"
      : `${totalColumnWidth}px`;

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
    };
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

    onColumnWidthsChange({
      ...columnWidths,
      [drag.key]: Math.max(
        column.minWidth,
        drag.startWidth + event.clientX - drag.startX,
      ),
    });
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

  const resetColumnWidth = (column: ResultColumn): void => {
    const next = { ...columnWidths };
    delete next[column.key];
    onColumnWidthsChange(next);
  };

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
                <col key={column.key} style={{ width: `${column.width}px` }} />
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
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {displayColumns.map((column) => (
                    <td key={`${rowIndex}-${column.key}`}>
                      {column.key === SEQ_RESULT_COLUMN_KEY
                        ? rowIndex + 1
                        : renderResultValue(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {rows.length === 0 ? (
          <p className="database-empty-state">No result rows.</p>
        ) : null}
      </div>
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

function MessageLog({ messages }: { messages: MessageEntry[] }): JSX.Element {
  return (
    <div className="database-message-log">
      {messages.length === 0 ? (
        <p className="database-empty-state">No messages for this sheet.</p>
      ) : null}
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
  onRerun,
}: {
  connection: DatabaseConnection;
  executionHistory: DatabaseExecutionRecord[];
  queryCount: number;
  lastRefreshTime: string;
  onRerun: (record: DatabaseExecutionRecord) => void;
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
                <th>Re-run</th>
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
                  <td>
                    <button
                      className="icon-button secondary database-history-rerun"
                      type="button"
                      aria-label={`Re-run query from ${formatCompactTime(entry.time)}`}
                      title="Re-run query"
                      onClick={() => onRerun(entry)}
                    >
                      <Play size={14} />
                    </button>
                  </td>
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
          <span>Newest first, retained for 3 days</span>
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

function createConnectionDraft(
  connection?: DatabaseConnection | null,
): DatabaseConnectionDraft {
  if (connection) {
    return {
      id: connection.id,
      name: connection.name,
      type: connection.type,
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password: connection.password ?? "",
      savePassword: connection.savePassword ?? true,
      connectionTimeoutSeconds: String(
        Math.round((connection.connectionTimeoutMs ?? 10000) / 1000),
      ),
      database: connection.database ?? connection.schema ?? "",
      sslMode: connection.sslMode ?? "disabled",
      connectionMode: connection.connectionMode ?? "serviceName",
      serviceName: connection.serviceName ?? connection.schema ?? "",
      sid: connection.sid ?? "",
      connectString: connection.connectString ?? "",
      role: connection.role ?? "",
      walletPath: connection.walletPath ?? "",
    };
  }

  return {
    name: "",
    type: "MySQL",
    host: "localhost",
    port: "3306",
    user: "",
    password: "",
    savePassword: true,
    connectionTimeoutSeconds: DEFAULT_CONNECTION_TIMEOUT_SECONDS,
    database: "",
    sslMode: "disabled",
    connectionMode: "serviceName",
    serviceName: "XEPDB1",
    sid: "",
    connectString: "",
    role: "",
    walletPath: "",
  };
}

function areConnectionDraftsEqual(
  first: DatabaseConnectionDraft,
  second: DatabaseConnectionDraft,
): boolean {
  const keys: Array<keyof DatabaseConnectionDraft> = [
    "name",
    "type",
    "host",
    "port",
    "user",
    "password",
    "savePassword",
    "connectionTimeoutSeconds",
    "database",
    "sslMode",
    "connectionMode",
    "serviceName",
    "sid",
    "connectString",
    "role",
    "walletPath",
  ];

  return keys.every((key) => first[key] === second[key]);
}

function validateConnectionDraft(
  draft: DatabaseConnectionDraft,
  connections: DatabaseConnection[],
  editingConnectionId?: string,
): ConnectionFormErrors {
  const errors: ConnectionFormErrors = {};
  const trimmedName = draft.name.trim();
  const duplicateName = connections.some(
    (connection) =>
      connection.id !== editingConnectionId &&
      connection.name.trim().toLowerCase() === trimmedName.toLowerCase(),
  );

  if (!trimmedName) {
    errors.name = "Required";
  } else if (duplicateName) {
    errors.name = "Must be unique";
  }

  if (!draft.type) {
    errors.type = "Required";
  }

  if (!(draft.type === "Oracle" && draft.connectionMode === "connectString")) {
    if (!draft.host.trim()) {
      errors.host = "Required";
    }
  }

  if (!draft.port.trim()) {
    errors.port = "Required";
  } else if (!/^\d+$/.test(draft.port.trim())) {
    errors.port = "Use numbers only";
  }

  if (!draft.user.trim()) {
    errors.user = "Required";
  }

  if (
    draft.connectionTimeoutSeconds.trim() &&
    (!/^\d+$/.test(draft.connectionTimeoutSeconds.trim()) ||
      Number(draft.connectionTimeoutSeconds) <= 0)
  ) {
    errors.connectionTimeoutSeconds = "Use a positive number";
  }

  if (draft.type === "Oracle") {
    if (draft.connectionMode === "serviceName" && !draft.serviceName.trim()) {
      errors.serviceName = "Required";
    }
    if (draft.connectionMode === "sid" && !draft.sid.trim()) {
      errors.sid = "Required";
    }
    if (
      draft.connectionMode === "connectString" &&
      !draft.connectString.trim()
    ) {
      errors.connectString = "Required";
    }
  }

  return errors;
}

function createConnectionFromDraft(
  draft: DatabaseConnectionDraft,
  existing?: DatabaseConnection | null,
): DatabaseConnection {
  const timeoutSeconds = draft.connectionTimeoutSeconds.trim()
    ? Number(draft.connectionTimeoutSeconds)
    : Number(DEFAULT_CONNECTION_TIMEOUT_SECONDS);
  const schema =
    draft.type === "MySQL"
      ? draft.database.trim()
      : draft.connectionMode === "sid"
        ? draft.sid.trim()
        : draft.connectionMode === "connectString"
          ? draft.connectString.trim()
          : draft.serviceName.trim();

  // TODO: store saved passwords in secure Electron/OS credential storage.
  return {
    ...(existing ?? {}),
    id:
      existing?.id ??
      `database-${Date.now()}-${Math.round(Math.random() * 10000)}`,
    name: draft.name.trim(),
    type: draft.type,
    status: existing?.status ?? "connected",
    host: draft.host.trim(),
    port: draft.port.trim(),
    user: draft.user.trim(),
    password: draft.password,
    savePassword: draft.savePassword,
    connectionTimeoutMs: timeoutSeconds * 1000,
    database: draft.database.trim(),
    schema,
    sslMode: draft.sslMode,
    connectionMode: draft.connectionMode,
    serviceName: draft.serviceName.trim(),
    sid: draft.sid.trim(),
    connectString: draft.connectString.trim(),
    role: draft.role.trim(),
    walletPath: draft.walletPath.trim(),
    latency: existing?.latency ?? "Not tested",
    uptime: existing?.uptime ?? "Session",
    activeSessions: existing?.activeSessions ?? 1,
  };
}

function createQuerySheet(name: string, sql = DEFAULT_SQL): QuerySheet {
  querySheetSequence += 1;
  return {
    id: `query-sheet-${Date.now()}-${querySheetSequence}`,
    name,
    sql,
    savedName: name,
    savedSql: sql,
    savedAt: null,
    output: createEmptySheetOutput(),
  };
}

function createQuerySheetFromPersisted(sheet: DatabaseWorksheet): QuerySheet {
  return {
    id: sheet.sheetId,
    name: sheet.sheetName,
    sql: sheet.sql,
    savedName: sheet.sheetName,
    savedSql: sheet.sql,
    savedAt: sheet.savedAt,
    output: createEmptySheetOutput(),
  };
}

function sheetStateFromPersisted(
  persistedState: DatabaseWorksheetState,
): SheetConnectionState {
  const sheets = persistedState.sheets.map(createQuerySheetFromPersisted);
  const openSheetIds = persistedState.sheets
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

function serializePersistedWorksheetState(
  connectionId: string,
  state: SheetConnectionState,
): DatabaseWorksheetState {
  const persistedSheets = state.sheets
    .filter((sheet) => sheet.savedAt !== null)
    .map((sheet) => ({
      connectionId,
      sheetId: sheet.id,
      sheetName: sheet.savedName,
      sql: sheet.savedSql,
      savedAt: sheet.savedAt ?? new Date().toISOString(),
      isOpen: state.openSheetIds.includes(sheet.id),
    }));
  const activeSheetId = persistedSheets.some(
    (sheet) => sheet.sheetId === state.activeSheetId,
  )
    ? state.activeSheetId
    : null;

  return { connectionId, sheets: persistedSheets, activeSheetId };
}

async function persistSavedWorksheetState(
  connectionId: string,
  state: SheetConnectionState,
): Promise<DatabaseWorksheetState> {
  return window.ivsDashboard.saveDatabaseWorksheetState(
    serializePersistedWorksheetState(connectionId, state),
  );
}

function createEmptySheetOutput(): SheetOutputState {
  return {
    hasExecuted: false,
    activeOutputTab: "results",
    resultTabs: [],
    activeResultTabId: null,
    messages: [],
    lastExecutionTarget: null,
  };
}

function prependSheetMessage(
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

function createEmptyMetadata(): DatabaseMetadata {
  return {
    schemas: [],
    tables: [],
    views: [],
    procedures: [],
    functions: [],
  };
}

function createIdleMetadataState(): DatabaseMetadataState {
  return { status: "idle", metadata: createEmptyMetadata() };
}

function createLoadingMetadataState(
  metadata = createEmptyMetadata(),
): DatabaseMetadataState {
  return { status: "loading", metadata };
}

async function fetchDatabaseMetadata(
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

function withTimeout<T>(
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

function normalizeDatabaseMetadata(
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
          columns: Array.isArray(table.columns) ? table.columns : [],
          indexes: Array.isArray(table.indexes) ? table.indexes : [],
          triggers: Array.isArray(table.triggers) ? table.triggers : [],
          partitions: Array.isArray(table.partitions) ? table.partitions : [],
        }))
      : fallback.tables,
    views: Array.isArray(metadata.views) ? metadata.views : [],
    procedures: Array.isArray(metadata.procedures) ? metadata.procedures : [],
    functions: Array.isArray(metadata.functions) ? metadata.functions : [],
  };
}

function createInitialSheetState(): SheetConnectionState {
  const sheet = createQuerySheet("Untitled-1");
  return { sheets: [sheet], activeSheetId: sheet.id, openSheetIds: [sheet.id] };
}

function splitSqlStatements(sqlText: string): string[] {
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

function createResultTabs(
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

function selectInitialResultTabId(tabs: ResultTab[]): string | null {
  return (
    tabs.find((tab) => tab.rows.length > 0)?.id ??
    tabs[tabs.length - 1]?.id ??
    null
  );
}

function createBatchMessages(
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

function hasSuccessfulSchemaChange(
  results: DatabaseStatementExecutionResult[],
): boolean {
  return results.some(
    (result) =>
      result.status === "success" &&
      isSchemaChangingStatement(result.statement),
  );
}

function isSchemaChangingStatement(statement: string): boolean {
  return /^\s*(create|drop|alter|rename|truncate)\s+(table|view|procedure|function|index|trigger|schema|database)\b/i.test(
    statement,
  );
}

function createSeqResultColumn(): ResultColumn {
  return {
    key: SEQ_RESULT_COLUMN_KEY,
    label: "seq",
    kind: "number",
    minWidth: 56,
    weight: 0.35,
  };
}

function detectStatementTableName(statement: string): string | null {
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

function stripSchemaPrefix(identifier: string): string {
  const cleaned = identifier
    .replace(/^[`"']|[`"']$/g, "")
    .replace(/[),;].*$/, "");
  const parts = cleaned.split(".");
  return parts[parts.length - 1]?.replace(/^[`"']|[`"']$/g, "") || cleaned;
}

function disambiguateTabNames(names: string[]): string[] {
  const counts = new Map<string, number>();
  return names.map((name) => {
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

function inferResultColumnKind(
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

function calculateColumnMinimumWidth(label: string, type?: string): number {
  return clamp((label.length + (type?.length ?? 0) + 6) * 8, 90, 240);
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function formatDurationMs(durationMs: number): string {
  return `${Math.max(1, durationMs).toFixed(1)} ms`;
}

function formatResultColumnHeader(column: ResultColumn): JSX.Element {
  return column.databaseType ? (
    <>
      <span>{column.label}</span>
      <span className="database-column-type">({column.databaseType})</span>
    </>
  ) : (
    <span>{column.label}</span>
  );
}

function renderResultValue(value: DatabaseQueryValue): ReactNode {
  if (value === null) {
    return <span className="database-null-pill">NULL</span>;
  }
  return String(value);
}

function formatResultFooter(meta: ResultMeta): string {
  const affected =
    meta.rowsAffected !== undefined
      ? ` · ${meta.rowsAffected} ${pluralize("row", meta.rowsAffected)} affected`
      : "";
  return `${meta.rows} rows fetched${affected} · ${meta.duration}`;
}

function formatObjectName(table: DatabaseTable): string {
  return table.schema ? `${table.name}` : table.name;
}

function formatQualifiedObjectName(table: DatabaseTable): string {
  return table.schema ? `${table.schema}.${table.name}` : table.name;
}

function quoteSqlIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

function quoteQualifiedTableName(table: DatabaseTable): string {
  return table.schema
    ? `${quoteSqlIdentifier(table.schema)}.${quoteSqlIdentifier(table.name)}`
    : quoteSqlIdentifier(table.name);
}

function createInsertTemplate(table: DatabaseTable): string {
  const columns = table.columns.map((column) => column.name);
  if (columns.length === 0) {
    return `INSERT INTO ${quoteQualifiedTableName(table)} (\n  column_1\n) VALUES (\n  value_1\n);`;
  }

  const columnLines = columns
    .map(
      (column, index) =>
        `  ${quoteSqlIdentifier(column)}${index < columns.length - 1 ? "," : ""}`,
    )
    .join("\n");
  const valueLines = columns
    .map(
      (_, index) =>
        `  value_${index + 1}${index < columns.length - 1 ? "," : ""}`,
    )
    .join("\n");

  return `INSERT INTO ${quoteQualifiedTableName(table)} (\n${columnLines}\n) VALUES (\n${valueLines}\n);`;
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

function ensureSqlTerminator(sqlText: string): string {
  const trimmed = sqlText.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

function nextHistorySheetName(time: string, sheets: QuerySheet[]): string {
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

function formatHistorySheetMinute(value: string): string {
  return formatCompactTime(value).slice(0, 16);
}

function disambiguateSheetName(name: string, sheets: QuerySheet[]): string {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createCsv(tab: ResultTab): string {
  const headers = tab.columns.map((column) => column.label);
  const rows = tab.rows.map((row) =>
    tab.columns.map((column) => csvCell(row[column.key])).join(","),
  );
  return [headers.map(csvCell).join(","), ...rows].join("\r\n");
}

function csvCell(value: DatabaseQueryValue): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadBlob(
  fileName: string,
  type: string,
  content: string | Uint8Array,
): void {
  let blobPart: string | ArrayBuffer;
  if (typeof content === "string") {
    blobPart = content;
  } else {
    blobPart = new ArrayBuffer(content.byteLength);
    new Uint8Array(blobPart).set(content);
  }
  const blob = new Blob([blobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "query-results"
  );
}

function createResultPdf(
  tab: ResultTab,
  connection: DatabaseConnection,
  worksheetName: string,
  exportedAt: string,
): Uint8Array {
  const lines = [
    `Connection: ${connection.name}`,
    `Worksheet: ${worksheetName}`,
    `Exported: ${formatCompactTime(exportedAt)}`,
    "SQL:",
    ...wrapPdfLine(tab.statementSql, 112),
    "",
    tab.columns.map((column) => column.label).join(" | "),
    "-".repeat(112),
    ...tab.rows.map((row) =>
      tab.columns
        .map((column) => stringifyPdfValue(row[column.key]))
        .join(" | "),
    ),
  ];
  const pageLines: string[][] = [];
  const maxLinesPerPage = 42;
  for (let index = 0; index < lines.length; index += maxLinesPerPage) {
    pageLines.push(lines.slice(index, index + maxLinesPerPage));
  }

  return buildSimplePdf(
    pageLines.map((page) => page.flatMap((line) => wrapPdfLine(line, 132))),
  );
}

function stringifyPdfValue(value: DatabaseQueryValue): string {
  return value === null ? "NULL" : String(value).replace(/\s+/g, " ");
}

function wrapPdfLine(line: string, width: number): string[] {
  if (line.length <= width) {
    return [line];
  }
  const wrapped: string[] = [];
  for (let index = 0; index < line.length; index += width) {
    wrapped.push(line.slice(index, index + width));
  }
  return wrapped;
}

function buildSimplePdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const addObject = (content: string): number => {
    objects.push(content);
    return objects.length;
  };
  const fontObjectId = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  );
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];

  pages.forEach((lines) => {
    const stream = ["BT", "/F1 8 Tf", "34 560 Td", "11 TL"]
      .concat(
        lines.map((line) => `(${escapePdfText(line)}) Tj T*`),
        "ET",
      )
      .join("\n");
    const streamLength = new TextEncoder().encode(stream).length;
    const contentObjectId = addObject(
      `<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`,
    );
    contentObjectIds.push(contentObjectId);
    pageObjectIds.push(0);
  });

  const pagesObjectId = objects.length + pages.length + 1;
  pages.forEach((_lines, index) => {
    const pageObjectId = addObject(
      `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`,
    );
    pageObjectIds[index] = pageObjectId;
  });
  const kids = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
  addObject(
    `<< /Type /Pages /Kids [${kids}] /Count ${pageObjectIds.length} >>`,
  );
  const catalogObjectId = addObject(
    `<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`,
  );

  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(chunks.join("").length);
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });
  const xrefOffset = chunks.join("").length;
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach((offset) => {
    chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  });
  chunks.push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );

  return new TextEncoder().encode(chunks.join(""));
}

function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
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
  onSave: () => void,
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
          key: "Mod-s",
          run() {
            onSave();
            return true;
          },
        },
        {
          key: "Ctrl-s",
          run() {
            onSave();
            return true;
          },
        },
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
    const selectedSql = sqlText.slice(selection.from, selection.to);
    return selectedSql.trim()
      ? { sql: selectedSql, from: selection.from, to: selection.to }
      : null;
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
    tables: Array.from(
      new Set(tables.flatMap((table) => [table.name, formatObjectName(table)])),
    ).sort(),
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

function calculateResultColumnWidths(
  columns: ResultColumn[],
  panelWidth: number,
  userColumnWidths: Partial<Record<ResultColumnKey, number>>,
): Array<ResultColumn & { width: number }> {
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
      return { ...column, width: Math.max(column.minWidth, userWidth) };
    }

    if (autoColumns.length === 0) {
      return { ...column, width: column.minWidth };
    }

    const weight = evenlyDistributeAutoColumns ? 1 : column.weight;
    return {
      ...column,
      width: Math.max(
        column.minWidth,
        (autoAvailableWidth * weight) / totalWeight,
      ),
    };
  });
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

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
