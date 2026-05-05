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
import { AppSelect, type AppSelectOption } from "../../components/common/AppSelect";
import { ConfirmDialog } from "../../components/dialogs/ConfirmDialog";
import { Modal } from "../../components/dialogs/Modal";
import type {
  DatabaseConnection,
  DatabaseConnectionType,
  DatabaseExecutionRecord,
  DatabaseSslMode,
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
  output: SheetOutputState;
};

type SheetOutputTab = "results" | "messages";

type SheetOutputState = {
  hasExecuted: boolean;
  activeOutputTab: SheetOutputTab;
  resultRows: ResultRow[];
  resultColumns: ResultColumn[];
  resultMeta: ResultMeta;
  resultPage: number;
  resultPageSize: number;
  resultColumnWidths: Partial<Record<ResultColumnKey, number>>;
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
  | { kind: "sheet"; sheetId: string; x: number; y: number };

type ResultRow = {
  actor_id: number;
  first_name: string;
  last_name: string;
  last_update: string;
};

type ResultMeta = {
  hasRun: boolean;
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

type DatabaseMetadata = {
  schemas: string[];
  tables: DatabaseTable[];
  views: string[];
  routines: string[];
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

type ResultColumnKey = keyof ResultRow;

type ResultColumn = {
  key: ResultColumnKey;
  label: string;
  kind: "number" | "text" | "date" | "unknown";
  minWidth: number;
  weight: number;
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
const DEFAULT_CONNECTION_TIMEOUT_SECONDS = "10";

const DATABASE_TYPE_OPTIONS: Array<
  AppSelectOption<DatabaseConnectionType>
> = [
  { value: "MySQL", label: "MySQL", dotColor: "#2563eb" },
  { value: "Oracle", label: "Oracle", dotColor: "#ef4444" },
];

const MYSQL_SSL_OPTIONS: Array<AppSelectOption<DatabaseSslMode>> = [
  { value: "disabled", label: "Disabled" },
  { value: "preferred", label: "Preferred" },
  { value: "required", label: "Required" },
];

const ORACLE_CONNECTION_MODES: Array<
  AppSelectOption<OracleConnectionMode>
> = [
  { value: "serviceName", label: "Service name" },
  { value: "sid", label: "SID" },
  { value: "connectString", label: "Connection string" },
];

const PAGE_SIZE_OPTIONS: Array<AppSelectOption<string>> = [
  { value: "5", label: "5 rows" },
  { value: "10", label: "10 rows" },
  { value: "25", label: "25 rows" },
];

const RESULT_COLUMNS: ResultColumn[] = [
  {
    key: "actor_id",
    label: "actor_id",
    kind: "number",
    minWidth: 80,
    weight: 0.7,
  },
  {
    key: "first_name",
    label: "first_name",
    kind: "text",
    minWidth: 140,
    weight: 1,
  },
  {
    key: "last_name",
    label: "last_name",
    kind: "text",
    minWidth: 140,
    weight: 1,
  },
  {
    key: "last_update",
    label: "last_update",
    kind: "date",
    minWidth: 200,
    weight: 1.3,
  },
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

const SAMPLE_ACTOR_NAMES = [
  ["PENELOPE", "GUINESS"],
  ["NICK", "WAHLBERG"],
  ["ED", "CHASE"],
  ["JENNIFER", "DAVIS"],
  ["JOHNNY", "LOLLOBRIGIDA"],
  ["BETTE", "NICHOLSON"],
  ["GRACE", "MOSTEL"],
  ["MATTHEW", "JOHANSSON"],
  ["JOE", "SWANK"],
  ["CHRISTIAN", "GABLE"],
  ["ZERO", "CAGE"],
  ["KARL", "BERRY"],
] as const;

const SAMPLE_RESULT_ROWS: ResultRow[] = SAMPLE_ACTOR_NAMES.map(
  ([firstName, lastName], index) => ({
    actor_id: index + 1,
    first_name: firstName,
    last_name: lastName,
    last_update: "2026-05-05 09:18:22",
  }),
);

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
}: {
  open: boolean;
  mode: DatabaseConnectionModalMode;
  connection?: DatabaseConnection | null;
  connections: DatabaseConnection[];
  onClose: () => void;
  onSave: (connection: DatabaseConnection) => void;
  onTestStatus: (
    message: string,
    tone: "valid" | "invalid" | "warning",
  ) => void;
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
    await new Promise((resolve) => window.setTimeout(resolve, 450));

    const failurePattern = /\b(fail|error)\b/i;
    if (
      failurePattern.test(draft.name) ||
      failurePattern.test(draft.host) ||
      failurePattern.test(draft.user)
    ) {
      setTestState({
        status: "error",
        message: "Mock connection failed for the supplied connection details.",
      });
      onTestStatus("Connection test failed", "invalid");
      return;
    }

    // TODO: wire real MySQL/Oracle connection testing through the Electron backend.
    setTestState({ status: "success", message: "Connection test succeeded." });
    onTestStatus("Connection test successful", "valid");
  }

  function saveConnection(): void {
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
    onSave(createConnectionFromDraft(draft, connection));
    setSaving(false);
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
          saveConnection();
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
              <input
                type="password"
                value={draft.password}
                onChange={(event) =>
                  updateDraft("password", event.target.value)
                }
              />
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
          <button
            className="button secondary compact"
            type="button"
            onClick={() => void testConnection()}
            disabled={testState.status === "testing" || saving}
          >
            {testState.status === "testing" ? "Testing" : "Test connection"}
          </button>
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
  activeTab,
  executionHistory,
  queryCount,
  lastRefreshTime,
  onExecution,
  onRefresh,
  onSheetSaved,
}: {
  connection: DatabaseConnection;
  activeTab: DatabaseWorkspaceTab;
  executionHistory: DatabaseExecutionRecord[];
  queryCount: number;
  lastRefreshTime: string;
  onExecution: (record: DatabaseExecutionRecord) => void;
  onRefresh: () => void;
  onSheetSaved: () => void;
}): JSX.Element {
  return (
    <section className="database-screen resizable-panel-screen">
      <div
        className={`database-workspace-view${activeTab === "connection" ? " active" : ""}`}
      >
        <ConnectionActionWorkspace
          connection={connection}
          onExecution={onExecution}
          onRefresh={onRefresh}
          onSheetSaved={onSheetSaved}
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
        />
      </div>
    </section>
  );
}

function ConnectionActionWorkspace({
  connection,
  onExecution,
  onRefresh,
  onSheetSaved,
}: {
  connection: DatabaseConnection;
  onExecution: (record: DatabaseExecutionRecord) => void;
  onRefresh: () => void;
  onSheetSaved: () => void;
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
    if (metadataStateByConnection[connection.id]) {
      return;
    }

    let cancelled = false;
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
            metadata: current[connection.id]?.metadata ?? createMockMetadata(),
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
  }, [connection]);

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

  function refreshMetadata(): void {
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
            metadata: current[connection.id]?.metadata ?? createMockMetadata(),
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
          ? {
              ...sheet,
              savedName: sheet.name,
              savedSql: sheet.sql,
              output: prependSheetMessage(
                sheet.output,
                "success",
                `${sheet.name} saved locally for this session.`,
              ),
            }
          : sheet,
      ),
    }));
    onSheetSaved();
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
      const isSelect = /^\s*(select|desc)\b/i.test(query);
      const isEmptySelect = isSelect && /\b(limit\s+0|where\s+1\s*=\s*0)\b/i.test(query);
      const durationMs = Math.max(
        2,
        Date.now() - startedAt + 8 + Math.random() * 18,
      );
      const duration = `${durationMs.toFixed(1)} ms`;
      const rows = isError || !isSelect || isEmptySelect ? 0 : SAMPLE_RESULT_ROWS.length;
      const status = isError ? "error" : "success";
      const now = new Date().toISOString();
      const errorMessage =
        "Mock SQL execution failed. Use a valid-looking SQL statement without error keywords.";

      updateSheetOutput(sheetId, (output) =>
        prependSheetMessage(
          {
            ...output,
            hasExecuted: true,
            activeOutputTab: isError || !isSelect ? "messages" : "results",
            resultRows: isError || !isSelect || isEmptySelect ? [] : SAMPLE_RESULT_ROWS,
            resultColumns: !isError && isSelect ? RESULT_COLUMNS : [],
            resultMeta: {
              hasRun: true,
              rows,
              duration,
              queriedAt: now,
              status,
              errorMessage: isError ? errorMessage : undefined,
            },
            resultPage: 1,
            lastExecutionTarget: { ...target, sheetId },
          },
          status,
          isError
            ? errorMessage
            : !isSelect
              ? `Statement executed successfully in ${duration}.`
            : source === "reload"
              ? `Last SQL fragment reloaded. ${rows} rows returned in ${duration}.`
              : `Query executed successfully. ${rows} rows returned in ${duration}.`,
        ),
      );

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
      if (!activeSheet || executingRef.current || metadataLoading) {
        return;
      }

      const target = getExecutionTarget(view.state);
      if (!target) {
        addMessage("error", "No executable SQL statement was found at the cursor.");
        updateActiveSheetOutput((output) => ({
          ...output,
          hasExecuted: true,
          activeOutputTab: "messages",
        }));
        return;
      }

      view.dispatch({ effects: setExecutedSqlRange.of(target) });
      void runMockQuery(target, activeSheet.id, "execute");
    },
    [activeSheet, connection.name, connection.user, metadataLoading],
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

    void runMockQuery(
      activeOutput.lastExecutionTarget,
      activeOutput.lastExecutionTarget.sheetId,
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
          <ObjectTreeGroup title="Schemas" defaultOpen>
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
            title={`Tables (${metadata.tables.length})`}
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
            {metadata.views.length > 0 ? (
              metadata.views.map((viewName) => (
                <div className="database-tree-item" key={viewName}>
                  <Table2 size={15} />
                  <span>{viewName}</span>
                </div>
              ))
            ) : (
              <div className="database-tree-empty">No views loaded.</div>
            )}
          </ObjectTreeGroup>
          <ObjectTreeGroup title="Procedures / Functions">
            {metadata.routines.length > 0 ? (
              metadata.routines.map((routine) => (
                <div className="database-tree-item" key={routine}>
                  <Cpu size={15} />
                  <span>{routine}</span>
                </div>
              ))
            ) : (
              <div className="database-tree-empty">No routines loaded.</div>
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
        className={`panel database-query-panel${metadataLoading ? " loading" : ""}${
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
              disabled={!activeSheet || isExecuting || metadataLoading}
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
        {metadataLoading ? (
          <div className="database-workspace-loading-overlay">
            <LoaderCircle className="button-spinner" size={18} />
            <span>Loading metadata...</span>
          </div>
        ) : null}
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
          </div>
          {activeOutput.activeOutputTab === "results" ? (
            <ResultGrid
              rows={activeOutput.resultRows}
              columns={activeOutput.resultColumns}
              meta={activeOutput.resultMeta}
              page={activeOutput.resultPage}
              pageSize={activeOutput.resultPageSize}
              columnWidths={activeOutput.resultColumnWidths}
              onColumnWidthsChange={(columnWidths) =>
                updateActiveSheetOutput((output) => ({
                  ...output,
                  resultColumnWidths: columnWidths,
                }))
              }
              onPageChange={(resultPage) =>
                updateActiveSheetOutput((output) => ({
                  ...output,
                  resultPage,
                }))
              }
              onPageSizeChange={(pageSize) => {
                updateActiveSheetOutput((output) => ({
                  ...output,
                  resultPageSize: pageSize,
                  resultPage: 1,
                }));
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

function ResultGrid({
  rows,
  columns,
  meta,
  page,
  pageSize,
  columnWidths,
  onColumnWidthsChange,
  onPageChange,
  onPageSizeChange,
}: {
  rows: ResultRow[];
  columns: ResultColumn[];
  meta: ResultMeta;
  page: number;
  pageSize: number;
  columnWidths: Partial<Record<ResultColumnKey, number>>;
  onColumnWidthsChange: (
    columnWidths: Partial<Record<ResultColumnKey, number>>,
  ) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}): JSX.Element {
  const resultScrollRef = useRef<HTMLDivElement>(null);
  const columnDragRef = useRef<ResultColumnDragState | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  const hasColumns = columns.length > 0;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = clamp(page, 1, pageCount);
  const pageRows = rows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const calculatedColumns = useMemo(
    () => calculateResultColumnWidths(columns, panelWidth, columnWidths),
    [columns, panelWidth, columnWidths],
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

    const column = columns.find((item) => item.key === drag.key);
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
              {columns.map((column) => (
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
            {pageRows.map((row) => (
              <tr key={row.actor_id}>
                {columns.map((column) => (
                  <td key={`${row.actor_id}-${column.key}`}>
                    {row[column.key]}
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
              : `${meta.rows} rows fetched · Page ${currentPage} of ${pageCount} · ${meta.duration}`}
        </span>
        <time>{meta.hasRun ? formatCompactTime(meta.queriedAt) : ""}</time>
        <div className="database-pagination-controls">
          <AppSelect
            className="database-page-size-select"
            value={String(pageSize)}
            ariaLabel="Result page size"
            options={PAGE_SIZE_OPTIONS}
            onChange={(nextPageSize) => onPageSizeChange(Number(nextPageSize))}
            disabled={!meta.hasRun || meta.status === "error"}
          />
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Previous result page"
            title="Previous result page"
            disabled={
              !meta.hasRun || meta.status === "error" || currentPage <= 1
            }
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            className="icon-button secondary"
            type="button"
            aria-label="Next result page"
            title="Next result page"
            disabled={
              !meta.hasRun ||
              meta.status === "error" ||
              currentPage >= pageCount
            }
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

  if (!draft.password) {
    errors.password = "Required";
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
    output: createEmptySheetOutput(),
  };
}

function createEmptySheetOutput(): SheetOutputState {
  return {
    hasExecuted: false,
    activeOutputTab: "results",
    resultRows: [],
    resultColumns: [],
    resultMeta: {
      rows: 0,
      duration: "0.0 ms",
      queriedAt: new Date().toISOString(),
      hasRun: false,
      status: "success",
    },
    resultPage: 1,
    resultPageSize: DEFAULT_PAGE_SIZE,
    resultColumnWidths: {},
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

function createMockMetadata(): DatabaseMetadata {
  return {
    schemas: ["sakila"],
    tables: SAMPLE_TABLES,
    views: ["actor_info", "customer_list", "film_list"],
    routines: ["rewards_report", "get_customer_balance"],
  };
}

function createIdleMetadataState(): DatabaseMetadataState {
  return { status: "idle", metadata: createMockMetadata() };
}

function createLoadingMetadataState(
  metadata = createMockMetadata(),
): DatabaseMetadataState {
  return { status: "loading", metadata };
}

async function fetchDatabaseMetadata(
  connection: DatabaseConnection,
): Promise<DatabaseMetadata> {
  type OptionalDatabaseApi = typeof window.ivsDashboard & {
    getDatabaseMetadata?: (
      connection: DatabaseConnection,
    ) => Promise<Partial<DatabaseMetadata>>;
  };
  const api = window.ivsDashboard as OptionalDatabaseApi;

  if (api.getDatabaseMetadata) {
    const metadata = await api.getDatabaseMetadata(connection);
    return normalizeDatabaseMetadata(metadata);
  }

  // TODO: replace this fallback when the Electron database introspection API is available.
  await new Promise((resolve) => window.setTimeout(resolve, 220));
  return createMockMetadata();
}

function normalizeDatabaseMetadata(
  metadata: Partial<DatabaseMetadata>,
): DatabaseMetadata {
  const fallback = createMockMetadata();
  return {
    schemas: Array.isArray(metadata.schemas)
      ? metadata.schemas
      : fallback.schemas,
    tables: Array.isArray(metadata.tables) ? metadata.tables : fallback.tables,
    views: Array.isArray(metadata.views) ? metadata.views : [],
    routines: Array.isArray(metadata.routines) ? metadata.routines : [],
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
