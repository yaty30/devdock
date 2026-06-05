import { BrowserWindow } from "electron";
import DatabaseConstructor, { type Database } from "better-sqlite3";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  closeSync,
  existsSync,
  appendFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { userInfo } from "node:os";
import {
  createConnection as createMysqlConnection,
  type FieldPacket,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import type {
  ActivityKind,
  ActivityRecord,
  ActivityTone,
  ApiTesterSavedRequestRecord,
  BackendType,
  BuildOutcomeType,
  BuildProfileRecord,
  BuildQueryOptions,
  BuildQueryResult,
  BuildQuerySortKey,
  ApiFetchRecord,
  ApiFetchQueryOptions,
  ApiFetchQueryResult,
  DashboardEvent,
  DatabaseConnection,
  DatabaseConnectionTestResult,
  DatabaseExecutionRecord,
  DatabaseExecutionBatchResult,
  DatabaseExportResult,
  DatabaseMetadata,
  DatabaseObjectCollectionName,
  DatabaseQueryValue,
  DatabaseStatementExecutionResult,
  DatabaseWorksheet,
  DatabaseWorksheetState,
  DashboardSnapshot,
  GitStatusRecord,
  LogChannel,
  LogLine,
  LogQueryResult,
  ProjectRecord,
  ProjectDashboardSummary,
  ProjectEnvFileGroup,
  ProjectEnvFileRecord,
  ProjectEnvFilesResult,
  ProjectEnvScope,
  ProjectEnvVariable,
  PythonDependencyRecord,
  ProjectRuntimeState,
  ProjectSettingsRecord,
  PythonServerType,
  PythonWebServerConfig,
  RecentBuildRecord,
  ServiceAction,
  ServiceName,
  ServiceState,
  ServiceStatusRecord,
  Sheet,
  SheetContentJson,
  SheetUpdate,
  ShutdownEntry,
} from "../shared/dashboardTypes";
import {
  MAX_PROJECTS,
  MAX_RUNNING_SERVICES,
  RUNNING_SERVER_LIMIT_MESSAGE,
} from "../shared/appLimits";
import {
  getProjectBackendLabel,
  getProjectBackendManagementUrl,
  getProjectBackendServiceName,
  getProjectBackendUrl,
  getProjectFrontendUrl,
  getPythonServerTypeLabel,
  getProjectServiceNames,
  isProjectFrontendEnabled,
  normalizeBackendType,
  extractPortFromUrl,
  normalizePythonServerType,
  normalizeProjectSettings,
} from "../shared/projectFrontend";

type OracleDbModule = {
  OUT_FORMAT_OBJECT: number;
  STRING: number;
  SYSASM: number;
  SYSBACKUP: number;
  SYSDBA: number;
  SYSDG: number;
  SYSKM: number;
  SYSOPER: number;
  SYSRAC: number;
  initOracleClient?: (options?: { libDir?: string }) => void;
  oracleClientVersionString?: string;
  thin?: boolean;
  getConnection: (
    options: OracleConnectionOptions,
  ) => Promise<OracleConnection>;
};

type OracleConnectionOptions = {
  user: string;
  password?: string;
  connectString: string;
  connectTimeout?: number;
  configDir?: string;
  privilege?: number;
};

type OracleExecuteOptions = {
  outFormat?: number;
  autoCommit?: boolean;
  fetchArraySize?: number;
  fetchInfo?: Record<string, { type: number }>;
};

type OracleColumnMetadata = {
  name?: string;
  dbTypeName?: string;
  fetchType?: unknown;
  precision?: number;
  scale?: number;
  maxSize?: number;
};

type OracleExecuteResult = {
  rows?: Array<Record<string, unknown>> | unknown[][];
  metaData?: OracleColumnMetadata[];
  rowsAffected?: number;
};

type OracleConnection = {
  execute: (
    statement: string,
    binds?: unknown[] | Record<string, unknown>,
    options?: OracleExecuteOptions,
  ) => Promise<OracleExecuteResult>;
  close: () => Promise<void>;
};

const oracleDriver = require("oracledb") as OracleDbModule;
let oracleClientInitAttempted = false;

type PostgresModule = {
  Client: new (options: PostgresClientOptions) => PostgresClient;
  types?: {
    builtins?: Record<string, number>;
  };
};

type PostgresClientOptions = {
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
  connectionTimeoutMillis: number;
  ssl?:
    | boolean
    | {
        rejectUnauthorized: boolean;
        ca?: string;
        cert?: string;
        key?: string;
      };
};

type PostgresField = {
  name: string;
  dataTypeID: number;
};

type PostgresQueryResult = {
  command?: string;
  fields: PostgresField[];
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
};

type PostgresClient = {
  connect: () => Promise<void>;
  query: (
    statement: string,
    values?: unknown[],
  ) => Promise<PostgresQueryResult>;
  end: () => Promise<void>;
};

const postgresDriver = require("pg") as PostgresModule;

const ORACLE_OBJECT_COUNT_KEY_BY_TYPE: Record<
  string,
  DatabaseObjectCollectionName
> = {
  FUNCTION: "functions",
  VIEW: "views",
  TYPE: "types",
  PACKAGE: "packages",
  PROCEDURE: "procedures",
  SEQUENCE: "sequences",
  TRIGGER: "triggers",
  TABLE: "tables",
  INDEX: "indexes",
};

const ORACLE_OBJECT_TYPE_BY_COLLECTION: Partial<
  Record<DatabaseObjectCollectionName, string>
> = {
  views: "VIEW",
  procedures: "PROCEDURE",
  functions: "FUNCTION",
  types: "TYPE",
  sequences: "SEQUENCE",
  packages: "PACKAGE",
};

const POSTGRES_OBJECT_NAME_QUERY_BY_COLLECTION: Partial<
  Record<DatabaseObjectCollectionName, string>
> = {
  views: `SELECT table_schema AS object_schema,
                 table_name AS object_name
          FROM information_schema.views
          WHERE table_schema = ANY($1)
          ORDER BY table_schema, table_name`,
  procedures: `SELECT n.nspname AS object_schema,
                      p.proname AS object_name
               FROM pg_proc p
               JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = ANY($1)
                 AND p.prokind = 'p'
               ORDER BY n.nspname, p.proname`,
  functions: `SELECT n.nspname AS object_schema,
                     p.proname AS object_name
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = ANY($1)
                AND p.prokind = 'f'
              ORDER BY n.nspname, p.proname`,
  types: `SELECT n.nspname AS object_schema,
                 t.typname AS object_name
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = ANY($1)
            AND t.typtype IN ('b', 'c', 'd', 'e', 'r')
            AND NOT EXISTS (
              SELECT 1
              FROM pg_class c
              WHERE c.oid = t.typrelid
                AND c.relkind IN ('r', 'p', 'v', 'm', 'c')
            )
          ORDER BY n.nspname, t.typname`,
  sequences: `SELECT sequence_schema AS object_schema,
                     sequence_name AS object_name
              FROM information_schema.sequences
              WHERE sequence_schema = ANY($1)
              ORDER BY sequence_schema, sequence_name`,
  triggers: `SELECT event_object_schema AS object_schema,
                    trigger_name AS object_name
             FROM information_schema.triggers
             WHERE trigger_schema = ANY($1)
             GROUP BY event_object_schema, trigger_name
             ORDER BY event_object_schema, trigger_name`,
  indexes: `SELECT schemaname AS object_schema,
                   indexname AS object_name
            FROM pg_indexes
            WHERE schemaname = ANY($1)
            ORDER BY schemaname, indexname`,
};

const MYSQL_DESCRIBE_COLUMNS = [
  { key: "Field", label: "Field", type: "varchar" },
  { key: "Type", label: "Type", type: "varchar" },
  { key: "Null", label: "Null", type: "varchar" },
  { key: "Key", label: "Key", type: "varchar" },
  { key: "Default", label: "Default", type: "varchar" },
  { key: "Extra", label: "Extra", type: "varchar" },
];

type ServiceProcess = {
  child: ChildProcessWithoutNullStreams;
  startedAt: string;
  startupLogAt?: string;
  readyLogAt?: string;
  stopRequested?: boolean;
};

type BuildProcess = {
  child: ChildProcessWithoutNullStreams;
  rowId: number;
  stopRequested: boolean;
};

type BuildResult = "success" | "failed" | "stopped";

type TailState = {
  path: string;
  offset: number;
  lineCount: number;
  timer: NodeJS.Timeout;
};

type BuildRow = {
  id: number;
  project_id: string;
  profile_name: string;
  button_name: string;
  branch: string;
  commit_hash: string;
  commit_cleanliness: string;
  environment: string;
  triggered_by: string;
  status: string;
  outcome_type: BuildOutcomeType;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
};

type ActivityRow = {
  id: number;
  project_id: string;
  title: string;
  meta: string;
  tone: ActivityTone;
  kind: ActivityKind;
  created_at: string;
};

type ProjectRow = ProjectRecord;

type SettingsRow = {
  project_id: string;
  settings_json: string;
  updated_at: string;
};

type SheetRow = {
  id: string;
  project_id: string;
  title: string;
  content_json: string;
  created_at: string;
  updated_at: string;
  auto_save_enabled: number;
  pinned: number;
  pinned_at: string | null;
};

type DatabaseConnectionRow = {
  id: string;
  name: string;
  connection_json: string;
  created_at: string;
  updated_at: string;
};

type DatabaseWorksheetRow = {
  connection_id: string;
  sheet_id: string;
  sheet_name: string;
  sql_content: string;
  saved_at: string;
  is_open: number;
  sort_order: number;
};

type DatabaseWorksheetStateRow = {
  connection_id: string;
  active_sheet_id: string | null;
};

type DatabaseExecutionHistoryRow = {
  id: string;
  executed_at: string;
  connection_id: string;
  connection_name: string;
  database_user: string;
  sql_statement: string;
  duration_ms: number;
  status: "success" | "error";
  row_count: number;
  rows_affected: number | null;
  error_message: string | null;
  execution_message?: string | null;
};

type ApiTesterSavedRequestRow = {
  id: string;
  scope_id: string;
  name: string;
  method: string;
  url: string;
  request_json: string;
  created_at: string;
  updated_at: string;
};

type SettingsActivityEntry = {
  title: string;
  meta: string;
  tone: ActivityTone;
};

const LOG_LIMIT = 5000;
const LOG_BATCH_FLUSH_MS = 50;
const API_FETCH_LIMIT = 1000;
const STATUS_INTERVAL_MS = 5000;
const TAIL_INTERVAL_MS = 1000;
const SERVICE_STARTING_GRACE_MS = 5 * 60 * 1000;
const WILDFLY_READY_LOG_FRAGMENT = "Admin console listening on";
const RETENTION_DAYS = 3;
const DATABASE_EXECUTION_HISTORY_LIMIT = 1000;
const BACKEND_DASHBOARD_LOG_CHANNELS: readonly LogChannel[] = [
  "build",
  "wildfly",
  "python",
];
const DASHBOARD_CLEARED_META_PREFIX = "project-dashboard-cleared-at:";
const STANDALONE_NOTEBOOK_PROJECT_ID = "__ivs_standalone_notebook__";
const EMPTY_SHEET_CONTENT: SheetContentJson = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

const PYTHON_WEB_SERVER_DEFAULTS: Record<
  PythonServerType,
  Pick<
    PythonWebServerConfig,
    "installCommand" | "startCommand" | "appUrl" | "healthCheckUrl"
  >
> = {
  fastapi: {
    installCommand: "pip install -r requirements.txt",
    startCommand: pythonServerStartCommand("uvicorn app.main:app --reload"),
    appUrl: "http://127.0.0.1:8000",
    healthCheckUrl: "http://127.0.0.1:8000/health",
  },
  "flask-api": {
    installCommand: "pip install -r requirements.txt",
    startCommand: pythonServerStartCommand(
      "flask --app app run --debug --host 127.0.0.1 --port 8000",
    ),
    appUrl: "http://127.0.0.1:8000",
    healthCheckUrl: "http://127.0.0.1:8000",
  },
  "django-rest": {
    installCommand: "pip install -r requirements.txt",
    startCommand: pythonServerStartCommand(
      "python manage.py runserver 127.0.0.1:8000",
    ),
    appUrl: "http://127.0.0.1:8000",
    healthCheckUrl: "http://127.0.0.1:8000",
  },
  custom: {
    installCommand: "pip install -r requirements.txt",
    startCommand: "",
    appUrl: "http://127.0.0.1:8000",
    healthCheckUrl: "",
  },
};

const CHANNEL_NAME = "dashboard:event";

export class DashboardBackend {
  private readonly db: Database;
  private readonly repoRoot: string;
  private readonly dataRoot: string;
  private readonly serviceProcesses = new Map<string, ServiceProcess>();
  private readonly explicitlyStoppedServices = new Set<string>();
  private readonly buildProcesses = new Map<string, BuildProcess>();
  private readonly logs = new Map<string, LogLine[]>();
  private readonly logSeqMap = new Map<string, number>();
  private readonly tailStates = new Map<string, TailState>();
  private readonly statusTimers = new Map<string, NodeJS.Timeout>();
  private readonly logBuffer = new Map<string, LogLine[]>();
  private readonly apiFetches = new Map<string, ApiFetchRecord[]>();
  private apiFetchSeq = 0;
  private apiFetchEventBuffer = new Map<string, ApiFetchRecord[]>();
  private apiFetchEventTimer: NodeJS.Timeout | null = null;
  private readonly estimatedRowCountOverrides = new Map<string, number>();
  private readonly estimatedRowCountSnapshots = new Map<
    string,
    number | null
  >();
  private logFlushTimer: NodeJS.Timeout | null = null;

  constructor(userDataPath: string, repoRoot: string) {
    const dbDir = join(userDataPath, "dashboard");
    mkdirSync(dbDir, { recursive: true });
    this.dataRoot = dbDir;
    this.repoRoot = repoRoot;
    this.db = new DatabaseConstructor(join(dbDir, "ivs-dashboard.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.initializeSchema();
    this.ensureStandaloneNotebookProject();
    this.markInterruptedBuilds();
  }

  getSnapshot(): DashboardSnapshot {
    const projects = this.db
      .prepare(
        `SELECT id, name, code, backend_type AS backendType
         FROM projects
         WHERE id <> ?
         ORDER BY created_at ASC`,
      )
      .all(STANDALONE_NOTEBOOK_PROJECT_ID) as ProjectRow[];

    return {
      projects,
      activeProjectId: projects[0]?.id ?? "",
    };
  }

  getDatabaseConnections(): DatabaseConnection[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, connection_json, created_at, updated_at
         FROM database_connections
         ORDER BY created_at ASC`,
      )
      .all() as DatabaseConnectionRow[];

    return rows.map((row) => this.mapDatabaseConnection(row));
  }

  async saveDatabaseConnection(
    connection: DatabaseConnection,
  ): Promise<DatabaseConnection> {
    const normalized = normalizeDatabaseConnection(connection);
    const duplicate = this.db
      .prepare(
        `SELECT 1 FROM database_connections
         WHERE id <> ? AND name = ? COLLATE NOCASE`,
      )
      .get(normalized.id, normalized.name);
    if (duplicate !== undefined) {
      throw new Error("A database connection with this name already exists.");
    }

    const testResult = await this.testDatabaseConnection(normalized);
    if (!testResult.success) {
      throw new Error(testResult.message);
    }

    const saved: DatabaseConnection = {
      ...normalized,
      status: "connected",
      latency: testResult.latency ?? normalized.latency,
      uptime: "Session",
      activeSessions: 1,
      password: normalized.savePassword ? normalized.password : undefined,
    };
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT created_at FROM database_connections WHERE id = ?")
      .get(saved.id) as { created_at: string } | undefined;

    this.db
      .prepare(
        `INSERT OR REPLACE INTO database_connections (
           id, name, connection_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        saved.id,
        saved.name,
        JSON.stringify(saved),
        existing?.created_at ?? now,
        now,
      );

    return saved;
  }

  updateDatabaseConnectionSettings(
    connectionId: string,
    updates: Partial<
      Pick<
        DatabaseConnection,
        "autoConnect" | "status" | "latency" | "uptime" | "activeSessions"
      >
    >,
  ): DatabaseConnection {
    const row = this.db
      .prepare(
        `SELECT id, name, connection_json, created_at, updated_at
         FROM database_connections
         WHERE id = ?`,
      )
      .get(connectionId) as DatabaseConnectionRow | undefined;
    if (!row) {
      throw new Error("Database connection not found.");
    }

    const current = this.mapDatabaseConnection(row);
    const next = normalizeDatabaseConnection({ ...current, ...updates });
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE database_connections
         SET connection_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(next), now, next.id);

    return next;
  }

  deleteDatabaseConnection(connectionId: string): void {
    this.db
      .prepare("DELETE FROM database_worksheets WHERE connection_id = ?")
      .run(connectionId);
    this.db
      .prepare("DELETE FROM database_worksheet_state WHERE connection_id = ?")
      .run(connectionId);
    this.db
      .prepare("DELETE FROM database_execution_history WHERE connection_id = ?")
      .run(connectionId);
    const result = this.db
      .prepare("DELETE FROM database_connections WHERE id = ?")
      .run(connectionId);
    if (result.changes === 0) {
      throw new Error("Database connection not found.");
    }
  }

  getDatabaseWorksheetState(connectionId: string): DatabaseWorksheetState {
    this.ensureDatabaseConnectionExists(connectionId);
    const rows = this.db
      .prepare(
        `SELECT connection_id, sheet_id, sheet_name, sql_content, saved_at,
          is_open, sort_order
         FROM database_worksheets
         WHERE connection_id = ?
         ORDER BY sort_order ASC,
            datetime(saved_at) DESC,
            sheet_name COLLATE NOCASE ASC`,
      )
      .all(connectionId) as DatabaseWorksheetRow[];
    const state = this.db
      .prepare(
        `SELECT connection_id, active_sheet_id
         FROM database_worksheet_state
         WHERE connection_id = ?`,
      )
      .get(connectionId) as DatabaseWorksheetStateRow | undefined;
    const sheets = rows.map(mapDatabaseWorksheetRow);
    const activeSheetId = sheets.some(
      (sheet) => sheet.sheetId === state?.active_sheet_id,
    )
      ? (state?.active_sheet_id ?? null)
      : (sheets.find((sheet) => sheet.isOpen)?.sheetId ??
        sheets[0]?.sheetId ??
        null);

    return { connectionId, sheets, activeSheetId };
  }

  saveDatabaseWorksheetState(
    state: DatabaseWorksheetState,
  ): DatabaseWorksheetState {
    this.ensureDatabaseConnectionExists(state.connectionId);
    const now = new Date().toISOString();
    const activeSheetId = state.sheets.some(
      (sheet) => sheet.sheetId === state.activeSheetId,
    )
      ? state.activeSheetId
      : null;

    this.db
      .prepare("DELETE FROM database_worksheets WHERE connection_id = ?")
      .run(state.connectionId);
    const insertSheet = this.db.prepare(
      `INSERT INTO database_worksheets (
         connection_id, sheet_id, sheet_name, sql_content, saved_at, is_open,
         sort_order
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [index, sheet] of state.sheets.entries()) {
      const sheetName = sheet.sheetName.trim() || "Untitled";
      insertSheet.run(
        state.connectionId,
        sheet.sheetId,
        sheetName,
        sheet.sql,
        sheet.savedAt || now,
        sheet.isOpen ? 1 : 0,
        Number.isFinite(sheet.sortOrder) ? sheet.sortOrder : index,
      );
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO database_worksheet_state (
           connection_id, active_sheet_id, updated_at
         ) VALUES (?, ?, ?)`,
      )
      .run(state.connectionId, activeSheetId, now);

    return this.getDatabaseWorksheetState(state.connectionId);
  }

  deleteDatabaseWorksheet(connectionId: string, sheetId: string): void {
    this.ensureDatabaseConnectionExists(connectionId);
    this.db
      .prepare(
        `DELETE FROM database_worksheets
         WHERE connection_id = ? AND sheet_id = ?`,
      )
      .run(connectionId, sheetId);
    const state = this.db
      .prepare(
        `SELECT active_sheet_id
         FROM database_worksheet_state
         WHERE connection_id = ?`,
      )
      .get(connectionId) as { active_sheet_id: string | null } | undefined;
    if (state?.active_sheet_id === sheetId) {
      const nextActive = this.db
        .prepare(
          `SELECT sheet_id
           FROM database_worksheets
           WHERE connection_id = ? AND is_open = 1
           ORDER BY sort_order ASC, datetime(saved_at) DESC
           LIMIT 1`,
        )
        .get(connectionId) as { sheet_id: string } | undefined;
      this.db
        .prepare(
          `UPDATE database_worksheet_state
           SET active_sheet_id = ?, updated_at = ?
           WHERE connection_id = ?`,
        )
        .run(
          nextActive?.sheet_id ?? null,
          new Date().toISOString(),
          connectionId,
        );
    }
  }

  getDatabaseExecutionHistory(
    connectionId?: string,
  ): DatabaseExecutionRecord[] {
    this.pruneDatabaseExecutionHistory(connectionId);
    const whereParts: string[] = [];
    const params: unknown[] = [];
    if (connectionId) {
      this.ensureDatabaseConnectionExists(connectionId);
      whereParts.push("connection_id = ?");
      params.push(connectionId);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM database_execution_history
         ${whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : ""}
         ORDER BY datetime(executed_at) DESC, rowid DESC
         ${connectionId ? `LIMIT ${DATABASE_EXECUTION_HISTORY_LIMIT}` : ""}`,
      )
      .all(...params) as DatabaseExecutionHistoryRow[];
    return rows.map(mapDatabaseExecutionHistoryRow);
  }

  async testDatabaseConnection(
    connection: DatabaseConnection,
  ): Promise<DatabaseConnectionTestResult> {
    const startedAt = performance.now();
    if (connection.type === "Oracle") {
      let oracleConnection: OracleConnection | null = null;
      try {
        oracleConnection = await createOracleConnection(connection);
        await oracleConnection.execute(
          "SELECT 1 AS HEALTH_CHECK FROM DUAL",
          [],
          {
            outFormat: oracleDriver.OUT_FORMAT_OBJECT,
          },
        );
        const latency = `${Math.max(1, performance.now() - startedAt).toFixed(1)} ms`;
        return {
          success: true,
          message: `Connected to ${formatOracleConnectionTarget(connection)}.`,
          latency,
        };
      } catch (error) {
        return {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Database connection test failed.",
        };
      } finally {
        if (oracleConnection) {
          await oracleConnection.close().catch(() => undefined);
        }
      }
    }

    if (connection.type === "PostgreSQL") {
      let postgresClient: PostgresClient | null = null;
      try {
        postgresClient = createPostgresClient(connection);
        await postgresClient.connect();
        await postgresClient.query("SELECT 1 AS health_check");
        const latency = `${Math.max(1, performance.now() - startedAt).toFixed(1)} ms`;
        return {
          success: true,
          message: `Connected to ${connection.host}:${connection.port}.`,
          latency,
        };
      } catch (error) {
        return {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Database connection test failed.",
        };
      } finally {
        if (postgresClient) {
          await postgresClient.end().catch(() => undefined);
        }
      }
    }

    let mysqlConnection: Awaited<
      ReturnType<typeof createMysqlConnection>
    > | null = null;
    try {
      mysqlConnection = await createMysqlConnection(
        toMysqlConnectionOptions(connection),
      );
      await mysqlConnection.ping();
      const latency = `${Math.max(1, performance.now() - startedAt).toFixed(1)} ms`;
      return {
        success: true,
        message: `Connected to ${connection.host}:${connection.port}.`,
        latency,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Database connection test failed.",
      };
    } finally {
      if (mysqlConnection) {
        await mysqlConnection.end().catch(() => undefined);
      }
    }
  }

  async getDatabaseMetadata(
    connection: DatabaseConnection,
  ): Promise<DatabaseMetadata> {
    if (connection.type === "Oracle") {
      return this.getOracleDatabaseMetadata(connection);
    }
    if (connection.type === "PostgreSQL") {
      return this.getPostgresDatabaseMetadata(connection);
    }

    const mysqlConnection = await createMysqlConnection(
      toMysqlConnectionOptions(connection, { includeDatabase: false }),
    );
    try {
      const [schemaRows] = await mysqlConnection.query<RowDataPacket[]>(
        `SELECT SCHEMA_NAME AS schemaName
         FROM INFORMATION_SCHEMA.SCHEMATA
         ORDER BY SCHEMA_NAME`,
      );
      const schemas = schemaRows.map((row) => String(row.schemaName));
      const relevantSchemas = selectRelevantSchemas(schemas, connection);

      if (relevantSchemas.length === 0) {
        return createEmptyDatabaseMetadata(schemas);
      }

      const schemaPlaceholders = relevantSchemas.map(() => "?").join(", ");
      const [tableRows] = await mysqlConnection.query<RowDataPacket[]>(
        `SELECT TABLE_SCHEMA AS tableSchema, TABLE_NAME AS tableName
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA IN (${schemaPlaceholders})
           AND TABLE_TYPE = 'BASE TABLE'
         ORDER BY TABLE_SCHEMA, TABLE_NAME`,
        relevantSchemas,
      );
      const [tableCountRows] = await mysqlConnection.query<RowDataPacket[]>(
        `SELECT TABLE_SCHEMA AS tableSchema,
                TABLE_NAME AS tableName,
                TABLE_ROWS AS row_count
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA IN (${schemaPlaceholders})
           AND TABLE_TYPE = 'BASE TABLE'
         ORDER BY TABLE_SCHEMA, TABLE_NAME`,
        relevantSchemas,
      );
      const [viewRows] = await mysqlConnection.query<RowDataPacket[]>(
        `SELECT TABLE_SCHEMA AS tableSchema, TABLE_NAME AS tableName
         FROM INFORMATION_SCHEMA.VIEWS
         WHERE TABLE_SCHEMA IN (${schemaPlaceholders})
         ORDER BY TABLE_SCHEMA, TABLE_NAME`,
        relevantSchemas,
      );
      const [routineRows] = await mysqlConnection.query<RowDataPacket[]>(
        `SELECT ROUTINE_SCHEMA AS routineSchema,
                ROUTINE_NAME AS routineName,
                ROUTINE_TYPE AS routineType
         FROM INFORMATION_SCHEMA.ROUTINES
         WHERE ROUTINE_SCHEMA IN (${schemaPlaceholders})
         ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME`,
        relevantSchemas,
      );
      const [columnRows] = await mysqlConnection.query<RowDataPacket[]>(
        `SELECT TABLE_SCHEMA AS tableSchema,
                TABLE_NAME AS tableName,
                COLUMN_NAME AS columnName,
                COLUMN_TYPE AS columnType,
                COLUMN_KEY AS columnKey,
                IS_NULLABLE AS isNullable,
                COLUMN_DEFAULT AS columnDefault,
                COLUMN_COMMENT AS columnComment,
                EXTRA AS extra
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA IN (${schemaPlaceholders})
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
        relevantSchemas,
      );
      const [indexRows] = await mysqlConnection.query<RowDataPacket[]>(
        `SELECT TABLE_SCHEMA AS tableSchema,
                TABLE_NAME AS tableName,
                INDEX_NAME AS indexName,
                COLUMN_NAME AS columnName,
                INDEX_TYPE AS indexType,
                SEQ_IN_INDEX AS sequenceInIndex
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA IN (${schemaPlaceholders})
         ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
        relevantSchemas,
      );
      const [triggerRows] = await mysqlConnection.query<RowDataPacket[]>(
        `SELECT TRIGGER_SCHEMA AS triggerSchema,
                EVENT_OBJECT_TABLE AS tableName,
                TRIGGER_NAME AS triggerName,
                ACTION_TIMING AS actionTiming,
                EVENT_MANIPULATION AS eventManipulation
         FROM INFORMATION_SCHEMA.TRIGGERS
         WHERE TRIGGER_SCHEMA IN (${schemaPlaceholders})
         ORDER BY TRIGGER_SCHEMA, EVENT_OBJECT_TABLE, TRIGGER_NAME`,
        relevantSchemas,
      );
      const [partitionRows] = await mysqlConnection.query<RowDataPacket[]>(
        `SELECT TABLE_SCHEMA AS tableSchema,
                TABLE_NAME AS tableName,
                PARTITION_NAME AS partitionName,
                PARTITION_METHOD AS partitionMethod,
                PARTITION_EXPRESSION AS partitionExpression,
                PARTITION_DESCRIPTION AS partitionDescription
         FROM INFORMATION_SCHEMA.PARTITIONS
         WHERE TABLE_SCHEMA IN (${schemaPlaceholders})
           AND PARTITION_NAME IS NOT NULL
         ORDER BY TABLE_SCHEMA, TABLE_NAME, PARTITION_ORDINAL_POSITION`,
        relevantSchemas,
      );
      const columnsByTable = new Map<
        string,
        DatabaseMetadata["tables"][number]["columns"]
      >();
      const indexAccumulator = new Map<
        string,
        Map<string, { name: string; columns: string[]; type: string }>
      >();
      const triggersByTable = new Map<
        string,
        DatabaseMetadata["tables"][number]["triggers"]
      >();
      const partitionsByTable = new Map<
        string,
        DatabaseMetadata["tables"][number]["partitions"]
      >();
      const estimatedRowCountsByTableKey = new Map<string, number | null>();

      for (const row of tableCountRows) {
        const tableSchema = String(row.tableSchema);
        const tableName = String(row.tableName);
        const tableKey = `${tableSchema}.${tableName}`;
        const rowCount = row.row_count;
        const informationSchemaCount =
          rowCount === null || rowCount === undefined ? null : Number(rowCount);
        const cacheKey = createEstimatedRowCountCacheKey(
          connection,
          tableSchema,
          tableName,
        );
        const estimatedRowCount =
          this.estimatedRowCountOverrides.get(cacheKey) ??
          informationSchemaCount;
        estimatedRowCountsByTableKey.set(tableKey, estimatedRowCount);
        this.estimatedRowCountSnapshots.set(cacheKey, estimatedRowCount);
      }

      for (const row of tableRows) {
        const tableSchema = String(row.tableSchema);
        const tableName = String(row.tableName);
        const tableKey = `${tableSchema}.${tableName}`;
        if (estimatedRowCountsByTableKey.has(tableKey)) {
          continue;
        }
        const cacheKey = createEstimatedRowCountCacheKey(
          connection,
          tableSchema,
          tableName,
        );
        const estimatedRowCount =
          this.estimatedRowCountOverrides.get(cacheKey) ?? null;
        estimatedRowCountsByTableKey.set(tableKey, estimatedRowCount);
        this.estimatedRowCountSnapshots.set(cacheKey, estimatedRowCount);
      }

      for (const row of columnRows) {
        const tableKey = `${row.tableSchema}.${row.tableName}`;
        const columns = columnsByTable.get(tableKey) ?? [];
        columns.push({
          name: String(row.columnName),
          metadata: createColumnMetadata(row),
        });
        columnsByTable.set(tableKey, columns);
      }

      for (const row of indexRows) {
        const tableKey = `${row.tableSchema}.${row.tableName}`;
        const indexes = indexAccumulator.get(tableKey) ?? new Map();
        const indexName = String(row.indexName);
        const index = indexes.get(indexName) ?? {
          name: indexName,
          columns: [],
          type: String(row.indexType || "INDEX").toUpperCase(),
        };
        if (row.columnName !== null && row.columnName !== undefined) {
          index.columns.push(String(row.columnName));
        }
        indexes.set(indexName, index);
        indexAccumulator.set(tableKey, indexes);
      }

      for (const row of triggerRows) {
        const tableKey = `${row.triggerSchema}.${row.tableName}`;
        const triggers = triggersByTable.get(tableKey) ?? [];
        triggers.push({
          name: String(row.triggerName),
          timing: String(row.actionTiming || ""),
          event: String(row.eventManipulation || ""),
        });
        triggersByTable.set(tableKey, triggers);
      }

      for (const row of partitionRows) {
        const tableKey = `${row.tableSchema}.${row.tableName}`;
        const partitions = partitionsByTable.get(tableKey) ?? [];
        partitions.push({
          name: String(row.partitionName),
          method: row.partitionMethod ? String(row.partitionMethod) : undefined,
          expression: row.partitionExpression
            ? String(row.partitionExpression)
            : undefined,
          description: row.partitionDescription
            ? String(row.partitionDescription)
            : undefined,
        });
        partitionsByTable.set(tableKey, partitions);
      }

      return {
        schemas,
        tables: tableRows.map((row) => ({
          schema: String(row.tableSchema),
          name: String(row.tableName),
          estimatedRowCount: estimatedRowCountsByTableKey.get(
            `${row.tableSchema}.${row.tableName}`,
          ),
          columns:
            columnsByTable.get(`${row.tableSchema}.${row.tableName}`) ?? [],
          indexes: Array.from(
            indexAccumulator
              .get(`${row.tableSchema}.${row.tableName}`)
              ?.values() ?? [],
          ),
          triggers:
            triggersByTable.get(`${row.tableSchema}.${row.tableName}`) ?? [],
          partitions:
            partitionsByTable.get(`${row.tableSchema}.${row.tableName}`) ?? [],
        })),
        views: viewRows.map((row) =>
          qualifyDatabaseObject(row.tableSchema, row.tableName),
        ),
        procedures: routineRows
          .filter(
            (row) => String(row.routineType).toUpperCase() === "PROCEDURE",
          )
          .map((row) =>
            qualifyDatabaseObject(row.routineSchema, row.routineName),
          ),
        functions: routineRows
          .filter((row) => String(row.routineType).toUpperCase() === "FUNCTION")
          .map((row) =>
            qualifyDatabaseObject(row.routineSchema, row.routineName),
          ),
        types: [],
        sequences: [],
        packages: [],
        objectCounts: {},
      };
    } finally {
      await mysqlConnection.end().catch(() => undefined);
    }
  }

  async getDatabaseObjectNames(
    connection: DatabaseConnection,
    collection: DatabaseObjectCollectionName,
  ): Promise<string[]> {
    if (connection.type === "Oracle") {
      return this.getOracleDatabaseObjectNames(connection, collection);
    }
    if (connection.type === "PostgreSQL") {
      return this.getPostgresDatabaseObjectNames(connection, collection);
    }

    return [];
  }

  private async getPostgresDatabaseMetadata(
    connection: DatabaseConnection,
  ): Promise<DatabaseMetadata> {
    const postgresClient = createPostgresClient(connection, {
      includeDatabase: true,
    });
    await postgresClient.connect();
    try {
      const schemaRows = await executePostgresRows(
        postgresClient,
        `SELECT schema_name
         FROM information_schema.schemata
         ORDER BY schema_name`,
      );
      const schemas = schemaRows.map((row) => String(row.schema_name));
      const relevantSchemas = selectRelevantPostgresSchemas(
        schemas,
        connection,
      );

      if (relevantSchemas.length === 0) {
        return createEmptyDatabaseMetadata(schemas);
      }

      const [tableRows, columnRows, indexRows, triggerRows, partitionRows] =
        await Promise.all([
          executePostgresRows(
            postgresClient,
            `SELECT n.nspname AS table_schema,
                    c.relname AS table_name,
                    c.reltuples AS row_count
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = ANY($1)
               AND c.relkind IN ('r', 'p')
             ORDER BY n.nspname, c.relname`,
            [relevantSchemas],
          ),
          executePostgresRows(
            postgresClient,
            `SELECT table_schema,
                    table_name,
                    column_name,
                    data_type,
                    udt_name,
                    character_maximum_length,
                    numeric_precision,
                    numeric_scale,
                    is_nullable,
                    column_default
             FROM information_schema.columns
             WHERE table_schema = ANY($1)
             ORDER BY table_schema, table_name, ordinal_position`,
            [relevantSchemas],
          ),
          executePostgresRows(
            postgresClient,
            `SELECT ns.nspname AS table_schema,
                    tbl.relname AS table_name,
                    idx.relname AS index_name,
                    am.amname AS index_type,
                    attr.attname AS column_name,
                    ord.ordinality AS column_position,
                    ix.indisprimary,
                    ix.indisunique
             FROM pg_index ix
             JOIN pg_class tbl ON tbl.oid = ix.indrelid
             JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
             JOIN pg_class idx ON idx.oid = ix.indexrelid
             JOIN pg_am am ON am.oid = idx.relam
             LEFT JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS ord(attnum, ordinality)
               ON TRUE
             LEFT JOIN pg_attribute attr
               ON attr.attrelid = tbl.oid
              AND attr.attnum = ord.attnum
             WHERE ns.nspname = ANY($1)
             ORDER BY ns.nspname, tbl.relname, idx.relname, ord.ordinality`,
            [relevantSchemas],
          ),
          executePostgresRows(
            postgresClient,
            `SELECT trigger_schema,
                    event_object_table AS table_name,
                    trigger_name,
                    action_timing,
                    string_agg(DISTINCT event_manipulation, ', ' ORDER BY event_manipulation) AS event_manipulation
             FROM information_schema.triggers
             WHERE trigger_schema = ANY($1)
             GROUP BY trigger_schema, event_object_table, trigger_name, action_timing
             ORDER BY trigger_schema, event_object_table, trigger_name`,
            [relevantSchemas],
          ),
          executePostgresRows(
            postgresClient,
            `SELECT parent_ns.nspname AS table_schema,
                    parent.relname AS table_name,
                    child.relname AS partition_name,
                    pg_get_expr(child.relpartbound, child.oid) AS partition_description
             FROM pg_inherits
             JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
             JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
             JOIN pg_class child ON child.oid = pg_inherits.inhrelid
             WHERE parent_ns.nspname = ANY($1)
             ORDER BY parent_ns.nspname, parent.relname, child.relname`,
            [relevantSchemas],
          ),
        ]);

      const [views, procedures, functions, types, sequences] =
        await Promise.all([
          this.getPostgresObjectNamesWithClient(
            postgresClient,
            "views",
            relevantSchemas,
          ),
          this.getPostgresObjectNamesWithClient(
            postgresClient,
            "procedures",
            relevantSchemas,
          ),
          this.getPostgresObjectNamesWithClient(
            postgresClient,
            "functions",
            relevantSchemas,
          ),
          this.getPostgresObjectNamesWithClient(
            postgresClient,
            "types",
            relevantSchemas,
          ),
          this.getPostgresObjectNamesWithClient(
            postgresClient,
            "sequences",
            relevantSchemas,
          ),
        ]);

      const columnsByTable = new Map<
        string,
        DatabaseMetadata["tables"][number]["columns"]
      >();
      const indexAccumulator = new Map<
        string,
        Map<string, { name: string; columns: string[]; type: string }>
      >();
      const triggersByTable = new Map<
        string,
        DatabaseMetadata["tables"][number]["triggers"]
      >();
      const partitionsByTable = new Map<
        string,
        DatabaseMetadata["tables"][number]["partitions"]
      >();
      const estimatedRowCountsByTableKey = new Map<string, number | null>();

      for (const row of tableRows) {
        const tableSchema = String(row.table_schema);
        const tableName = String(row.table_name);
        const rawRowCount = row.row_count;
        const postgresRowCount =
          rawRowCount === null || rawRowCount === undefined
            ? null
            : Math.max(0, Math.round(Number(rawRowCount)));
        const cacheKey = createEstimatedRowCountCacheKey(
          connection,
          tableSchema,
          tableName,
        );
        const estimatedRowCount =
          this.estimatedRowCountOverrides.get(cacheKey) ?? postgresRowCount;
        estimatedRowCountsByTableKey.set(
          `${tableSchema}.${tableName}`,
          estimatedRowCount,
        );
        this.estimatedRowCountSnapshots.set(cacheKey, estimatedRowCount);
      }

      for (const row of columnRows) {
        const tableKey = `${row.table_schema}.${row.table_name}`;
        const columns = columnsByTable.get(tableKey) ?? [];
        columns.push({
          name: String(row.column_name),
          metadata: createPostgresColumnMetadata(row),
        });
        columnsByTable.set(tableKey, columns);
      }

      for (const row of indexRows) {
        const tableKey = `${row.table_schema}.${row.table_name}`;
        const indexes = indexAccumulator.get(tableKey) ?? new Map();
        const indexName = String(row.index_name);
        const index = indexes.get(indexName) ?? {
          name: indexName,
          columns: [],
          type: formatPostgresIndexType(row),
        };
        if (row.column_name !== null && row.column_name !== undefined) {
          index.columns.push(String(row.column_name));
        }
        indexes.set(indexName, index);
        indexAccumulator.set(tableKey, indexes);
      }

      for (const row of triggerRows) {
        const tableKey = `${row.trigger_schema}.${row.table_name}`;
        const triggers = triggersByTable.get(tableKey) ?? [];
        triggers.push({
          name: String(row.trigger_name),
          timing: String(row.action_timing || ""),
          event: String(row.event_manipulation || ""),
        });
        triggersByTable.set(tableKey, triggers);
      }

      for (const row of partitionRows) {
        const tableKey = `${row.table_schema}.${row.table_name}`;
        const partitions = partitionsByTable.get(tableKey) ?? [];
        partitions.push({
          name: String(row.partition_name),
          description:
            row.partition_description === null ||
            row.partition_description === undefined
              ? undefined
              : String(row.partition_description),
        });
        partitionsByTable.set(tableKey, partitions);
      }

      return {
        schemas,
        tables: tableRows.map((row) => ({
          schema: String(row.table_schema),
          name: String(row.table_name),
          estimatedRowCount: estimatedRowCountsByTableKey.get(
            `${row.table_schema}.${row.table_name}`,
          ),
          columns:
            columnsByTable.get(`${row.table_schema}.${row.table_name}`) ?? [],
          indexes: Array.from(
            indexAccumulator
              .get(`${row.table_schema}.${row.table_name}`)
              ?.values() ?? [],
          ),
          triggers:
            triggersByTable.get(`${row.table_schema}.${row.table_name}`) ?? [],
          partitions:
            partitionsByTable.get(`${row.table_schema}.${row.table_name}`) ??
            [],
        })),
        views,
        procedures,
        functions,
        types,
        sequences,
        packages: [],
        objectCounts: {
          tables: tableRows.length,
          views: views.length,
          procedures: procedures.length,
          functions: functions.length,
          types: types.length,
          sequences: sequences.length,
        },
      };
    } finally {
      await postgresClient.end().catch(() => undefined);
    }
  }

  private async getPostgresDatabaseObjectNames(
    connection: DatabaseConnection,
    collection: DatabaseObjectCollectionName,
  ): Promise<string[]> {
    const postgresClient = createPostgresClient(connection, {
      includeDatabase: true,
    });
    await postgresClient.connect();
    try {
      const schemaRows = await executePostgresRows(
        postgresClient,
        `SELECT schema_name
         FROM information_schema.schemata
         ORDER BY schema_name`,
      );
      const schemas = schemaRows.map((row) => String(row.schema_name));
      const relevantSchemas = selectRelevantPostgresSchemas(
        schemas,
        connection,
      );
      return this.getPostgresObjectNamesWithClient(
        postgresClient,
        collection,
        relevantSchemas,
      );
    } finally {
      await postgresClient.end().catch(() => undefined);
    }
  }

  private async getPostgresObjectNamesWithClient(
    postgresClient: PostgresClient,
    collection: DatabaseObjectCollectionName,
    relevantSchemas: string[],
  ): Promise<string[]> {
    const query = POSTGRES_OBJECT_NAME_QUERY_BY_COLLECTION[collection];
    if (!query || relevantSchemas.length === 0) {
      return [];
    }

    const rows = await executePostgresRows(postgresClient, query, [
      relevantSchemas,
    ]);
    return rows.map((row) =>
      qualifyDatabaseObject(row.object_schema, row.object_name),
    );
  }

  private async getOracleDatabaseMetadata(
    connection: DatabaseConnection,
  ): Promise<DatabaseMetadata> {
    const oracleConnection = await createOracleConnection(connection);
    try {
      const schemaRows = await executeOracleRows(
        oracleConnection,
        `SELECT USERNAME AS SCHEMA_NAME
         FROM ALL_USERS
         ORDER BY USERNAME`,
      );
      const schemas = schemaRows.map((row) => String(row.SCHEMA_NAME));
      const relevantSchemas = selectRelevantOracleSchemas(schemas, connection);

      if (relevantSchemas.length === 0) {
        return createEmptyDatabaseMetadata(schemas);
      }

      const schemaFilter = createOracleInPredicate("OWNER", relevantSchemas);
      const tableOwnerFilter = createOracleInPredicate(
        "TABLE_OWNER",
        relevantSchemas,
      );
      const indexTableOwnerFilter = createOracleInPredicate(
        "IC.TABLE_OWNER",
        relevantSchemas,
      );
      const objectCountRows = await executeOracleRows(
        oracleConnection,
        `SELECT object_type, COUNT(*) AS object_count
         FROM user_objects
         WHERE object_type IN (
           'FUNCTION',
           'VIEW',
           'TYPE',
           'PACKAGE',
           'PROCEDURE',
           'SEQUENCE',
           'TRIGGER',
           'TABLE',
           'INDEX'
         )
         GROUP BY object_type
         ORDER BY object_type`,
      );
      const tableRows = await executeOracleRows(
        oracleConnection,
        `SELECT OWNER AS TABLE_SCHEMA,
                TABLE_NAME AS TABLE_NAME,
                NUM_ROWS AS ROW_COUNT
         FROM ALL_TABLES
         WHERE ${schemaFilter.sql}
           AND NESTED = 'NO'
         ORDER BY OWNER, TABLE_NAME`,
        schemaFilter.binds,
      );
      const columnRows = await executeOracleRows(
        oracleConnection,
        `SELECT OWNER AS TABLE_SCHEMA,
                TABLE_NAME AS TABLE_NAME,
                COLUMN_NAME AS COLUMN_NAME,
                DATA_TYPE AS DATA_TYPE,
                DATA_LENGTH AS DATA_LENGTH,
                CHAR_LENGTH AS CHAR_LENGTH,
                DATA_PRECISION AS DATA_PRECISION,
                DATA_SCALE AS DATA_SCALE,
                NULLABLE AS NULLABLE,
                DATA_DEFAULT AS DATA_DEFAULT
         FROM ALL_TAB_COLUMNS
         WHERE ${schemaFilter.sql}
         ORDER BY OWNER, TABLE_NAME, COLUMN_ID`,
        schemaFilter.binds,
      );
      const indexRows = await executeOracleRows(
        oracleConnection,
        `SELECT IC.TABLE_OWNER AS TABLE_SCHEMA,
                IC.TABLE_NAME AS TABLE_NAME,
                IC.INDEX_NAME AS INDEX_NAME,
                IC.COLUMN_NAME AS COLUMN_NAME,
                IX.INDEX_TYPE AS INDEX_TYPE,
                IC.COLUMN_POSITION AS COLUMN_POSITION
         FROM ALL_IND_COLUMNS IC
         JOIN ALL_INDEXES IX
           ON IX.OWNER = IC.INDEX_OWNER
          AND IX.INDEX_NAME = IC.INDEX_NAME
         WHERE ${indexTableOwnerFilter.sql}
         ORDER BY IC.TABLE_OWNER, IC.TABLE_NAME, IC.INDEX_NAME, IC.COLUMN_POSITION`,
        indexTableOwnerFilter.binds,
      );
      const triggerRows = await executeOracleRows(
        oracleConnection,
        `SELECT OWNER AS TRIGGER_SCHEMA,
                TABLE_NAME AS TABLE_NAME,
                TRIGGER_NAME AS TRIGGER_NAME,
                TRIGGER_TYPE AS TRIGGER_TYPE,
                TRIGGERING_EVENT AS TRIGGERING_EVENT
         FROM ALL_TRIGGERS
         WHERE ${schemaFilter.sql}
         ORDER BY OWNER, TABLE_NAME, TRIGGER_NAME`,
        schemaFilter.binds,
      );
      const partitionRows = await executeOracleRows(
        oracleConnection,
        `SELECT TABLE_OWNER AS TABLE_SCHEMA,
                TABLE_NAME AS TABLE_NAME,
                PARTITION_NAME AS PARTITION_NAME,
                PARTITION_POSITION AS PARTITION_POSITION
         FROM ALL_TAB_PARTITIONS
         WHERE ${tableOwnerFilter.sql}
         ORDER BY TABLE_OWNER, TABLE_NAME, PARTITION_POSITION`,
        tableOwnerFilter.binds,
      );

      const columnsByTable = new Map<
        string,
        DatabaseMetadata["tables"][number]["columns"]
      >();
      const indexAccumulator = new Map<
        string,
        Map<string, { name: string; columns: string[]; type: string }>
      >();
      const triggersByTable = new Map<
        string,
        DatabaseMetadata["tables"][number]["triggers"]
      >();
      const partitionsByTable = new Map<
        string,
        DatabaseMetadata["tables"][number]["partitions"]
      >();
      const estimatedRowCountsByTableKey = new Map<string, number | null>();
      const objectCounts: DatabaseMetadata["objectCounts"] = {};

      for (const row of objectCountRows) {
        const key =
          ORACLE_OBJECT_COUNT_KEY_BY_TYPE[
            String(row.OBJECT_TYPE).toUpperCase()
          ];
        if (key) {
          objectCounts[key] = Number(row.OBJECT_COUNT ?? 0);
        }
      }

      for (const row of tableRows) {
        const tableSchema = String(row.TABLE_SCHEMA);
        const tableName = String(row.TABLE_NAME);
        const rowCount = row.ROW_COUNT;
        const oracleRowCount =
          rowCount === null || rowCount === undefined ? null : Number(rowCount);
        const cacheKey = createEstimatedRowCountCacheKey(
          connection,
          tableSchema,
          tableName,
        );
        const estimatedRowCount =
          this.estimatedRowCountOverrides.get(cacheKey) ?? oracleRowCount;
        estimatedRowCountsByTableKey.set(
          `${tableSchema}.${tableName}`,
          estimatedRowCount,
        );
        this.estimatedRowCountSnapshots.set(cacheKey, estimatedRowCount);
      }

      for (const row of columnRows) {
        const tableKey = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
        const columns = columnsByTable.get(tableKey) ?? [];
        columns.push({
          name: String(row.COLUMN_NAME),
          metadata: createOracleColumnMetadata(row),
        });
        columnsByTable.set(tableKey, columns);
      }

      for (const row of indexRows) {
        const tableKey = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
        const indexes = indexAccumulator.get(tableKey) ?? new Map();
        const indexName = String(row.INDEX_NAME);
        const index = indexes.get(indexName) ?? {
          name: indexName,
          columns: [],
          type: String(row.INDEX_TYPE || "INDEX").toUpperCase(),
        };
        if (row.COLUMN_NAME !== null && row.COLUMN_NAME !== undefined) {
          index.columns.push(String(row.COLUMN_NAME));
        }
        indexes.set(indexName, index);
        indexAccumulator.set(tableKey, indexes);
      }

      for (const row of triggerRows) {
        const tableKey = `${row.TRIGGER_SCHEMA}.${row.TABLE_NAME}`;
        const triggers = triggersByTable.get(tableKey) ?? [];
        triggers.push({
          name: String(row.TRIGGER_NAME),
          timing: String(row.TRIGGER_TYPE || ""),
          event: String(row.TRIGGERING_EVENT || ""),
        });
        triggersByTable.set(tableKey, triggers);
      }

      for (const row of partitionRows) {
        const tableKey = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
        const partitions = partitionsByTable.get(tableKey) ?? [];
        partitions.push({
          name: String(row.PARTITION_NAME),
          description:
            row.PARTITION_POSITION === null ||
            row.PARTITION_POSITION === undefined
              ? undefined
              : `Position ${String(row.PARTITION_POSITION)}`,
        });
        partitionsByTable.set(tableKey, partitions);
      }

      return {
        schemas,
        tables: tableRows.map((row) => ({
          schema: String(row.TABLE_SCHEMA),
          name: String(row.TABLE_NAME),
          estimatedRowCount: estimatedRowCountsByTableKey.get(
            `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`,
          ),
          columns:
            columnsByTable.get(`${row.TABLE_SCHEMA}.${row.TABLE_NAME}`) ?? [],
          indexes: Array.from(
            indexAccumulator
              .get(`${row.TABLE_SCHEMA}.${row.TABLE_NAME}`)
              ?.values() ?? [],
          ),
          triggers:
            triggersByTable.get(`${row.TABLE_SCHEMA}.${row.TABLE_NAME}`) ?? [],
          partitions:
            partitionsByTable.get(`${row.TABLE_SCHEMA}.${row.TABLE_NAME}`) ??
            [],
        })),
        views: [],
        procedures: [],
        functions: [],
        types: [],
        sequences: [],
        packages: [],
        objectCounts,
      };
    } finally {
      await oracleConnection.close().catch(() => undefined);
    }
  }

  private async getOracleDatabaseObjectNames(
    connection: DatabaseConnection,
    collection: DatabaseObjectCollectionName,
  ): Promise<string[]> {
    const objectType = ORACLE_OBJECT_TYPE_BY_COLLECTION[collection];
    if (!objectType) {
      return [];
    }

    const oracleConnection = await createOracleConnection(connection);
    try {
      const schemaRows = await executeOracleRows(
        oracleConnection,
        `SELECT USERNAME AS SCHEMA_NAME
         FROM ALL_USERS
         ORDER BY USERNAME`,
      );
      const schemas = schemaRows.map((row) => String(row.SCHEMA_NAME));
      const relevantSchemas = selectRelevantOracleSchemas(schemas, connection);

      if (relevantSchemas.length === 0) {
        return [];
      }

      const schemaFilter = createOracleInPredicate("OWNER", relevantSchemas);
      const objectRows = await executeOracleRows(
        oracleConnection,
        `SELECT OWNER AS OBJECT_SCHEMA,
                OBJECT_NAME AS OBJECT_NAME
         FROM ALL_OBJECTS
         WHERE ${schemaFilter.sql}
           AND OBJECT_TYPE = :${schemaFilter.binds.length + 1}
         ORDER BY OWNER, OBJECT_NAME`,
        [...schemaFilter.binds, objectType],
      );

      return objectRows.map((row) =>
        qualifyDatabaseObject(row.OBJECT_SCHEMA, row.OBJECT_NAME),
      );
    } finally {
      await oracleConnection.close().catch(() => undefined);
    }
  }

  async executeDatabaseStatements(
    connection: DatabaseConnection,
    statements: string[],
  ): Promise<DatabaseExecutionBatchResult> {
    if (connection.type === "Oracle") {
      return this.executeOracleDatabaseStatements(connection, statements);
    }
    if (connection.type === "PostgreSQL") {
      return this.executePostgresDatabaseStatements(connection, statements);
    }

    const mysqlConnection = await createMysqlConnection(
      toMysqlConnectionOptions(connection),
    );
    const results: DatabaseStatementExecutionResult[] = [];
    try {
      for (const statement of statements) {
        const trimmedStatement = statement.trim();
        if (!trimmedStatement) {
          continue;
        }

        const startedAt = performance.now();
        try {
          const [rows, fields] = await mysqlConnection.query<
            RowDataPacket[] | ResultSetHeader
          >(trimmedStatement);
          const durationMs = Math.max(1, performance.now() - startedAt);
          const rowArray = Array.isArray(rows) ? rows : [];
          const normalizedRows = rowArray.map((row) => normalizeMysqlRow(row));
          const resultHeader = isResultSetHeader(rows) ? rows : undefined;
          const result: DatabaseStatementExecutionResult = {
            statement: trimmedStatement,
            columns: Array.isArray(fields)
              ? fields.map((field) => ({
                  key: field.name,
                  label: field.name,
                  type: formatMysqlColumnType(field),
                }))
              : [],
            rows: normalizedRows,
            status: "success",
            durationMs,
            rowsFetched: normalizedRows.length,
            rowsAffected: resultHeader?.affectedRows,
          };
          if (resultHeader?.affectedRows !== undefined) {
            this.updateEstimatedRowCountOverride(
              connection,
              trimmedStatement,
              resultHeader.affectedRows,
            );
          }
          this.recordDatabaseExecution(connection, result);
          results.push(result);
        } catch (error) {
          const result: DatabaseStatementExecutionResult = {
            statement: trimmedStatement,
            columns: [],
            rows: [],
            status: "error",
            errorMessage:
              error instanceof Error ? error.message : "Statement failed.",
            durationMs: Math.max(1, performance.now() - startedAt),
            rowsFetched: 0,
          };
          this.recordDatabaseExecution(connection, result);
          results.push(result);
          break;
        }
      }
    } finally {
      await mysqlConnection.end().catch(() => undefined);
    }

    return { results };
  }

  private async executePostgresDatabaseStatements(
    connection: DatabaseConnection,
    statements: string[],
  ): Promise<DatabaseExecutionBatchResult> {
    const postgresClient = createPostgresClient(connection);
    const results: DatabaseStatementExecutionResult[] = [];
    await postgresClient.connect();
    try {
      for (const statement of statements) {
        const trimmedStatement = statement.trim();
        if (!trimmedStatement) {
          continue;
        }

        const startedAt = performance.now();
        try {
          const executionResult = await postgresClient.query(trimmedStatement);
          const durationMs = Math.max(1, performance.now() - startedAt);
          const normalizedRows = executionResult.rows.map((row) =>
            normalizePostgresRow(row),
          );
          const rowsAffected = isPostgresRowsAffectedCommand(
            executionResult.command,
          )
            ? (executionResult.rowCount ?? undefined)
            : undefined;
          const result: DatabaseStatementExecutionResult = {
            statement: trimmedStatement,
            columns: executionResult.fields.map((field) => ({
              key: field.name,
              label: field.name,
              type: formatPostgresResultColumnType(field),
            })),
            rows: normalizedRows,
            status: "success",
            durationMs,
            rowsFetched: normalizedRows.length,
            rowsAffected,
          };
          if (rowsAffected !== undefined) {
            this.updateEstimatedRowCountOverride(
              connection,
              trimmedStatement,
              rowsAffected,
            );
          }
          this.recordDatabaseExecution(connection, result);
          results.push(result);
        } catch (error) {
          const result: DatabaseStatementExecutionResult = {
            statement: trimmedStatement,
            columns: [],
            rows: [],
            status: "error",
            errorMessage:
              error instanceof Error ? error.message : "Statement failed.",
            durationMs: Math.max(1, performance.now() - startedAt),
            rowsFetched: 0,
          };
          this.recordDatabaseExecution(connection, result);
          results.push(result);
          break;
        }
      }
    } finally {
      await postgresClient.end().catch(() => undefined);
    }

    return { results };
  }

  private async executeOracleDatabaseStatements(
    connection: DatabaseConnection,
    statements: string[],
  ): Promise<DatabaseExecutionBatchResult> {
    const oracleConnection = await createOracleConnection(connection);
    const results: DatabaseStatementExecutionResult[] = [];
    try {
      for (const statement of statements) {
        const trimmedStatement = statement.trim();
        if (!trimmedStatement) {
          continue;
        }

        const startedAt = performance.now();
        try {
          const result =
            (await executeOracleDescribeStatement(
              oracleConnection,
              trimmedStatement,
              startedAt,
            )) ??
            (await executeOracleSqlStatement(
              oracleConnection,
              trimmedStatement,
              startedAt,
            ));
          if (result.rowsAffected !== undefined) {
            this.updateEstimatedRowCountOverride(
              connection,
              trimmedStatement,
              result.rowsAffected,
            );
          }
          this.recordDatabaseExecution(connection, result);
          results.push(result);
        } catch (error) {
          const result: DatabaseStatementExecutionResult = {
            statement: trimmedStatement,
            columns: [],
            rows: [],
            status: "error",
            errorMessage:
              error instanceof Error ? error.message : "Statement failed.",
            durationMs: Math.max(1, performance.now() - startedAt),
            rowsFetched: 0,
          };
          this.recordDatabaseExecution(connection, result);
          results.push(result);
          break;
        }
      }
    } finally {
      await oracleConnection.close().catch(() => undefined);
    }

    return { results };
  }

  private updateEstimatedRowCountOverride(
    connection: DatabaseConnection,
    statement: string,
    affectedRows: number,
  ): void {
    const mutation = parseRowCountMutation(statement);
    if (!mutation) {
      return;
    }

    const tableSchema =
      mutation.schema ??
      connection.database?.trim() ??
      connection.schema?.trim() ??
      "";
    if (!tableSchema || !mutation.table) {
      return;
    }

    const cacheKey = createEstimatedRowCountCacheKey(
      connection,
      tableSchema,
      mutation.table,
    );
    const currentCount =
      this.estimatedRowCountOverrides.get(cacheKey) ??
      this.estimatedRowCountSnapshots.get(cacheKey);

    if (mutation.kind === "truncate") {
      this.estimatedRowCountOverrides.set(cacheKey, 0);
      this.estimatedRowCountSnapshots.set(cacheKey, 0);
      return;
    }

    if (currentCount === null || currentCount === undefined) {
      return;
    }

    const nextCount = Math.max(0, currentCount + affectedRows * mutation.delta);
    this.estimatedRowCountOverrides.set(cacheKey, nextCount);
    this.estimatedRowCountSnapshots.set(cacheKey, nextCount);
  }

  exportDatabaseResult(
    targetPath: string,
    contentBase64: string,
  ): DatabaseExportResult {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, Buffer.from(contentBase64, "base64"));
    return { success: true, path: targetPath };
  }

  getApiTesterSavedRequests(scopeId: string): ApiTesterSavedRequestRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, scope_id, name, method, url, request_json, created_at, updated_at
         FROM api_tester_saved_requests
         WHERE scope_id = ?
         ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC`,
      )
      .all(scopeId) as ApiTesterSavedRequestRow[];

    return rows.map(mapApiTesterSavedRequestRow);
  }

  saveApiTesterSavedRequest(request: {
    id?: string;
    scopeId: string;
    name: string;
    method: string;
    url: string;
    requestJson: string;
  }): ApiTesterSavedRequestRecord {
    const id = request.id?.trim() || randomUUID();
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT created_at FROM api_tester_saved_requests WHERE id = ?")
      .get(id) as { created_at: string } | undefined;
    const saved = {
      id,
      scopeId: request.scopeId.trim() || "global",
      name: request.name.trim() || "API request",
      method: request.method.trim().toUpperCase() || "GET",
      url: request.url.trim(),
      requestJson: request.requestJson,
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT OR REPLACE INTO api_tester_saved_requests (
           id, scope_id, name, method, url, request_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        saved.id,
        saved.scopeId,
        saved.name,
        saved.method,
        saved.url,
        saved.requestJson,
        saved.createdAt,
        saved.updatedAt,
      );

    return saved;
  }

  deleteApiTesterSavedRequest(id: string): void {
    this.db
      .prepare("DELETE FROM api_tester_saved_requests WHERE id = ?")
      .run(id);
  }

  getDashboardOverview(): ProjectDashboardSummary[] {
    return this.getProjects().map((project) => {
      this.pruneBuilds(project.id);
      const settings = this.getSettings(project.id);
      return {
        project,
        frontendEnabled: isProjectFrontendEnabled(settings),
        statuses: this.getStatuses(project.id, settings),
        lastBuild: this.queryBuilds(
          project.id,
          { limit: 1 },
          this.getDashboardClearedAt(project.id),
        ).builds[0],
        serviceUrls: {
          frontendUrl: getProjectFrontendUrl(settings),
          backendUrl: getProjectBackendUrl(settings),
          backendManagementUrl: getProjectBackendManagementUrl(settings),
          backendLabel: getProjectBackendLabel(settings),
          backendServerType:
            settings.backendType === "python"
              ? getPythonServerTypeLabel(settings.python.serverType)
              : "",
          backendHealthPort:
            settings.backendType === "python"
              ? formatPort(extractPortFromUrl(settings.python.appUrl))
              : "",
        },
      };
    });
  }

  getProjectState(projectId: string): ProjectRuntimeState {
    const settings = this.getSettings(projectId);
    this.ensureStatusPolling(projectId);
    this.ensureTail(projectId, settings.appLogFile);

    return {
      settings,
      statuses: this.getStatuses(projectId, settings),
      recentBuilds: this.getRecentBuilds(projectId),
      activityFeed: this.getActivity(projectId),
      gitStatus: this.getGitStatus(projectId),
      pythonDependencies:
        settings.backendType === "python"
          ? this.getPythonDependencies(settings)
          : [],
      logs: {
        frontend: isProjectFrontendEnabled(settings)
          ? this.getLog(projectId, "frontend")
          : [],
        wildfly: this.getLog(projectId, "wildfly"),
        python: this.getLog(projectId, "python"),
        build: this.getLog(projectId, "build"),
        tail: [],
      },
    };
  }

  getProjectEnvFiles(projectId: string): ProjectEnvFilesResult {
    this.ensureProjectExists(projectId);
    const settings = this.getSettings(projectId);
    return {
      groups: getProjectEnvRootDescriptors(settings).map((descriptor) => ({
        ...descriptor,
        files: readProjectEnvFiles(descriptor.rootPath),
      })),
    };
  }

  saveProjectEnvFile(
    projectId: string,
    scope: ProjectEnvScope,
    filePath: string,
    variables: ProjectEnvVariable[],
  ): ProjectEnvFileRecord {
    const group = this.getProjectEnvFiles(projectId).groups.find(
      (item) => item.scope === scope,
    );
    if (!group) {
      throw new Error("Environment scope is not configured.");
    }

    const discoveredFile = group.files.find((file) => file.path === filePath);
    if (!discoveredFile) {
      throw new Error("Environment file is not available for this project.");
    }

    const content = readFileSync(discoveredFile.path, "utf8");
    writeFileSync(
      discoveredFile.path,
      updateEnvContent(content, variables),
      "utf8",
    );
    this.insertActivity(
      projectId,
      "Environment file updated",
      `${group.label}: ${discoveredFile.name}`,
      "info",
      "system",
    );

    return readProjectEnvFile(discoveredFile.path);
  }

  getWarDirectory(projectId: string): string | null {
    const pomXml = this.getSettings(projectId).maven.pomXml.trim();
    if (!pomXml) {
      return null;
    }

    return join(dirname(pomXml), "target");
  }

  async autoStartServices(): Promise<void> {
    const projects = this.getProjects();
    const startedCommands = new Set<string>();

    for (const project of projects) {
      const settings = this.getSettings(project.id);
      for (const service of getProjectServiceNames(settings)) {
        const config = settings.services[service];
        if (!config.autoStart) continue;
        const commandKey = `${service}:${config.workingDirectory}:${config.command}`;

        if (startedCommands.has(commandKey)) {
          continue;
        }

        startedCommands.add(commandKey);
        await this.startService(project.id, service);
      }
    }
  }

  shutdown(): void {
    if (this.logFlushTimer !== null) {
      clearTimeout(this.logFlushTimer);
      this.logFlushTimer = null;
    }
    this.flushLogBuffer();

    for (const [key, processState] of this.serviceProcesses) {
      terminateProcessTree(processState.child);
      this.serviceProcesses.delete(key);
    }

    for (const [projectId, processState] of this.buildProcesses) {
      processState.stopRequested = true;
      terminateProcessTree(processState.child);
      this.buildProcesses.delete(projectId);
    }

    for (const tail of this.tailStates.values()) {
      clearInterval(tail.timer);
    }
    this.tailStates.clear();

    for (const timer of this.statusTimers.values()) {
      clearInterval(timer);
    }
    this.statusTimers.clear();

    this.clearAllDashboardHistory();
  }

  getShutdownEntries(): ShutdownEntry[] {
    const projects = this.getProjects();
    return [...this.serviceProcesses.keys()].map((key) => {
      const colonIdx = key.indexOf(":");
      const projectId = key.slice(0, colonIdx);
      const service = key.slice(colonIdx + 1) as ServiceName;
      const project = projects.find((p) => p.id === projectId);
      return { projectId, service, projectName: project?.name ?? projectId };
    });
  }

  async shutdownWithProgress(
    onServiceStopped: (projectId: string, service: ServiceName) => void,
  ): Promise<void> {
    for (const timer of this.statusTimers.values()) clearInterval(timer);
    this.statusTimers.clear();
    for (const tail of this.tailStates.values()) clearInterval(tail.timer);
    this.tailStates.clear();

    for (const [, processState] of this.buildProcesses) {
      processState.stopRequested = true;
      await terminateProcessTreeAsync(processState.child);
    }
    this.buildProcesses.clear();

    const entries = [...this.serviceProcesses.entries()];
    await Promise.all(
      entries.map(async ([key, processState]) => {
        await terminateProcessTreeAsync(processState.child);
        this.serviceProcesses.delete(key);
        const colonIdx = key.indexOf(":");
        const projectId = key.slice(0, colonIdx);
        const service = key.slice(colonIdx + 1) as ServiceName;
        onServiceStopped(projectId, service);
      }),
    );

    this.clearAllDashboardHistory();
  }

  updateProject(projectId: string, name: string, code: string): ProjectRecord {
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    const errors = validateProjectIdentity(trimmedName, trimmedCode);
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }

    this.db
      .prepare("UPDATE projects SET name = ?, code = ? WHERE id = ?")
      .run(trimmedName, trimmedCode, projectId);
    return {
      id: projectId,
      name: trimmedName,
      code: trimmedCode,
      backendType: this.getProjectBackendType(projectId),
    };
  }

  createProject(
    name: string,
    code: string,
    backendType: BackendType,
    pythonServerType?: PythonServerType,
  ): ProjectRecord {
    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();
    const normalizedBackendType = normalizeBackendType(backendType);
    const errors = validateProjectIdentity(trimmedName, trimmedCode);
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }

    const projectCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM projects WHERE id <> ?")
      .get(STANDALONE_NOTEBOOK_PROJECT_ID) as { count: number };
    if (projectCount.count >= MAX_PROJECTS) {
      throw new Error(
        `Project limit reached. You can create up to ${MAX_PROJECTS} projects.`,
      );
    }

    const id = this.nextProjectId(trimmedName, trimmedCode);
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO projects (id, name, code, backend_type, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, trimmedName, trimmedCode, normalizedBackendType, now);
    this.writeProjectConfig(
      id,
      this.defaultSettings(id, normalizedBackendType, pythonServerType),
    );
    this.insertActivity(
      id,
      "Project created",
      trimmedName,
      "success",
      "system",
    );
    return {
      id,
      name: trimmedName,
      code: trimmedCode,
      backendType: normalizedBackendType,
    };
  }

  getSheets(projectId: string): Sheet[] {
    this.ensureSheetScopeExists(projectId);
    const rows = this.db
      .prepare(
        `SELECT id, project_id, title, content_json, created_at, updated_at,
                auto_save_enabled, pinned, pinned_at
         FROM sheets
         WHERE project_id = ?
         ORDER BY pinned DESC,
                  datetime(COALESCE(pinned_at, '')) DESC,
                  datetime(updated_at) DESC,
                  datetime(created_at) DESC`,
      )
      .all(projectId) as SheetRow[];

    return rows.map((row) => this.mapSheet(row));
  }

  createSheet(projectId: string, title: string): Sheet {
    this.ensureSheetScopeExists(projectId);
    const trimmedTitle = title.trim();
    this.validateSheetTitle(projectId, trimmedTitle);

    const now = new Date().toISOString();
    const sheet: Sheet = {
      id: randomUUID(),
      projectId,
      title: trimmedTitle,
      contentJson: EMPTY_SHEET_CONTENT,
      createdAt: now,
      updatedAt: now,
      autoSaveEnabled: true,
      pinned: false,
      pinnedAt: null,
    };

    this.db
      .prepare(
        `INSERT INTO sheets (
          id, project_id, title, content_json, created_at, updated_at,
          auto_save_enabled, pinned, pinned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sheet.id,
        projectId,
        sheet.title,
        JSON.stringify(sheet.contentJson),
        sheet.createdAt,
        sheet.updatedAt,
        sheet.autoSaveEnabled ? 1 : 0,
        0,
        null,
      );

    return sheet;
  }

  updateSheet(projectId: string, sheetId: string, updates: SheetUpdate): Sheet {
    this.ensureSheetScopeExists(projectId);
    const existing = this.getSheetRow(projectId, sheetId);
    if (!existing) {
      throw new Error("Sheet not found.");
    }

    const nextContentJson =
      updates.contentJson === undefined
        ? existing.content_json
        : JSON.stringify(updates.contentJson);
    const nextAutoSaveEnabled =
      updates.autoSaveEnabled === undefined
        ? existing.auto_save_enabled
        : updates.autoSaveEnabled
          ? 1
          : 0;
    const nextPinned =
      updates.pinned === undefined ? existing.pinned : updates.pinned ? 1 : 0;
    const nextPinnedAt =
      updates.pinnedAt === undefined
        ? nextPinned === 1
          ? existing.pinned_at
          : null
        : updates.pinnedAt;

    if (existing.pinned === 0 && nextPinned === 1) {
      const pinnedCount = this.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM sheets
           WHERE project_id = ? AND pinned = 1 AND id <> ?`,
        )
        .get(projectId, sheetId) as { count: number };
      if (pinnedCount.count >= 3) {
        throw new Error(
          "You can pin up to 3 notes. Unpin one note before pinning another.",
        );
      }
    }

    const updatesContentOrAutosave =
      updates.contentJson !== undefined ||
      updates.autoSaveEnabled !== undefined;
    const updatedAt = updatesContentOrAutosave
      ? new Date().toISOString()
      : existing.updated_at;

    this.db
      .prepare(
        `UPDATE sheets
         SET content_json = ?, auto_save_enabled = ?, pinned = ?, pinned_at = ?, updated_at = ?
         WHERE project_id = ? AND id = ?`,
      )
      .run(
        nextContentJson,
        nextAutoSaveEnabled,
        nextPinned,
        nextPinned === 1 ? nextPinnedAt : null,
        updatedAt,
        projectId,
        sheetId,
      );

    const updated = this.getSheetRow(projectId, sheetId);
    if (!updated) {
      throw new Error("Sheet could not be read after saving.");
    }
    return this.mapSheet(updated);
  }

  deleteSheet(projectId: string, sheetId: string): void {
    this.ensureSheetScopeExists(projectId);
    const result = this.db
      .prepare("DELETE FROM sheets WHERE project_id = ? AND id = ?")
      .run(projectId, sheetId);

    if (result.changes === 0) {
      throw new Error("Sheet not found.");
    }
  }

  validateProjectSettings(
    projectId: string,
    name: string,
    code: string,
    settings: ProjectSettingsRecord,
  ): string[] {
    const persistedBackendType = this.getProjectBackendType(projectId);
    const normalizedSettings = normalizeProjectSettings(
      settings,
      this.defaultSettings(projectId, persistedBackendType),
    );
    const errors = validateProjectIdentity(name.trim(), code.trim());
    if (normalizeBackendType(settings.backendType) !== persistedBackendType) {
      errors.push("Backend type cannot be changed after project creation.");
    }
    const appLogFile = normalizedSettings.appLogFile.trim();
    const frontend = normalizedSettings.services.frontend;
    const backendService = getProjectBackendServiceName(normalizedSettings);
    const backend = normalizedSettings.services[backendService];
    const frontendDirectory = frontend.workingDirectory.trim();
    const backendDirectory = backend.workingDirectory.trim();
    const gitProjectDirectory = normalizedSettings.gitProjectDirectory.trim();

    if (appLogFile && !isExistingFile(appLogFile)) {
      errors.push(`Application log file does not exist: ${appLogFile}`);
    }

    if (isProjectFrontendEnabled(normalizedSettings)) {
      if (!isExistingDirectory(frontendDirectory)) {
        errors.push(`Frontend directory does not exist: ${frontendDirectory}`);
      }
      if (!frontend.command.trim()) {
        errors.push("Frontend command is required");
      }
      if (!frontend.healthUrl.trim()) {
        errors.push("Frontend health URL is required");
      }
      if (!frontend.appUrl?.trim()) {
        errors.push("Frontend app URL is required");
      }
    }

    if (backendService === "python") {
      const python = normalizedSettings.python;
      if (!python.serverType) {
        errors.push("Python server type is required");
      }
      if (!python.directory.trim()) {
        errors.push("Python directory is required");
      } else if (!isExistingDirectory(python.directory.trim())) {
        errors.push(
          `Python directory does not exist: ${python.directory.trim()}`,
        );
      }
      if (!python.startCommand.trim()) {
        errors.push("Python start command is required");
      }
      if (!python.appUrl.trim()) {
        errors.push("Python app URL is required");
      }
    } else if (backendDirectory) {
      if (!isExistingDirectory(backendDirectory)) {
        errors.push(
          `${getProjectBackendLabel(normalizedSettings)} directory does not exist: ${backendDirectory}`,
        );
      }
      if (!backend.command.trim()) {
        errors.push(
          `${getProjectBackendLabel(normalizedSettings)} start command is required`,
        );
      }
      if (!backend.healthUrl.trim()) {
        errors.push(
          `${getProjectBackendLabel(normalizedSettings)} health URL is required`,
        );
      }
      errors.push(...validateMavenConfig(normalizedSettings.maven));
    }

    if (!gitProjectDirectory) {
      errors.push("Git project directory is required");
    } else if (!isExistingDirectory(gitProjectDirectory)) {
      errors.push(
        `Git project directory does not exist: ${gitProjectDirectory}`,
      );
    }

    return errors;
  }

  async deleteProject(projectId: string): Promise<void> {
    const settings = this.getSettings(projectId);
    // stop any running services
    for (const service of getProjectServiceNames(settings)) {
      const key = `${projectId}:${service}`;
      const proc = this.serviceProcesses.get(key);
      if (proc) {
        await terminateProcessTreeAsync(proc.child);
        this.serviceProcesses.delete(key);
      }
      const timer = this.statusTimers.get(key);
      if (timer) {
        clearInterval(timer);
        this.statusTimers.delete(key);
      }
    }
    const build = this.buildProcesses.get(projectId);
    if (build) {
      build.stopRequested = true;
      await terminateProcessTreeAsync(build.child);
      this.buildProcesses.delete(projectId);
    }
    const tail = this.tailStates.get(projectId);
    if (tail) {
      clearInterval(tail.timer);
      this.tailStates.delete(projectId);
    }
    // remove from DB
    this.db
      .prepare("DELETE FROM activity_events WHERE project_id = ?")
      .run(projectId);
    this.db
      .prepare("DELETE FROM build_runs WHERE project_id = ?")
      .run(projectId);
    this.db
      .prepare("DELETE FROM service_status WHERE project_id = ?")
      .run(projectId);
    this.db
      .prepare("DELETE FROM app_meta WHERE key = ?")
      .run(this.dashboardClearedMetaKey(projectId));
    this.db.prepare("DELETE FROM sheets WHERE project_id = ?").run(projectId);
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    // remove config file
    const configDir = join(this.dataRoot, "projects", projectId);
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true, force: true });
    }
    // clear in-memory logs
    for (const channel of [
      "frontend",
      "wildfly",
      "python",
      "build",
    ] as LogChannel[]) {
      const key = `${projectId}:${channel}`;
      this.logs.delete(key);
      this.logSeqMap.delete(key);
    }
  }

  saveProjectSettings(
    projectId: string,
    settings: ProjectSettingsRecord,
  ): ProjectSettingsRecord {
    const previousSettings = this.getSettings(projectId);
    if (
      normalizeBackendType(settings.backendType) !==
      previousSettings.backendType
    ) {
      throw new Error("Backend type cannot be changed after project creation.");
    }
    const normalizedSettings = normalizeProjectSettings(
      settings,
      this.defaultSettings(projectId, previousSettings.backendType),
    );
    const activityEntries = settingsActivityEntries(
      previousSettings,
      normalizedSettings,
    );
    this.writeProjectConfig(projectId, normalizedSettings);
    this.ensureTail(projectId, normalizedSettings.appLogFile, true);
    this.send({ type: "settings", projectId, settings: normalizedSettings });
    for (const entry of activityEntries) {
      this.insertActivity(
        projectId,
        entry.title,
        entry.meta,
        entry.tone,
        "system",
      );
    }
    return normalizedSettings;
  }

  async serviceAction(
    projectId: string,
    service: ServiceName,
    action: ServiceAction,
  ): Promise<ServiceStatusRecord> {
    const settings = this.getSettings(projectId);
    if (service === "frontend" && !isProjectFrontendEnabled(settings)) {
      return this.statusRecord(
        service,
        "unknown",
        "Frontend is not configured",
        "",
      );
    }

    if (action === "restart") {
      this.clearLog(projectId, service);
      await this.stopService(projectId, service);
      return this.startService(projectId, service);
    }

    if (action === "stop") {
      return this.stopService(projectId, service);
    }

    return this.startService(projectId, service);
  }

  async runBuild(
    projectId: string,
    profileId: string,
  ): Promise<RecentBuildRecord> {
    const activeBuild = this.buildProcesses.get(projectId);
    if (activeBuild && activeBuild.child.exitCode === null) {
      const existingBuild = this.getBuildByRowId(projectId, activeBuild.rowId);
      if (existingBuild) {
        return existingBuild;
      }
      throw new Error("A build is already running for this project.");
    }

    const settings = this.getSettings(projectId);
    const profile = settings.buildProfiles.find(
      (item) => item.id === profileId,
    );
    if (!profile) {
      throw new Error(`Unknown build profile: ${profileId}`);
    }

    const startedAt = new Date();
    const git = this.getGitStatus(projectId);
    const commitCleanliness = buildCleanlinessFromGitStatus(git);
    const environment = environmentFromProfile(profile.profileName);
    const commandText = composeMavenCommand(settings, profile);

    this.clearLog(projectId, "build");
    this.appendLog(projectId, "build", stamp(`$ ${commandText}`));
    const insert = this.db
      .prepare(
        `INSERT INTO build_runs (
          project_id, profile_name, button_name, branch, commit_hash, commit_cleanliness,
          environment, triggered_by, status, outcome_type, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        projectId,
        profile.profileName,
        profile.buttonName,
        git.branch,
        git.commit,
        commitCleanliness,
        environment,
        userInfo().username || "local-user",
        "running",
        profile.outcomeType,
        startedAt.toISOString(),
      );
    const rowId = Number(insert.lastInsertRowid);
    this.insertActivity(
      projectId,
      `${profile.buttonName} build started`,
      `${git.branch} @ ${git.commit}/${commitCleanliness}`,
      "accent",
      "build",
    );
    this.pruneBuilds(projectId);
    this.sendBuilds(projectId);

    const result = await this.spawnBuild(projectId, settings, profile, rowId);
    const completedAt = new Date();
    const durationSeconds = Math.max(
      0,
      Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
    );

    this.db
      .prepare(
        `UPDATE build_runs
         SET status = ?, completed_at = ?, duration_seconds = ?
         WHERE id = ?`,
      )
      .run(result, completedAt.toISOString(), durationSeconds, rowId);

    const successTitle =
      profile.outcomeType === "build-and-deploy"
        ? `${profile.buttonName} build deployed`
        : `${profile.buttonName} build completed`;
    const title =
      result === "success"
        ? successTitle
        : result === "stopped"
          ? `${profile.buttonName} build stopped`
          : `${profile.buttonName} build failed`;
    const statusLabel =
      result === "success"
        ? "Success"
        : result === "stopped"
          ? "Stopped"
          : "Failed";
    this.insertActivity(
      projectId,
      title,
      `Build #${rowId} - ${statusLabel}`,
      result === "success"
        ? "success"
        : result === "stopped"
          ? "neutral"
          : "failed",
      "build",
    );
    this.pruneBuilds(projectId);
    this.sendBuilds(projectId);
    void this.refreshStatus(projectId);

    const build = this.getBuildByRowId(projectId, rowId);
    if (!build) {
      throw new Error(
        "Build completed but could not be read from the database.",
      );
    }
    return build;
  }

  async stopBuild(projectId: string): Promise<RecentBuildRecord | null> {
    const activeBuild = this.buildProcesses.get(projectId);
    if (!activeBuild || activeBuild.child.exitCode !== null) {
      return this.getRecentBuilds(projectId)[0] ?? null;
    }

    activeBuild.stopRequested = true;
    this.appendLog(projectId, "build", stamp("Stop build requested"));
    this.flushLogBuffer();
    terminateProcessTree(activeBuild.child);
    this.sendBuilds(projectId);
    return this.getBuildByRowId(projectId, activeBuild.rowId) ?? null;
  }

  getBuilds(
    projectId: string,
    options: BuildQueryOptions = {},
  ): BuildQueryResult {
    this.pruneBuilds(projectId);
    return this.queryBuilds(projectId, options);
  }

  getApiFetches(
    projectId: string,
    options: ApiFetchQueryOptions = {},
  ): ApiFetchQueryResult {
    const all = this.apiFetches.get(projectId) ?? [];
    const search = (options.search ?? "").trim().toLowerCase();
    const statusBucket = options.status ?? "All";

    const filtered = all.filter((record) => {
      if (search) {
        const haystack =
          `${record.method} ${record.path} ${record.status ?? ""} ${record.source}`.toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }
      if (statusBucket !== "All") {
        const status = record.status ?? 0;
        const bucketDigit = Number.parseInt(statusBucket.charAt(0), 10);
        if (Math.floor(status / 100) !== bucketDigit) {
          return false;
        }
      }
      return true;
    });

    const sortBy = options.sortBy ?? "capturedAt";
    const direction = options.sortDirection ?? "desc";
    const dirMultiplier = direction === "asc" ? 1 : -1;

    filtered.sort((a, b) => {
      const cmp = compareApiFetchValues(a, b, sortBy);
      return cmp * dirMultiplier;
    });

    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.max(1, options.limit ?? 50);
    const page = filtered.slice(offset, offset + limit);
    return {
      fetches: page,
      total: filtered.length,
      hasMore: offset + page.length < filtered.length,
    };
  }

  private captureApiFetchFromLine(
    projectId: string,
    channel: LogChannel,
    line: string,
  ): void {
    if (channel !== "python") {
      return;
    }
    const record = parseAccessLogLine(line);
    if (!record) {
      return;
    }
    const id = `apifetch-${++this.apiFetchSeq}`;
    const captured: ApiFetchRecord = {
      id,
      capturedAt: record.capturedAt ?? new Date().toISOString(),
      method: record.method,
      path: record.path,
      status: record.status,
      durationMs: record.durationMs,
      source: record.source,
    };
    const list = this.apiFetches.get(projectId) ?? [];
    list.push(captured);
    if (list.length > API_FETCH_LIMIT) {
      list.splice(0, list.length - API_FETCH_LIMIT);
    }
    this.apiFetches.set(projectId, list);

    const pending = this.apiFetchEventBuffer.get(projectId) ?? [];
    pending.push(captured);
    this.apiFetchEventBuffer.set(projectId, pending);
    if (this.apiFetchEventTimer === null) {
      this.apiFetchEventTimer = setTimeout(
        () => this.flushApiFetchEvents(),
        200,
      );
    }
  }

  private flushApiFetchEvents(): void {
    this.apiFetchEventTimer = null;
    for (const [projectId, fetches] of this.apiFetchEventBuffer) {
      if (fetches.length === 0) continue;
      this.send({ type: "api-fetch", projectId, fetches: [...fetches] });
    }
    this.apiFetchEventBuffer.clear();
  }

  async refreshStatus(projectId: string): Promise<ServiceStatusRecord[]> {
    const settings = this.getSettings(projectId);
    const statuses = await Promise.all(
      getProjectServiceNames(settings).map(async (service) => {
        const config = settings.services[service];
        const statusUrl = serviceStatusUrl(config, service);
        const processKey = serviceProcessKey(projectId, service);
        const runningProcess = this.serviceProcesses.get(processKey);
        const explicitlyStopped =
          this.explicitlyStoppedServices.has(processKey);
        const previousStatus = this.getStoredStatus(projectId, service);

        if (explicitlyStopped) {
          const status = this.statusRecord(
            service,
            "stopped",
            "Stopped",
            statusUrl,
          );
          this.upsertStatus(projectId, status);
          return status;
        }

        if (runningProcess?.stopRequested) {
          const status = this.statusRecord(
            service,
            "stopping",
            "Stopping",
            statusUrl,
            runningProcess.startedAt,
          );
          this.upsertStatus(projectId, status);
          return status;
        }

        if (!runningProcess && isRecentStartFailureStatus(previousStatus)) {
          const status = this.statusRecord(
            service,
            "failed",
            previousStatus?.message ?? "Service failed to start",
            statusUrl,
            normalizeOptionalDate(previousStatus?.startedAt),
          );
          this.upsertStatus(projectId, status);
          return status;
        }

        const startedAt =
          runningProcess?.startedAt ||
          normalizeOptionalDate(previousStatus?.startedAt);
        const startupLogActive = runningProcess
          ? hasRecentServiceStartupSignal(runningProcess)
          : false;
        const stillStarting =
          Boolean(runningProcess) &&
          (startupLogActive ||
            (previousStatus?.state === "starting" &&
              Boolean(startedAt) &&
              Date.now() - new Date(startedAt as string).getTime() <
                SERVICE_STARTING_GRACE_MS));

        if (service === "python") {
          const port = extractPortFromUrl(config.appUrl);
          if (!port) {
            const status = this.statusRecord(
              service,
              stillStarting
                ? "starting"
                : runningProcess
                  ? "failed"
                  : "stopped",
              "No health check port detected in App URL",
              statusUrl,
              stillStarting ? startedAt : undefined,
            );
            this.upsertStatus(projectId, status);
            return status;
          }

          const portCheck = await checkPortListening(port);
          const status: ServiceStatusRecord = {
            service,
            state: portCheck.listening
              ? "running"
              : stillStarting
                ? "starting"
                : runningProcess
                  ? "failed"
                  : "stopped",
            message: portCheck.message,
            url: statusUrl,
            checkedAt: new Date().toISOString(),
            startedAt: portCheck.listening
              ? startedAt || new Date().toISOString()
              : stillStarting
                ? startedAt
                : undefined,
          };
          this.upsertStatus(projectId, status);
          return status;
        }

        if (!config.healthUrl) {
          const status =
            runningProcess && hasRecentServiceStartupSignal(runningProcess)
              ? this.statusRecord(
                  service,
                  "starting",
                  "Startup output detected",
                  statusUrl,
                  runningProcess.startedAt,
                )
              : this.statusFromProcess(
                  projectId,
                  service,
                  runningProcess,
                  "No health URL configured",
                );
          this.upsertStatus(projectId, status);
          return status;
        }

        const health = await checkUrl(config.healthUrl);
        const reachable =
          health.ok || (service === "wildfly" && health.reachable);
        const wildflyReadyByLog =
          service === "wildfly" && Boolean(runningProcess?.readyLogAt);
        const canReportRunning =
          service === "wildfly"
            ? wildflyReadyByLog || (!runningProcess && reachable)
            : reachable;
        const status: ServiceStatusRecord = {
          service,
          state: canReportRunning
            ? "running"
            : stillStarting
              ? "starting"
              : runningProcess
                ? "failed"
                : "stopped",
          message:
            service === "wildfly" && reachable && !canReportRunning
              ? `Waiting for "${WILDFLY_READY_LOG_FRAGMENT}"`
              : health.message,
          url: statusUrl,
          checkedAt: new Date().toISOString(),
          startedAt: canReportRunning
            ? startedAt || new Date().toISOString()
            : stillStarting
              ? startedAt
              : undefined,
        };
        this.upsertStatus(projectId, status);
        return status;
      }),
    );

    return statuses;
  }

  getGitStatus(projectId: string): GitStatusRecord {
    const settings = this.getSettings(projectId);
    return this.readGitStatus(settings.gitProjectDirectory);
  }

  getLogFilePath(projectId: string, channel: LogChannel): string {
    if (
      channel === "frontend" &&
      !isProjectFrontendEnabled(this.getSettings(projectId))
    ) {
      throw new Error("Frontend is not configured for this project.");
    }

    if (channel === "tail") {
      const appLogFile = this.getSettings(projectId).appLogFile.trim();
      if (appLogFile) {
        return appLogFile;
      }
    }
    const filePath = this.projectLogPath(projectId, channel);
    mkdirSync(dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
      writeFileSync(filePath, "", "utf8");
    }
    return filePath;
  }

  async runGitCommand(
    projectId: string,
    args: string,
  ): Promise<GitStatusRecord> {
    const settings = this.getSettings(projectId);
    const repository = settings.gitProjectDirectory;
    const trimmed = args.trim().replace(/^git\s+/, "");
    if (!trimmed) {
      return this.getGitStatus(projectId);
    }

    if (!existsSync(repository)) {
      return {
        repository,
        branch: "unavailable",
        commit: "unavailable",
        status: `Git Project Directory does not exist: ${repository}`,
        lines: [stamp(`Git Project Directory does not exist: ${repository}`)],
      };
    }

    const lines = await spawnCollect("git", splitCommand(trimmed), repository);
    const status = this.readGitStatus(repository);
    return { ...status, lines };
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        backend_type TEXT NOT NULL DEFAULT 'wildfly',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_settings (
        project_id TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS service_status (
        project_id TEXT NOT NULL,
        service TEXT NOT NULL,
        state TEXT NOT NULL,
        message TEXT NOT NULL,
        url TEXT,
        checked_at TEXT NOT NULL,
        started_at TEXT,
        PRIMARY KEY(project_id, service)
      );

      CREATE TABLE IF NOT EXISTS build_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        button_name TEXT NOT NULL,
        branch TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        commit_cleanliness TEXT NOT NULL DEFAULT 'unknown',
        environment TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        status TEXT NOT NULL,
        outcome_type TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_seconds INTEGER
      );

      CREATE TABLE IF NOT EXISTS activity_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        meta TEXT NOT NULL,
        tone TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sheets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        auto_save_enabled INTEGER NOT NULL DEFAULT 1,
        pinned INTEGER NOT NULL DEFAULT 0,
        pinned_at TEXT,
        FOREIGN KEY(project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS database_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        connection_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS database_worksheets (
        connection_id TEXT NOT NULL,
        sheet_id TEXT NOT NULL,
        sheet_name TEXT NOT NULL,
        sql_content TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        is_open INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(connection_id, sheet_id),
        FOREIGN KEY(connection_id) REFERENCES database_connections(id)
      );

      CREATE TABLE IF NOT EXISTS database_worksheet_state (
        connection_id TEXT PRIMARY KEY,
        active_sheet_id TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(connection_id) REFERENCES database_connections(id)
      );

      CREATE TABLE IF NOT EXISTS database_execution_history (
        id TEXT PRIMARY KEY,
        executed_at TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        connection_name TEXT NOT NULL,
        database_user TEXT NOT NULL,
        sql_statement TEXT NOT NULL,
        duration_ms REAL NOT NULL,
        status TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        rows_affected INTEGER,
        error_message TEXT,
        execution_message TEXT,
        FOREIGN KEY(connection_id) REFERENCES database_connections(id)
      );

      CREATE TABLE IF NOT EXISTS api_tester_saved_requests (
        id TEXT PRIMARY KEY,
        scope_id TEXT NOT NULL,
        name TEXT NOT NULL,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        request_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS sheets_project_title_unique
        ON sheets(project_id, title COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS sheets_project_updated_idx
        ON sheets(project_id, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS database_connections_name_unique
        ON database_connections(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS database_worksheets_connection_saved_idx
        ON database_worksheets(connection_id, saved_at DESC);
      CREATE INDEX IF NOT EXISTS database_execution_connection_time_idx
        ON database_execution_history(connection_id, executed_at DESC);
      CREATE INDEX IF NOT EXISTS api_tester_saved_scope_updated_idx
        ON api_tester_saved_requests(scope_id, updated_at DESC);
    `);

    this.patchExistingActivityDatesToYesterday();
    this.ensureProjectBackendTypeColumn();
    this.ensureBuildRunCleanlinessColumn();
    this.ensureDatabaseExecutionMessageColumn();
    this.pruneDatabaseExecutionHistory();
    this.ensureSheetPinColumns();
    this.ensureDatabaseWorksheetSortOrderColumn();
  }

  private ensureProjectBackendTypeColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(projects)")
      .all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "backend_type")) {
      this.db.exec(
        "ALTER TABLE projects ADD COLUMN backend_type TEXT NOT NULL DEFAULT 'wildfly'",
      );
    }
  }

  private ensureDatabaseWorksheetSortOrderColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(database_worksheets)")
      .all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "sort_order")) {
      this.db.exec(
        "ALTER TABLE database_worksheets ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
      );
    }
  }

  private ensureSheetPinColumns(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(sheets)")
      .all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "pinned")) {
      this.db.exec(
        "ALTER TABLE sheets ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!columns.some((column) => column.name === "pinned_at")) {
      this.db.exec("ALTER TABLE sheets ADD COLUMN pinned_at TEXT");
    }
  }

  private ensureBuildRunCleanlinessColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(build_runs)")
      .all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "commit_cleanliness")) {
      this.db.exec(
        "ALTER TABLE build_runs ADD COLUMN commit_cleanliness TEXT NOT NULL DEFAULT 'unknown'",
      );
    }
  }

  private markInterruptedBuilds(): void {
    this.db
      .prepare(
        `UPDATE build_runs
         SET status = 'stopped',
             completed_at = ?,
             duration_seconds = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400 AS INTEGER))
         WHERE status = 'running'`,
      )
      .run(new Date().toISOString(), new Date().toISOString());
  }

  private patchExistingActivityDatesToYesterday(): void {
    const patchKey = "activity-existing-yesterday-v1";
    const applied = this.db
      .prepare("SELECT value FROM app_meta WHERE key = ?")
      .get(patchKey) as { value: string } | undefined;

    if (applied) {
      return;
    }

    this.db
      .prepare(
        `UPDATE activity_events
         SET created_at = datetime(created_at, '-1 day')
         WHERE created_at >= datetime('now', '-1 day')`,
      )
      .run();

    this.db
      .prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)")
      .run(patchKey, new Date().toISOString());
  }

  private getProjects(): ProjectRecord[] {
    return this.db
      .prepare(
        `SELECT id, name, code, backend_type AS backendType
         FROM projects
         WHERE id <> ?
         ORDER BY created_at ASC`,
      )
      .all(STANDALONE_NOTEBOOK_PROJECT_ID) as ProjectRecord[];
  }

  private ensureStandaloneNotebookProject(): void {
    const exists =
      this.db
        .prepare("SELECT 1 FROM projects WHERE id = ?")
        .get(STANDALONE_NOTEBOOK_PROJECT_ID) !== undefined;
    if (exists) {
      return;
    }

    this.db
      .prepare(
        "INSERT INTO projects (id, name, code, backend_type, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        STANDALONE_NOTEBOOK_PROJECT_ID,
        "Standalone Notebook",
        "NOTEBOOK",
        "wildfly",
        new Date().toISOString(),
      );
  }

  private ensureProjectExists(projectId: string): void {
    const exists =
      this.db.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId) !==
      undefined;
    if (!exists) {
      throw new Error(`Unknown project: ${projectId}`);
    }
  }

  private ensureSheetScopeExists(projectId: string): void {
    if (projectId === STANDALONE_NOTEBOOK_PROJECT_ID) {
      return;
    }

    this.ensureProjectExists(projectId);
  }

  private getProjectBackendType(projectId: string): BackendType {
    const row = this.db
      .prepare("SELECT backend_type AS backendType FROM projects WHERE id = ?")
      .get(projectId) as { backendType: unknown } | undefined;
    return normalizeBackendType(row?.backendType);
  }

  private validateSheetTitle(projectId: string, title: string): void {
    if (!title) {
      throw new Error("Sheet title is required.");
    }

    const duplicate = this.db
      .prepare(
        `SELECT 1 FROM sheets
         WHERE project_id = ? AND title = ? COLLATE NOCASE`,
      )
      .get(projectId, title);

    if (duplicate !== undefined) {
      throw new Error("A Sheet with this title already exists.");
    }
  }

  private getSheetRow(
    projectId: string,
    sheetId: string,
  ): SheetRow | undefined {
    return this.db
      .prepare(
        `SELECT id, project_id, title, content_json, created_at, updated_at,
          auto_save_enabled, pinned, pinned_at
         FROM sheets
         WHERE project_id = ? AND id = ?`,
      )
      .get(projectId, sheetId) as SheetRow | undefined;
  }

  private mapSheet(row: SheetRow): Sheet {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      contentJson: parseSheetContent(row.content_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      autoSaveEnabled: row.auto_save_enabled === 1,
      pinned: row.pinned === 1,
      pinnedAt: row.pinned_at,
    };
  }

  private mapDatabaseConnection(
    row: DatabaseConnectionRow,
  ): DatabaseConnection {
    try {
      return normalizeDatabaseConnection(
        JSON.parse(row.connection_json) as DatabaseConnection,
      );
    } catch (error) {
      console.error(`[database:${row.id}] Failed to read connection`, error);
      return normalizeDatabaseConnection({
        id: row.id,
        name: row.name,
        type: "MySQL",
        status: "error",
        host: "",
        port: "3306",
        user: "",
        schema: "",
        latency: "Not tested",
        uptime: "Not connected",
        activeSessions: 0,
      });
    }
  }

  private ensureDatabaseConnectionExists(connectionId: string): void {
    const exists =
      this.db
        .prepare("SELECT 1 FROM database_connections WHERE id = ?")
        .get(connectionId) !== undefined;
    if (!exists) {
      throw new Error(`Unknown database connection: ${connectionId}`);
    }
  }

  private recordDatabaseExecution(
    connection: DatabaseConnection,
    result: DatabaseStatementExecutionResult,
  ): void {
    const id = randomUUID();
    const executedAt = new Date().toISOString();
    const rowsAffected = result.rowsAffected ?? null;
    const rowCount =
      result.rowsFetched > 0 ? result.rowsFetched : (result.rowsAffected ?? 0);
    const executionMessage = createDatabaseExecutionMessage(result);

    this.db
      .prepare(
        `INSERT INTO database_execution_history (
           id, executed_at, connection_id, connection_name, database_user,
           sql_statement, duration_ms, status, row_count, rows_affected,
           error_message, execution_message
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        executedAt,
        connection.id,
        connection.name,
        connection.user,
        result.statement,
        result.durationMs,
        result.status,
        rowCount,
        rowsAffected,
        result.errorMessage ?? null,
        executionMessage,
      );
    result.executionRecordId = id;
    result.executedAt = executedAt;
    result.executionMessage = executionMessage;
    this.pruneDatabaseExecutionHistory(connection.id);
  }

  private pruneDatabaseExecutionHistory(connectionId?: string): void {
    if (connectionId) {
      this.db
        .prepare(
          `DELETE FROM database_execution_history
           WHERE connection_id = ?
             AND rowid NOT IN (
               SELECT rowid
               FROM database_execution_history
               WHERE connection_id = ?
               ORDER BY datetime(executed_at) DESC, rowid DESC
               LIMIT ${DATABASE_EXECUTION_HISTORY_LIMIT}
             )`,
        )
        .run(connectionId, connectionId);
      return;
    }

    const rows = this.db
      .prepare("SELECT DISTINCT connection_id FROM database_execution_history")
      .all() as Array<{ connection_id: string }>;
    for (const row of rows) {
      this.pruneDatabaseExecutionHistory(row.connection_id);
    }
  }

  private ensureDatabaseExecutionMessageColumn(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(database_execution_history)")
      .all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "execution_message")) {
      this.db.exec(
        "ALTER TABLE database_execution_history ADD COLUMN execution_message TEXT",
      );
    }
  }

  private nextProjectId(name: string, code: string): string {
    const preferred = slugifyProjectId(code) || slugifyProjectId(name);
    const base = preferred || `project-${Date.now()}`;
    let id = base;
    let suffix = 2;
    while (
      this.db.prepare("SELECT 1 FROM projects WHERE id = ?").get(id) !==
      undefined
    ) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    return id;
  }

  private defaultSettings(
    projectId: string,
    backendType = this.getProjectBackendType(projectId),
    pythonServerType: PythonServerType = "custom",
  ): ProjectSettingsRecord {
    const normalizedBackendType = normalizeBackendType(backendType);
    const normalizedPythonServerType =
      normalizePythonServerType(pythonServerType);
    const pythonDefaults =
      PYTHON_WEB_SERVER_DEFAULTS[normalizedPythonServerType];
    return {
      backendType: normalizedBackendType,
      appLogFile: "",
      gitProjectDirectory: "",
      defaultBranch: "",
      remote: "",
      frontend: {
        enabled: false,
        path: "",
        installCommand: "",
        devCommand: "",
        buildCommand: "",
      },
      python: {
        enabled: true,
        serverType: normalizedPythonServerType,
        directory: "",
        venvPath: "",
        installCommand: pythonDefaults.installCommand,
        startCommand: pythonDefaults.startCommand,
        appUrl: pythonDefaults.appUrl,
        healthCheckUrl: pythonDefaults.healthCheckUrl,
        autoStart: false,
        buildCommand: "",
      },
      services: {
        frontend: {
          enabled: false,
          workingDirectory: "",
          command: "",
          healthUrl: "",
          appUrl: "",
        },
        wildfly: {
          enabled: true,
          workingDirectory: "",
          command: "",
          healthUrl: "",
          appUrl: "",
          managementUrl: "",
        },
        python: {
          enabled: true,
          workingDirectory: "",
          command: pythonDefaults.startCommand,
          healthUrl: pythonDefaults.healthCheckUrl ?? "",
          appUrl: pythonDefaults.appUrl,
        },
      },
      maven: {
        executable: "",
        settingsXml: "",
        pomXml: "",
        skipTests: false,
      },
      buildProfiles: [],
    };
  }

  private getSettings(projectId: string): ProjectSettingsRecord {
    const defaults = this.defaultSettings(projectId);
    const configPath = this.projectConfigPath(projectId);
    if (existsSync(configPath)) {
      try {
        return normalizeProjectSettings(
          JSON.parse(readFileSync(configPath, "utf8")),
          defaults,
        );
      } catch (error) {
        console.error(
          `[settings:${projectId}] Failed to read app.config`,
          error,
        );
      }
    }

    this.writeProjectConfig(projectId, defaults);
    return defaults;
  }

  private getPythonDependencies(
    settings: ProjectSettingsRecord,
  ): PythonDependencyRecord[] {
    return readPythonDependencies(settings.python);
  }

  private writeProjectConfig(
    projectId: string,
    settings: ProjectSettingsRecord,
  ): void {
    const configPath = this.projectConfigPath(projectId);
    mkdirSync(dirname(configPath), { recursive: true });
    const defaults = this.defaultSettings(projectId);
    const normalizedSettings = normalizeProjectSettings(settings, defaults);
    writeFileSync(
      configPath,
      `${JSON.stringify(normalizedSettings, null, 2)}\n`,
      "utf8",
    );
  }

  private projectConfigPath(projectId: string): string {
    return join(this.dataRoot, "projects", projectId, "app.config");
  }

  private async startService(
    projectId: string,
    service: ServiceName,
  ): Promise<ServiceStatusRecord> {
    const settings = this.getSettings(projectId);
    const config = settings.services[service];
    const statusUrl = serviceStatusUrl(config, service);
    if (service === "frontend" && !isProjectFrontendEnabled(settings)) {
      return this.statusRecord(
        service,
        "unknown",
        "Frontend is not configured",
        "",
      );
    }
    const key = serviceProcessKey(projectId, service);
    const existing = this.serviceProcesses.get(key);
    if (existing && existing.child.exitCode === null) {
      const status = this.statusFromProcess(
        projectId,
        service,
        existing,
        "Already running",
      );
      this.upsertStatus(projectId, status);
      return status;
    }

    const runningServiceCount = [...this.serviceProcesses.values()].filter(
      (processState) => processState.child.exitCode === null,
    ).length;
    if (runningServiceCount >= MAX_RUNNING_SERVICES) {
      const status = this.statusRecord(
        service,
        "failed",
        RUNNING_SERVER_LIMIT_MESSAGE,
        statusUrl,
      );
      this.upsertStatus(projectId, status);
      this.appendLog(projectId, service, stamp(RUNNING_SERVER_LIMIT_MESSAGE));
      return status;
    }

    if (!config.workingDirectory || !existsSync(config.workingDirectory)) {
      const status = this.statusRecord(
        service,
        "failed",
        `Working directory does not exist: ${config.workingDirectory}`,
        statusUrl,
      );
      this.upsertStatus(projectId, status);
      return status;
    }

    if (!config.command.trim()) {
      const status = this.statusRecord(
        service,
        "failed",
        "No command configured",
        statusUrl,
      );
      this.upsertStatus(projectId, status);
      return status;
    }

    this.clearLog(projectId, service);
    this.appendLog(projectId, service, stamp(`$ ${config.command}`));
    const spawnEnv = createServiceEnvironment(service);
    const child = spawn(config.command, {
      cwd: config.workingDirectory,
      shell: true,
      windowsHide: true,
      env: spawnEnv,
    }) as ChildProcessWithoutNullStreams;
    const startedAt = new Date().toISOString();
    this.explicitlyStoppedServices.delete(key);
    const serviceProcess: ServiceProcess = { child, startedAt };
    this.serviceProcesses.set(key, serviceProcess);

    child.stdout.on("data", (chunk: Buffer) =>
      this.appendChunk(projectId, service, chunk),
    );
    child.stderr.on("data", (chunk: Buffer) =>
      this.appendChunk(projectId, service, chunk),
    );
    child.on("exit", (code) => {
      if (this.serviceProcesses.get(key) === serviceProcess) {
        this.serviceProcesses.delete(key);
      }
      this.appendLog(
        projectId,
        service,
        stamp(`${service} exited with code ${code ?? "unknown"}`),
      );
      // If stop was explicitly requested, the status was already set to "stopped".
      // Do not override it with "error" from the non-zero exit code.
      if (!serviceProcess.stopRequested) {
        const status = this.statusRecord(
          service,
          code === 0 ? "stopped" : "failed",
          `Process exited with code ${code ?? "unknown"}`,
          statusUrl,
          serviceProcess.startedAt,
        );
        this.upsertStatus(projectId, status);
      }
    });
    child.on("error", (error) => {
      if (this.serviceProcesses.get(key) === serviceProcess) {
        this.serviceProcesses.delete(key);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.appendLog(
        projectId,
        service,
        stamp(`${service} failed: ${message}`),
      );
      if (!serviceProcess.stopRequested) {
        this.upsertStatus(
          projectId,
          this.statusRecord(
            service,
            "failed",
            message,
            statusUrl,
            serviceProcess.startedAt,
          ),
        );
      }
    });

    const status = this.statusRecord(
      service,
      "starting",
      "Process starting",
      statusUrl,
      startedAt,
    );
    this.upsertStatus(projectId, status);
    this.insertActivity(
      projectId,
      `${serviceLabel(service)} started`,
      config.command,
      "success",
      "service",
    );
    void this.refreshStatus(projectId);
    return status;
  }

  private async stopService(
    projectId: string,
    service: ServiceName,
  ): Promise<ServiceStatusRecord> {
    const key = serviceProcessKey(projectId, service);
    const running = this.serviceProcesses.get(key);
    const settings = this.getSettings(projectId);
    const config = settings.services[service];
    const statusUrl = serviceStatusUrl(config, service);
    if (service === "frontend" && !isProjectFrontendEnabled(settings)) {
      return this.statusRecord(
        service,
        "unknown",
        "Frontend is not configured",
        "",
      );
    }

    const stoppingStatus = this.statusRecord(
      service,
      "stopping",
      "Stopping",
      statusUrl,
      running?.startedAt,
    );
    this.upsertStatus(projectId, stoppingStatus);

    if (running) {
      // Mark stop as requested so the exit handler does not override the status.
      running.stopRequested = true;
      this.appendLog(projectId, service, stamp("Stop requested"));
      await terminateProcessTreeAsync(running.child);
      if (this.serviceProcesses.get(key) === running) {
        this.serviceProcesses.delete(key);
      }
    } else {
      // Process not tracked (e.g. started before this session).
      // Best-effort: kill by the advertised status port.
      const port = extractPortFromUrl(statusUrl);
      if (port) {
        killProcessByPort(port);
        this.appendLog(
          projectId,
          service,
          stamp("Stop requested (killed by port)"),
        );
      }
    }

    this.explicitlyStoppedServices.add(key);

    // Always record the activity and update status, regardless of whether the
    // process was tracked in serviceProcesses.
    this.insertActivity(
      projectId,
      `${serviceLabel(service)} stopped`,
      "",
      "neutral",
      "service",
    );

    const status = this.statusRecord(service, "stopped", "Stopped", statusUrl);
    this.upsertStatus(projectId, status);
    this.clearStoppedServiceDashboardHistory(projectId, service);
    void this.refreshStatus(projectId);
    return status;
  }

  private spawnBuild(
    projectId: string,
    settings: ProjectSettingsRecord,
    profile: BuildProfileRecord,
    rowId: number,
  ): Promise<BuildResult> {
    return new Promise((resolvePromise) => {
      let resolved = false;
      const resolveOnce = (result: BuildResult): void => {
        if (resolved) {
          return;
        }
        resolved = true;
        this.buildProcesses.delete(projectId);
        this.flushLogBuffer();
        resolvePromise(result);
      };
      const executable = settings.maven.executable;
      const pomDir = dirname(settings.maven.pomXml);

      if (!executable || !existsSync(executable)) {
        this.appendLog(
          projectId,
          "build",
          stamp(`Maven executable does not exist: ${executable}`),
        );
        resolveOnce("failed");
        return;
      }

      if (!settings.maven.pomXml || !existsSync(settings.maven.pomXml)) {
        this.appendLog(
          projectId,
          "build",
          stamp(`pom.xml does not exist: ${settings.maven.pomXml}`),
        );
        resolveOnce("failed");
        return;
      }

      if (
        settings.maven.settingsXml &&
        !existsSync(settings.maven.settingsXml)
      ) {
        this.appendLog(
          projectId,
          "build",
          stamp(`settings.xml does not exist: ${settings.maven.settingsXml}`),
        );
        resolveOnce("failed");
        return;
      }

      const args = ["-P", profile.profileName, ...splitCommand(profile.goals)];
      if (settings.maven.settingsXml) {
        args.push("--settings", settings.maven.settingsXml);
      }
      if (settings.maven.skipTests) {
        args.push("-DskipTests");
      }
      args.push("-f", settings.maven.pomXml);

      const isWindowsScript =
        process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable);
      let child: ChildProcessWithoutNullStreams;
      try {
        child = isWindowsScript
          ? spawn(
              process.env.ComSpec ?? "cmd.exe",
              ["/d", "/s", "/c", executable, ...args],
              {
                cwd: existsSync(pomDir) ? pomDir : undefined,
                shell: false,
                windowsHide: true,
              },
            )
          : spawn(executable, args, {
              cwd: existsSync(pomDir) ? pomDir : undefined,
              shell: false,
              windowsHide: true,
            });
      } catch (error) {
        this.appendLog(
          projectId,
          "build",
          stamp(error instanceof Error ? error.message : String(error)),
        );
        resolveOnce("failed");
        return;
      }
      this.buildProcesses.set(projectId, {
        child,
        rowId,
        stopRequested: false,
      });
      child.stdout.on("data", (chunk: Buffer) =>
        this.appendChunk(projectId, "build", chunk, false, true),
      );
      child.stderr.on("data", (chunk: Buffer) =>
        this.appendChunk(projectId, "build", chunk, false, true),
      );
      child.on("error", (error) => {
        this.appendLog(projectId, "build", stamp(error.message));
        resolveOnce("failed");
      });
      child.on("exit", (code) => {
        const stopped = this.buildProcesses.get(projectId)?.stopRequested;
        this.appendLog(
          projectId,
          "build",
          stamp(`Build exited with code ${code ?? "unknown"}`),
        );
        resolveOnce(stopped ? "stopped" : code === 0 ? "success" : "failed");
      });
    });
  }

  private getStatuses(
    projectId: string,
    settings = this.getSettings(projectId),
  ): ServiceStatusRecord[] {
    const services = getProjectServiceNames(settings);
    const rows = this.db
      .prepare(
        `SELECT service, state, message, url, checked_at AS checkedAt, started_at AS startedAt
         FROM service_status WHERE project_id = ? ORDER BY service ASC`,
      )
      .all(projectId) as ServiceStatusRecord[];
    const filteredRows = rows.filter((row) => services.includes(row.service));

    if (filteredRows.length > 0) {
      return filteredRows;
    }

    return services.map((service) =>
      this.statusRecord(
        service,
        "unknown",
        "Not checked",
        this.getSettings(projectId).services[service].healthUrl,
      ),
    );
  }

  private getStoredStatus(
    projectId: string,
    service: ServiceName,
  ): ServiceStatusRecord | undefined {
    return this.db
      .prepare(
        `SELECT service, state, message, url, checked_at AS checkedAt, started_at AS startedAt
           FROM service_status WHERE project_id = ? AND service = ?`,
      )
      .get(projectId, service) as ServiceStatusRecord | undefined;
  }

  private upsertStatus(projectId: string, status: ServiceStatusRecord): void {
    this.db
      .prepare(
        `INSERT INTO service_status (
          project_id, service, state, message, url, checked_at, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id, service)
        DO UPDATE SET
          state = excluded.state,
          message = excluded.message,
          url = excluded.url,
          checked_at = excluded.checked_at,
          started_at = excluded.started_at`,
      )
      .run(
        projectId,
        status.service,
        status.state,
        status.message,
        status.url ?? "",
        status.checkedAt,
        status.startedAt ?? "",
      );
    this.send({ type: "status", projectId, status });
  }

  private statusRecord(
    service: ServiceName,
    state: ServiceState,
    message: string,
    url?: string,
    startedAt?: string,
  ): ServiceStatusRecord {
    return {
      service,
      state,
      message,
      url,
      checkedAt: new Date().toISOString(),
      startedAt,
    };
  }

  private statusFromProcess(
    _projectId: string,
    service: ServiceName,
    processState: ServiceProcess | undefined,
    fallbackMessage: string,
  ): ServiceStatusRecord {
    return this.statusRecord(
      service,
      processState
        ? service === "wildfly" && !processState.readyLogAt
          ? "starting"
          : "running"
        : "unknown",
      processState
        ? service === "wildfly" && !processState.readyLogAt
          ? `Waiting for "${WILDFLY_READY_LOG_FRAGMENT}"`
          : "Process running"
        : fallbackMessage,
      undefined,
      processState?.startedAt,
    );
  }

  private getRecentBuilds(projectId: string): RecentBuildRecord[] {
    this.pruneBuilds(projectId);
    return this.queryBuilds(
      projectId,
      { limit: 50 },
      this.getDashboardClearedAt(projectId),
    ).builds;
  }

  private getBuildByRowId(
    projectId: string,
    rowId: number,
  ): RecentBuildRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM build_runs WHERE project_id = ? AND id = ?")
      .get(projectId, rowId) as BuildRow | undefined;
    return row ? formatBuildRow(row) : undefined;
  }

  private queryBuilds(
    projectId: string,
    options: BuildQueryOptions = {},
    clearedAt: string | null = null,
  ): BuildQueryResult {
    const limit = clampInteger(options.limit, 1, 100, 30);
    const offset = clampInteger(options.offset, 0, 100_000, 0);
    const sortBy = normalizeBuildSortKey(options.sortBy);
    const sortDirection = options.sortDirection === "asc" ? "ASC" : "DESC";
    const whereParts = [
      "project_id = ?",
      `(status = 'running' OR datetime(COALESCE(completed_at, started_at)) >= datetime('now', '-${RETENTION_DAYS} days'))`,
    ];
    const params: unknown[] = [projectId];
    if (clearedAt) {
      whereParts.push("started_at > ?");
      params.push(clearedAt);
    }
    const search = options.search?.trim().toLowerCase() ?? "";
    const status = normalizeBuildStatus(options.status);

    if (status) {
      whereParts.push("status = ?");
      params.push(status);
    }

    if (search) {
      whereParts.push(`(
        lower(branch) LIKE ?
        OR lower(commit_hash) LIKE ?
        OR lower(commit_cleanliness) LIKE ?
        OR lower(profile_name) LIKE ?
        OR lower(button_name) LIKE ?
        OR lower(status) LIKE ?
        OR lower(COALESCE(completed_at, started_at)) LIKE ?
        OR CAST(COALESCE(duration_seconds, 0) AS TEXT) LIKE ?
        OR ('#' || id) LIKE ?
      )`);
      const pattern = `%${search}%`;
      params.push(
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
        pattern,
      );
    }

    const whereSql = whereParts.join(" AND ");
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS count FROM build_runs WHERE ${whereSql}`)
        .get(...params) as { count: number }
    ).count;

    const rows = this.db
      .prepare(
        `SELECT * FROM build_runs
         WHERE ${whereSql}
         ORDER BY ${buildOrderExpression(sortBy)} ${sortDirection}, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as BuildRow[];
    const builds = rows.map(formatBuildRow);
    return {
      builds,
      total,
      hasMore: offset + builds.length < total,
    };
  }

  private pruneBuilds(projectId: string): void {
    this.db
      .prepare(
        `DELETE FROM build_runs
         WHERE project_id = ?
           AND status != 'running'
           AND datetime(COALESCE(completed_at, started_at)) < datetime('now', '-${RETENTION_DAYS} days')`,
      )
      .run(projectId);
  }

  private getActivity(projectId: string): ActivityRecord[] {
    this.db
      .prepare(
        `DELETE FROM activity_events
         WHERE project_id = ?
           AND created_at < datetime('now', '-${RETENTION_DAYS} days')`,
      )
      .run(projectId);
    const rows = this.db
      .prepare(
        `SELECT * FROM activity_events
         WHERE project_id = ?
           AND created_at >= datetime('now', '-${RETENTION_DAYS} days')
         ORDER BY created_at DESC, id DESC`,
      )
      .all(projectId) as ActivityRow[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      meta: row.meta,
      tone: row.tone,
      kind: row.kind,
      time: formatTime(row.created_at),
      createdAt: row.created_at,
    }));
  }

  private insertActivity(
    projectId: string,
    title: string,
    meta: string,
    tone: ActivityTone,
    kind: ActivityKind,
  ): void {
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO activity_events
         (project_id, title, meta, tone, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(projectId, title, meta, tone, kind, createdAt);
    this.db
      .prepare(
        `DELETE FROM activity_events
         WHERE project_id = ?
           AND created_at < datetime('now', '-${RETENTION_DAYS} days')`,
      )
      .run(projectId);
    this.send({
      type: "activity",
      projectId,
      activityFeed: this.getActivity(projectId),
    });
  }

  private sendBuilds(projectId: string): void {
    this.send({
      type: "builds",
      projectId,
      builds: this.getRecentBuilds(projectId),
    });
  }

  private getLog(projectId: string, channel: LogChannel): string[] {
    return (this.logs.get(logKey(projectId, channel)) ?? []).map((l) => l.text);
  }

  private clearLog(projectId: string, channel: LogChannel): void {
    this.logBuffer.delete(logKey(projectId, channel));
    if (channel === "tail") {
      this.send({ type: "log-clear", projectId, channel });
      return;
    }
    const key = logKey(projectId, channel);
    this.logs.set(key, []);
    this.logSeqMap.set(key, 0);
    const filePath = this.projectLogPath(projectId, channel);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, "", "utf8");
    this.send({ type: "log-clear", projectId, channel });
  }

  private clearStoppedServiceDashboardHistory(
    projectId: string,
    service: ServiceName,
  ): void {
    if (service === "frontend") {
      this.clearLog(projectId, "frontend");
      return;
    }

    this.clearBackendDashboardHistory(projectId);
  }

  private clearBackendDashboardHistory(projectId: string): void {
    for (const channel of BACKEND_DASHBOARD_LOG_CHANNELS) {
      this.clearLog(projectId, channel);
    }
    this.markDashboardCleared(projectId);
    this.sendBuilds(projectId);
  }

  private clearAllDashboardHistory(): void {
    for (const project of this.getProjects()) {
      this.clearLog(project.id, "frontend");
      this.clearBackendDashboardHistory(project.id);
    }
  }

  private getDashboardClearedAt(projectId: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM app_meta WHERE key = ?")
      .get(this.dashboardClearedMetaKey(projectId)) as
      | { value: string }
      | undefined;
    return row?.value || null;
  }

  private markDashboardCleared(projectId: string): void {
    this.db
      .prepare(
        `INSERT INTO app_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(this.dashboardClearedMetaKey(projectId), new Date().toISOString());
  }

  private dashboardClearedMetaKey(projectId: string): string {
    return `${DASHBOARD_CLEARED_META_PREFIX}${projectId}`;
  }

  private appendChunk(
    projectId: string,
    channel: LogChannel,
    chunk: Buffer,
    silent = false,
    flushImmediately = false,
  ): void {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim().length > 0) {
        this.observeServiceLogLine(projectId, channel, line);
        this.captureApiFetchFromLine(projectId, channel, line);
        this.appendLog(projectId, channel, line, silent);
      }
    }
    if (flushImmediately && !silent) {
      this.flushLogBuffer();
    }
  }

  private appendLog(
    projectId: string,
    channel: LogChannel,
    line: string,
    silent = false,
  ): void {
    const key = logKey(projectId, channel);
    const existingSeq = this.logSeqMap.get(key);
    const nextSeq =
      (existingSeq ?? this.getPersistedLogLineCount(projectId, channel)) + 1;
    this.logSeqMap.set(key, nextSeq);
    const logLine: LogLine = { seq: nextSeq, text: line };
    const existing = this.logs.get(key) ?? [];
    if (existing.length >= LOG_LIMIT) {
      existing.shift();
    }
    existing.push(logLine);
    this.logs.set(key, existing);
    const filePath = this.projectLogPath(projectId, channel);
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${line}\n`, "utf8");
    if (silent) return;
    const bufKey = `${projectId}:${channel}`;
    const buf = this.logBuffer.get(bufKey);
    if (buf) {
      buf.push(logLine);
    } else {
      this.logBuffer.set(bufKey, [logLine]);
    }
    if (this.logFlushTimer === null) {
      this.logFlushTimer = setTimeout(
        () => this.flushLogBuffer(),
        LOG_BATCH_FLUSH_MS,
      );
    }
  }

  private flushLogBuffer(): void {
    this.logFlushTimer = null;
    for (const [bufKey, lines] of this.logBuffer) {
      if (lines.length === 0) continue;
      const colonIdx = bufKey.indexOf(":");
      const projectId = bufKey.slice(0, colonIdx);
      const channel = bufKey.slice(colonIdx + 1) as LogChannel;
      this.send({ type: "log-batch", projectId, channel, lines: [...lines] });
      lines.length = 0;
    }
    this.logBuffer.clear();
  }

  private observeServiceLogLine(
    projectId: string,
    channel: LogChannel,
    line: string,
  ): void {
    if (
      channel !== "frontend" &&
      channel !== "wildfly" &&
      channel !== "python"
    ) {
      return;
    }

    const processState = this.serviceProcesses.get(
      serviceProcessKey(projectId, channel),
    );

    if (
      channel === "wildfly" &&
      line.includes(WILDFLY_READY_LOG_FRAGMENT) &&
      processState &&
      !processState.stopRequested
    ) {
      processState.readyLogAt = new Date().toISOString();
      const healthUrl = this.getSettings(projectId).services[channel].healthUrl;
      this.upsertStatus(
        projectId,
        this.statusRecord(
          channel,
          "running",
          line.trim(),
          healthUrl,
          processState.startedAt,
        ),
      );
      return;
    }

    if (!isServiceStartupLogLine(channel, line)) {
      return;
    }

    if (processState && !processState.stopRequested) {
      processState.startupLogAt = new Date().toISOString();
      const currentStatus = this.getStoredStatus(projectId, channel);
      if (
        currentStatus?.state !== "running" &&
        currentStatus?.state !== "starting"
      ) {
        const healthUrl =
          this.getSettings(projectId).services[channel].healthUrl;
        this.upsertStatus(
          projectId,
          this.statusRecord(
            channel,
            "starting",
            "Startup output detected",
            healthUrl,
            processState.startedAt,
          ),
        );
      }
    }
  }

  getLogLatest(
    projectId: string,
    channel: LogChannel,
    limit = 400,
  ): LogQueryResult {
    if (channel === "tail") {
      return this.tailLogLatest(projectId, limit);
    }
    const all = this.readPersistedLogLines(projectId, channel);
    const start = Math.max(0, all.length - limit);
    const lines = all
      .slice(start)
      .map((text, index) => ({ seq: start + index + 1, text }));
    return {
      lines: [...lines],
      oldestSeq: lines[0]?.seq ?? null,
      newestSeq: lines[lines.length - 1]?.seq ?? null,
      hasMoreOlder: all.length > lines.length,
    };
  }

  getLogBefore(
    projectId: string,
    channel: LogChannel,
    beforeSeq: number,
    limit = 400,
  ): LogQueryResult {
    if (channel === "tail") {
      return this.tailLogBefore(projectId, beforeSeq, limit);
    }
    const all = this.readPersistedLogLines(projectId, channel);
    const sliceEnd = Math.min(Math.max(beforeSeq - 1, 0), all.length);
    const start = Math.max(0, sliceEnd - limit);
    const lines = all
      .slice(start, sliceEnd)
      .map((text, index) => ({ seq: start + index + 1, text }));
    return {
      lines: [...lines],
      oldestSeq: lines[0]?.seq ?? null,
      newestSeq: lines[lines.length - 1]?.seq ?? null,
      hasMoreOlder: start > 0,
    };
  }

  getLogAround(
    projectId: string,
    channel: LogChannel,
    seq: number,
    limit = 800,
  ): LogQueryResult {
    const all =
      channel === "tail"
        ? this.tailReadCurrentLines(projectId)
        : this.readPersistedLogLines(projectId, channel);
    const safeLimit = clampInteger(limit, 1, 5000, 800);
    const targetIndex = clampInteger(
      seq - 1,
      0,
      Math.max(0, all.length - 1),
      0,
    );
    const before = Math.floor(safeLimit / 2);
    const start = Math.max(0, targetIndex - before);
    const end = Math.min(all.length, start + safeLimit);
    const adjustedStart = Math.max(0, end - safeLimit);
    const lines = all
      .slice(adjustedStart, end)
      .map((text, index) => ({ seq: adjustedStart + index + 1, text }));

    return {
      lines,
      oldestSeq: lines[0]?.seq ?? null,
      newestSeq: lines[lines.length - 1]?.seq ?? null,
      hasMoreOlder: adjustedStart > 0,
    };
  }

  searchLog(
    projectId: string,
    channel: LogChannel,
    term: string,
  ): { matchSeqs: number[]; total: number } {
    const query = term.trim().toLowerCase();
    if (!query) {
      return { matchSeqs: [], total: 0 };
    }

    const lines =
      channel === "tail"
        ? this.tailReadCurrentLines(projectId)
        : this.readPersistedLogLines(projectId, channel);
    const matchSeqs: number[] = [];
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(query)) {
        matchSeqs.push(index + 1);
      }
    });
    return { matchSeqs, total: matchSeqs.length };
  }

  private tailReadLines(filePath: string): string[] {
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
  }

  private readPersistedLogLines(
    projectId: string,
    channel: LogChannel,
  ): string[] {
    const filePath = this.projectLogPath(projectId, channel);
    return this.tailReadLines(filePath);
  }

  private getPersistedLogLineCount(
    projectId: string,
    channel: LogChannel,
  ): number {
    if (channel === "tail") {
      return 0;
    }
    return this.readPersistedLogLines(projectId, channel).length;
  }

  private tailReadCurrentLines(projectId: string): string[] {
    const state = this.tailStates.get(projectId);
    const filePath = state?.path ?? this.getSettings(projectId).appLogFile;
    return filePath.trim() ? this.tailReadLines(filePath) : [];
  }

  private tailLogLatest(projectId: string, limit: number): LogQueryResult {
    const all = this.tailReadCurrentLines(projectId);
    if (all.length === 0)
      return {
        lines: [],
        oldestSeq: null,
        newestSeq: null,
        hasMoreOlder: false,
      };
    const start = Math.max(0, all.length - limit);
    const lines: LogLine[] = all
      .slice(start)
      .map((text, i) => ({ seq: start + i + 1, text }));
    return {
      lines,
      oldestSeq: lines[0]?.seq ?? null,
      newestSeq: lines[lines.length - 1]?.seq ?? null,
      hasMoreOlder: start > 0,
    };
  }

  private tailLogBefore(
    projectId: string,
    beforeSeq: number,
    limit: number,
  ): LogQueryResult {
    const all = this.tailReadCurrentLines(projectId);
    if (all.length === 0)
      return {
        lines: [],
        oldestSeq: null,
        newestSeq: null,
        hasMoreOlder: false,
      };
    const sliceEnd = Math.min(beforeSeq - 1, all.length);
    const start = Math.max(0, sliceEnd - limit);
    const lines: LogLine[] = all
      .slice(start, sliceEnd)
      .map((text, i) => ({ seq: start + i + 1, text }));
    return {
      lines,
      oldestSeq: lines[0]?.seq ?? null,
      newestSeq: lines[lines.length - 1]?.seq ?? null,
      hasMoreOlder: start > 0,
    };
  }

  private projectLogPath(projectId: string, channel: LogChannel): string {
    return join(this.dataRoot, "projects", projectId, "logs", `${channel}.log`);
  }

  private ensureTail(projectId: string, filePath: string, force = false): void {
    const existing = this.tailStates.get(projectId);
    if (existing && !force && existing.path === filePath) {
      if (existsSync(filePath) && statSync(filePath).size < existing.offset) {
        existing.offset = 0;
        existing.lineCount = 0;
        this.send({ type: "log-clear", projectId, channel: "tail" });
      }
      return;
    }

    if (existing) {
      clearInterval(existing.timer);
      this.tailStates.delete(projectId);
    }

    this.send({ type: "log-clear", projectId, channel: "tail" });

    if (!filePath.trim()) {
      return;
    }

    let offset = existsSync(filePath) ? statSync(filePath).size : 0;
    let lineCount = 0;
    if (existsSync(filePath)) {
      lineCount = this.tailReadLines(filePath).length;
    }

    const timer = setInterval(() => {
      try {
        if (!existsSync(filePath)) {
          return;
        }
        const size = statSync(filePath).size;
        if (size < offset) {
          offset = 0;
          lineCount = 0;
          this.send({ type: "log-clear", projectId, channel: "tail" });
        }
        if (size === offset) {
          return;
        }
        const fd = openSync(filePath, "r");
        const length = size - offset;
        const buffer = Buffer.alloc(Math.min(length, 64_000));
        readSync(fd, buffer, 0, buffer.length, offset);
        closeSync(fd);
        offset = size;
        const newLines = buffer
          .toString()
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0);
        if (newLines.length === 0) return;
        const logLines: LogLine[] = newLines.map((text) => ({
          seq: ++lineCount,
          text,
        }));
        const state = this.tailStates.get(projectId);
        if (state) state.lineCount = lineCount;
        this.send({
          type: "log-batch",
          projectId,
          channel: "tail",
          lines: logLines,
        });
      } catch (error) {
        // silently ignore transient read errors
      }
    }, TAIL_INTERVAL_MS);

    this.tailStates.set(projectId, {
      path: filePath,
      offset,
      lineCount,
      timer,
    });
  }

  private ensureStatusPolling(projectId: string): void {
    if (this.statusTimers.has(projectId)) {
      return;
    }

    void this.refreshStatus(projectId);
    const timer = setInterval(() => {
      void this.refreshStatus(projectId);
    }, STATUS_INTERVAL_MS);
    this.statusTimers.set(projectId, timer);
  }

  private readGitStatus(repository: string): GitStatusRecord {
    if (!repository || !existsSync(repository)) {
      return {
        repository,
        branch: "unavailable",
        commit: "unavailable",
        status: repository
          ? `Git Project Directory does not exist: ${repository}`
          : "Git Project Directory is not configured",
        lines: [
          stamp(
            repository
              ? `Git Project Directory does not exist: ${repository}`
              : "Git Project Directory is not configured",
          ),
        ],
      };
    }

    try {
      const branch = spawnSyncText(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        repository,
      );
      const commit = spawnSyncText(
        "git",
        ["rev-parse", "--short", "HEAD"],
        repository,
      );
      const status = spawnSyncText("git", ["status", "--short"], repository);
      const lines = [
        stamp(`Repository: ${repository}`),
        stamp(`Branch: ${branch || "unavailable"}`),
        stamp(`Commit: ${commit || "unavailable"}`),
        ...(status
          ? status.split(/\r?\n/).map((line) => stamp(line))
          : [stamp("Working tree clean")]),
      ];
      return {
        repository,
        branch: branch || "unavailable",
        commit: commit || "unavailable",
        status: status ? "Working tree has changes" : "Clean",
        lines,
      };
    } catch (error) {
      return {
        repository,
        branch: "unavailable",
        commit: "unavailable",
        status: error instanceof Error ? error.message : String(error),
        lines: [stamp(error instanceof Error ? error.message : String(error))],
      };
    }
  }

  private send(event: DashboardEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(CHANNEL_NAME, event);
    }
  }
}

function composeMavenCommand(
  settings: ProjectSettingsRecord,
  profile: BuildProfileRecord,
): string {
  const parts = [
    quote(settings.maven.executable),
    "-P",
    profile.profileName,
    profile.goals,
  ];
  if (settings.maven.settingsXml) {
    parts.push("--settings", quote(settings.maven.settingsXml));
  }
  if (settings.maven.skipTests) {
    parts.push("-DskipTests");
  }
  parts.push("-f", quote(settings.maven.pomXml));
  return parts.join(" ");
}

type UrlCheckResult = {
  ok: boolean;
  reachable: boolean;
  statusCode?: number;
  message: string;
};

type PortCheckResult = {
  listening: boolean;
  message: string;
};

function serviceStatusUrl(
  config: { appUrl?: string; healthUrl: string },
  service: ServiceName,
): string {
  return service === "python" ? (config.appUrl ?? "") : config.healthUrl;
}

function formatPort(port: number | null): string {
  return port === null ? "" : String(port);
}

function checkUrl(url: string): Promise<UrlCheckResult> {
  return new Promise((resolvePromise) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolvePromise({
        ok: false,
        reachable: false,
        message: `Invalid URL: ${url}`,
      });
      return;
    }

    const client = parsed.protocol === "https:" ? httpsRequest : httpRequest;
    const request = client(
      parsed,
      { method: "GET", timeout: 3000 },
      (response) => {
        response.resume();
        const statusCode = response.statusCode ?? 0;
        const authRequired = statusCode === 401 || statusCode === 403;
        resolvePromise({
          ok: statusCode >= 200 && statusCode < 400,
          reachable: statusCode > 0,
          statusCode,
          message: authRequired
            ? `HTTP ${statusCode} (authentication required)`
            : `HTTP ${statusCode}`,
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("timeout"));
    });
    request.on("error", (error) =>
      resolvePromise({
        ok: false,
        reachable: false,
        message: error.message,
      }),
    );
    request.end();
  });
}

function checkPortListening(port: number): Promise<PortCheckResult> {
  const command = createPortCheckCommand(port);
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(command.executable, command.args, {
      windowsHide: true,
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 3000);

    const resolveOnce = (result: PortCheckResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolvePromise(result);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) =>
      resolveOnce({
        listening: false,
        message: `Port ${port} check failed: ${error.message}`,
      }),
    );
    child.on("close", () => {
      if (timedOut) {
        resolveOnce({
          listening: false,
          message: `Port ${port} check timed out`,
        });
        return;
      }

      const output = `${stdout}\n${stderr}`;
      const listening = hasListeningPortLine(output, port);
      resolveOnce({
        listening,
        message: listening
          ? `Port ${port} is listening`
          : `Port ${port} is not listening`,
      });
    });
  });
}

function createPortCheckCommand(port: number): {
  executable: string;
  args: string[];
} {
  if (process.platform === "win32") {
    return {
      executable: "cmd",
      args: ["/c", `netstat -ano | findstr :${port}`],
    };
  }

  return {
    executable: "sh",
    args: [
      "-c",
      `if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:${port} -sTCP:LISTEN; elif command -v ss >/dev/null 2>&1; then ss -ltnp | grep -E '[:.]${port}\\b'; else netstat -an | grep -E '[:.]${port}\\b'; fi`,
    ],
  };
}

function hasListeningPortLine(output: string, port: number): boolean {
  const portPattern = new RegExp(`[:.]${port}(?:$|[^0-9])`);
  return output.split(/\r?\n/).some((line) => {
    const normalized = line.trim();
    if (!normalized || !/\bLISTEN(?:ING)?\b/i.test(normalized)) {
      return false;
    }
    return normalized.split(/\s+/).some((token) => portPattern.test(token));
  });
}

function normalizeOptionalDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : value;
}

function hasRecentServiceStartupSignal(processState: ServiceProcess): boolean {
  if (!processState.startupLogAt) {
    return false;
  }

  const signalTime = new Date(processState.startupLogAt).getTime();
  return (
    !Number.isNaN(signalTime) &&
    Date.now() - signalTime < SERVICE_STARTING_GRACE_MS
  );
}

function isRecentStartFailureStatus(
  status: ServiceStatusRecord | undefined,
): boolean {
  if (status?.state !== "failed") {
    return false;
  }

  const checkedAt = new Date(status.checkedAt).getTime();
  if (
    Number.isNaN(checkedAt) ||
    Date.now() - checkedAt > SERVICE_STARTING_GRACE_MS
  ) {
    return false;
  }

  return /process exited|failed|working directory|no command|running server limit/i.test(
    status.message,
  );
}

function isServiceStartupLogLine(service: ServiceName, line: string): boolean {
  const normalized = line.toLowerCase();
  if (
    /\b(starting|startup|initiali[sz](ing|ed)?|booting|deploying|binding|listening)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (service === "frontend") {
    return (
      /\bvite\b/.test(normalized) ||
      /\bready in\b/.test(normalized) ||
      /\blocal:\s*https?:\/\//.test(normalized) ||
      /port \d+ is in use/.test(normalized)
    );
  }

  return (
    /\bwfly[a-z0-9]*\d+/.test(normalized) ||
    /\bwildfly\b/.test(normalized) ||
    /\bjboss\b/.test(normalized)
  );
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function parseSheetContent(value: string): SheetContentJson {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SheetContentJson;
    }
  } catch {
    // Fall back to an empty document if persisted content is unreadable.
  }

  return EMPTY_SHEET_CONTENT;
}

function mapDatabaseWorksheetRow(row: DatabaseWorksheetRow): DatabaseWorksheet {
  return {
    connectionId: row.connection_id,
    sheetId: row.sheet_id,
    sheetName: row.sheet_name,
    sql: row.sql_content,
    savedAt: row.saved_at,
    isOpen: row.is_open === 1,
    sortOrder: row.sort_order,
  };
}

function mapDatabaseExecutionHistoryRow(
  row: DatabaseExecutionHistoryRow,
): DatabaseExecutionRecord {
  return {
    id: row.id,
    time: row.executed_at,
    connectionId: row.connection_id,
    connection: row.connection_name,
    user: row.database_user,
    query: row.sql_statement,
    duration: formatDurationMs(row.duration_ms),
    status: row.status,
    rows: row.row_count,
    rowsAffected: row.rows_affected ?? undefined,
    errorMessage: row.error_message ?? undefined,
    message: row.execution_message ?? row.error_message ?? undefined,
  };
}

function createDatabaseExecutionMessage(
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

function normalizeDatabaseConnection(
  connection: DatabaseConnection,
): DatabaseConnection {
  const database = connection.database?.trim() ?? "";
  const schema =
    connection.schema?.trim() ||
    database ||
    connection.serviceName?.trim() ||
    connection.sid?.trim() ||
    connection.networkAlias?.trim() ||
    connection.connectString?.trim() ||
    "";

  return {
    id: connection.id?.trim() || randomUUID(),
    name: connection.name?.trim() || "Database",
    type: connection.type ?? "MySQL",
    status: connection.status ?? "disconnected",
    host: connection.host?.trim() ?? "",
    port:
      String(connection.port ?? "").trim() ||
      defaultDatabasePort(connection.type),
    user: connection.user?.trim() ?? "",
    schema,
    password: connection.password,
    savePassword: connection.savePassword ?? true,
    autoConnect: connection.autoConnect ?? false,
    connectionTimeoutMs: connection.connectionTimeoutMs ?? 10000,
    database,
    sslMode: connection.sslMode ?? "disabled",
    sslCaPath: connection.sslCaPath?.trim() ?? "",
    sslCertPath: connection.sslCertPath?.trim() ?? "",
    sslKeyPath: connection.sslKeyPath?.trim() ?? "",
    connectionMode: connection.connectionMode ?? "serviceName",
    serviceName: connection.serviceName?.trim() ?? "",
    sid: connection.sid?.trim() ?? "",
    connectString: connection.connectString?.trim() ?? "",
    networkAlias: connection.networkAlias?.trim() ?? "",
    role: connection.role?.trim() ?? "",
    walletPath: connection.walletPath?.trim() ?? "",
    latency: connection.latency || "Not tested",
    uptime: connection.uptime || "Not connected",
    activeSessions: connection.activeSessions ?? 0,
  };
}

function defaultDatabasePort(type?: DatabaseConnection["type"]): string {
  if (type === "Oracle") {
    return "1521";
  }
  if (type === "PostgreSQL") {
    return "5432";
  }
  return "3306";
}

function createEstimatedRowCountCacheKey(
  connection: DatabaseConnection,
  schema: string,
  table: string,
): string {
  return [connection.id, schema, table]
    .map((part) => part.trim().toLowerCase())
    .join(":");
}

type RowCountMutation = {
  kind: "insert" | "delete" | "truncate" | "load";
  delta: number;
  schema?: string;
  table: string;
};

function parseRowCountMutation(statement: string): RowCountMutation | null {
  const targetPattern =
    '((?:`[^`]+`|\\"[^\\"]+\\"|[A-Za-z0-9_$]+)(?:\\s*\\.\\s*(?:`[^`]+`|\\"[^\\"]+\\"|[A-Za-z0-9_$]+))?)';
  const patterns: Array<{
    kind: RowCountMutation["kind"];
    delta: number;
    regex: RegExp;
  }> = [
    {
      kind: "insert",
      delta: 1,
      regex: new RegExp(
        `^\\s*insert\\s+(?:ignore\\s+)?(?:into\\s+)?${targetPattern}`,
        "i",
      ),
    },
    {
      kind: "delete",
      delta: -1,
      regex: new RegExp(`^\\s*delete\\s+from\\s+${targetPattern}`, "i"),
    },
    {
      kind: "truncate",
      delta: 0,
      regex: new RegExp(`^\\s*truncate(?:\\s+table)?\\s+${targetPattern}`, "i"),
    },
    {
      kind: "load",
      delta: 1,
      regex: new RegExp(
        `^\\s*load\\s+data[\\s\\S]*?\\s+into\\s+table\\s+${targetPattern}`,
        "i",
      ),
    },
  ];

  for (const pattern of patterns) {
    const match = statement.match(pattern.regex);
    if (!match?.[1]) {
      continue;
    }

    const qualifiedName = parseQualifiedTableName(match[1]);
    if (!qualifiedName) {
      return null;
    }

    return { kind: pattern.kind, delta: pattern.delta, ...qualifiedName };
  }

  return null;
}

function parseQualifiedTableName(
  value: string,
): { schema?: string; table: string } | null {
  const parts = value
    .split(/\s*\.\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(unquoteSqlIdentifier);

  if (parts.length === 1) {
    return { table: parts[0] };
  }

  if (parts.length === 2) {
    return { schema: parts[0], table: parts[1] };
  }

  return null;
}

function unquoteSqlIdentifier(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("`") && trimmed.endsWith("`")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function toMysqlConnectionOptions(
  connection: DatabaseConnection,
  options: { includeDatabase?: boolean } = {},
): {
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
  connectTimeout: number;
  ssl?: Record<string, never>;
  dateStrings: boolean;
  supportBigNumbers: boolean;
  bigNumberStrings: boolean;
} {
  const database = connection.database?.trim();
  const includeDatabase = options.includeDatabase ?? true;
  return {
    host: connection.host.trim(),
    port: Number(connection.port) || 3306,
    user: connection.user.trim(),
    password: connection.password ?? "",
    database: includeDatabase && database ? database : undefined,
    connectTimeout: connection.connectionTimeoutMs ?? 10000,
    ssl: connection.sslMode === "required" ? {} : undefined,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
}

function createPostgresClient(
  connection: DatabaseConnection,
  options: { includeDatabase?: boolean } = {},
): PostgresClient {
  return new postgresDriver.Client(
    toPostgresClientOptions(connection, options),
  );
}

function toPostgresClientOptions(
  connection: DatabaseConnection,
  options: { includeDatabase?: boolean } = {},
): PostgresClientOptions {
  const database = connection.database?.trim();
  const includeDatabase = options.includeDatabase ?? true;
  return {
    host: connection.host.trim(),
    port: Number(connection.port) || 5432,
    user: connection.user.trim(),
    password: connection.password ?? "",
    database: includeDatabase && database ? database : undefined,
    connectionTimeoutMillis: connection.connectionTimeoutMs ?? 10000,
    ssl: createPostgresSslOptions(connection),
  };
}

function createPostgresSslOptions(
  connection: DatabaseConnection,
): PostgresClientOptions["ssl"] {
  const sslMode = connection.sslMode ?? "disabled";
  if (sslMode === "disabled") {
    return undefined;
  }

  const sslOptions: Exclude<PostgresClientOptions["ssl"], boolean> = {
    rejectUnauthorized: sslMode === "required",
  };
  const sslCaPath = connection.sslCaPath?.trim();
  const sslCertPath = connection.sslCertPath?.trim();
  const sslKeyPath = connection.sslKeyPath?.trim();

  if (sslCaPath) {
    sslOptions.ca = readFileSync(sslCaPath, "utf8");
  }
  if (sslCertPath) {
    sslOptions.cert = readFileSync(sslCertPath, "utf8");
  }
  if (sslKeyPath) {
    sslOptions.key = readFileSync(sslKeyPath, "utf8");
  }

  return sslOptions;
}

async function executePostgresRows(
  connection: PostgresClient,
  statement: string,
  values: unknown[] = [],
): Promise<Array<Record<string, unknown>>> {
  const result = await connection.query(statement, values);
  return result.rows;
}

async function createOracleConnection(
  connection: DatabaseConnection,
): Promise<OracleConnection> {
  ensureOracleClientMode();
  try {
    return await oracleDriver.getConnection(
      toOracleConnectionOptions(connection),
    );
  } catch (error) {
    throw withOracleConnectionHint(error);
  }
}

function toOracleConnectionOptions(
  connection: DatabaseConnection,
): OracleConnectionOptions {
  const options: OracleConnectionOptions = {
    user: connection.user.trim(),
    password: connection.password ?? "",
    connectString: createOracleConnectString(connection),
    connectTimeout: Math.max(
      1,
      Math.ceil((connection.connectionTimeoutMs ?? 10000) / 1000),
    ),
  };
  const walletPath = connection.walletPath?.trim();
  if (walletPath) {
    options.configDir = walletPath;
  }
  const privilege = resolveOraclePrivilege(connection.role);
  if (privilege !== undefined) {
    options.privilege = privilege;
  }
  return options;
}

function createOracleConnectString(connection: DatabaseConnection): string {
  if (connection.connectionMode === "connectString") {
    return connection.connectString?.trim() ?? "";
  }

  if (connection.connectionMode === "tnsAlias") {
    return connection.networkAlias?.trim() || connection.schema.trim();
  }

  const host = connection.host.trim();
  const port = Number(connection.port) || 1521;
  if (connection.connectionMode === "sid") {
    const sid = connection.sid?.trim() || connection.schema.trim();
    return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${sid})))`;
  }

  const serviceName =
    connection.serviceName?.trim() ||
    connection.database?.trim() ||
    connection.schema.trim();
  return `${host}:${port}/${serviceName}`;
}

function formatOracleConnectionTarget(connection: DatabaseConnection): string {
  if (connection.connectionMode === "tnsAlias") {
    return (
      connection.networkAlias?.trim() || connection.schema.trim() || "Oracle"
    );
  }

  return connection.connectionMode === "connectString"
    ? (connection.connectString?.trim() ?? "Oracle")
    : `${connection.host.trim()}:${Number(connection.port) || 1521}`;
}

function resolveOraclePrivilege(role?: string): number | undefined {
  const normalizedRole = role?.trim().toUpperCase();
  if (!normalizedRole) {
    return undefined;
  }
  const privileges: Record<string, number> = {
    SYSASM: oracleDriver.SYSASM,
    SYSBACKUP: oracleDriver.SYSBACKUP,
    SYSDBA: oracleDriver.SYSDBA,
    SYSDG: oracleDriver.SYSDG,
    SYSKM: oracleDriver.SYSKM,
    SYSOPER: oracleDriver.SYSOPER,
    SYSRAC: oracleDriver.SYSRAC,
  };
  const privilege = privileges[normalizedRole];
  if (privilege === undefined) {
    throw new Error(
      "Oracle role must be one of SYSDBA, SYSOPER, SYSASM, SYSBACKUP, SYSDG, SYSKM, or SYSRAC.",
    );
  }
  return privilege;
}

function mapApiTesterSavedRequestRow(
  row: ApiTesterSavedRequestRow,
): ApiTesterSavedRequestRecord {
  return {
    id: row.id,
    scopeId: row.scope_id,
    name: row.name,
    method: row.method,
    url: row.url,
    requestJson: row.request_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function ensureOracleClientMode(): void {
  if (
    oracleClientInitAttempted ||
    typeof oracleDriver.initOracleClient !== "function"
  ) {
    return;
  }

  oracleClientInitAttempted = true;
  const libDir = (
    process.env.IVS_ORACLE_CLIENT_LIB_DIR ??
    process.env.ORACLE_CLIENT_LIB_DIR ??
    process.env.ORACLE_HOME ??
    ""
  ).trim();

  try {
    oracleDriver.initOracleClient(libDir ? { libDir } : undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already initialized/i.test(message)) {
      console.warn(`Oracle Thick mode was not initialized: ${message}`);
    }
  }
}

function withOracleConnectionHint(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/NJS-116|password verifier type/i.test(message)) {
    return new Error(
      `${message}\n\nThis Oracle account uses an older password verifier that node-oracledb Thin mode cannot authenticate. Install Oracle Instant Client and set IVS_ORACLE_CLIENT_LIB_DIR to its folder, or ask the DBA to reset the user password with a newer verifier.`,
    );
  }
  return error instanceof Error ? error : new Error(message);
}

function oracleSelectOptions(): OracleExecuteOptions {
  return {
    outFormat: oracleDriver.OUT_FORMAT_OBJECT,
    fetchArraySize: 200,
  };
}

async function executeOracleRows(
  connection: OracleConnection,
  statement: string,
  binds: unknown[] | Record<string, unknown> = [],
): Promise<Array<Record<string, unknown>>> {
  const result = await connection.execute(
    statement,
    binds,
    oracleSelectOptions(),
  );
  return (Array.isArray(result.rows) ? result.rows : []).map((row) =>
    normalizeOracleObjectRow(row),
  );
}

function createOracleInPredicate(
  columnName: string,
  values: string[],
): { sql: string; binds: string[] } {
  const placeholders = values.map((_, index) => `:${index + 1}`).join(", ");
  return {
    sql: `${columnName} IN (${placeholders})`,
    binds: values,
  };
}

async function executeOracleSqlStatement(
  oracleConnection: OracleConnection,
  trimmedStatement: string,
  startedAt: number,
): Promise<DatabaseStatementExecutionResult> {
  const executionResult = await oracleConnection.execute(trimmedStatement, [], {
    outFormat: oracleDriver.OUT_FORMAT_OBJECT,
    autoCommit: true,
    fetchInfo: { DDL: { type: oracleDriver.STRING } },
  });
  const durationMs = Math.max(1, performance.now() - startedAt);
  const rowArray = Array.isArray(executionResult.rows)
    ? executionResult.rows
    : [];
  const normalizedRows = rowArray.map((row) => normalizeOracleRow(row));
  return {
    statement: trimmedStatement,
    columns: (executionResult.metaData ?? []).map((field) => ({
      key: field.name ?? "",
      label: field.name ?? "",
      type: formatOracleResultColumnType(field),
    })),
    rows: normalizedRows,
    status: "success",
    durationMs,
    rowsFetched: normalizedRows.length,
    rowsAffected: executionResult.rowsAffected,
  };
}

async function executeOracleDescribeStatement(
  oracleConnection: OracleConnection,
  trimmedStatement: string,
  startedAt: number,
): Promise<DatabaseStatementExecutionResult | null> {
  const target = parseOracleDescribeStatement(trimmedStatement);
  if (!target) {
    return null;
  }

  const rows = await executeOracleRows(
    oracleConnection,
    `SELECT C.OWNER,
            C.TABLE_NAME,
            C.COLUMN_NAME,
            C.DATA_TYPE,
            C.DATA_LENGTH,
            C.CHAR_LENGTH,
            C.DATA_PRECISION,
            C.DATA_SCALE,
            C.NULLABLE,
            C.DATA_DEFAULT,
            CASE
              WHEN EXISTS (
                SELECT 1
                FROM ALL_CONSTRAINTS AC
                JOIN ALL_CONS_COLUMNS ACC
                  ON ACC.OWNER = AC.OWNER
                 AND ACC.CONSTRAINT_NAME = AC.CONSTRAINT_NAME
                 AND ACC.TABLE_NAME = AC.TABLE_NAME
                WHERE AC.CONSTRAINT_TYPE = 'P'
                  AND AC.OWNER = C.OWNER
                  AND AC.TABLE_NAME = C.TABLE_NAME
                  AND ACC.COLUMN_NAME = C.COLUMN_NAME
              ) THEN 'PRI'
              WHEN EXISTS (
                SELECT 1
                FROM ALL_CONSTRAINTS AC
                JOIN ALL_CONS_COLUMNS ACC
                  ON ACC.OWNER = AC.OWNER
                 AND ACC.CONSTRAINT_NAME = AC.CONSTRAINT_NAME
                 AND ACC.TABLE_NAME = AC.TABLE_NAME
                WHERE AC.CONSTRAINT_TYPE = 'U'
                  AND AC.OWNER = C.OWNER
                  AND AC.TABLE_NAME = C.TABLE_NAME
                  AND ACC.COLUMN_NAME = C.COLUMN_NAME
              ) OR EXISTS (
                SELECT 1
                FROM ALL_INDEXES IX
                JOIN ALL_IND_COLUMNS IC
                  ON IC.INDEX_OWNER = IX.OWNER
                 AND IC.INDEX_NAME = IX.INDEX_NAME
                 AND IC.TABLE_OWNER = IX.TABLE_OWNER
                 AND IC.TABLE_NAME = IX.TABLE_NAME
                WHERE IX.UNIQUENESS = 'UNIQUE'
                  AND IC.TABLE_OWNER = C.OWNER
                  AND IC.TABLE_NAME = C.TABLE_NAME
                  AND IC.COLUMN_NAME = C.COLUMN_NAME
              ) THEN 'UNI'
              WHEN EXISTS (
                SELECT 1
                FROM ALL_IND_COLUMNS IC
                WHERE IC.TABLE_OWNER = C.OWNER
                  AND IC.TABLE_NAME = C.TABLE_NAME
                  AND IC.COLUMN_NAME = C.COLUMN_NAME
              ) THEN 'MUL'
              ELSE ''
            END AS COLUMN_KEY
     FROM ALL_TAB_COLUMNS C
     WHERE C.TABLE_NAME IN (:tableName, :tableNameUpper)
       AND (
         (:ownerName IS NULL AND C.OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'))
         OR (:ownerName IS NOT NULL AND C.OWNER IN (:ownerName, :ownerNameUpper))
       )
     ORDER BY C.COLUMN_ID`,
    {
      tableName: target.table,
      tableNameUpper: target.tableUpper,
      ownerName: target.schema ?? null,
      ownerNameUpper: target.schemaUpper ?? null,
    },
  );
  const durationMs = Math.max(1, performance.now() - startedAt);
  const normalizedRows = rows.map((row) => ({
    Field: normalizeOracleValue(row.COLUMN_NAME),
    Type: formatOracleDataType(row),
    Null: String(row.NULLABLE).toUpperCase() === "Y" ? "YES" : "NO",
    Key: normalizeOracleValue(row.COLUMN_KEY),
    Default:
      row.DATA_DEFAULT === null || row.DATA_DEFAULT === undefined
        ? null
        : String(row.DATA_DEFAULT).trim(),
    Extra: "",
  }));

  if (normalizedRows.length === 0) {
    throw new Error(`Table '${target.qualifiedName}' doesn't exist.`);
  }

  return {
    statement: trimmedStatement,
    columns: MYSQL_DESCRIBE_COLUMNS,
    rows: normalizedRows,
    status: "success",
    durationMs,
    rowsFetched: normalizedRows.length,
  };
}

function parseOracleDescribeStatement(statement: string): {
  schema?: string;
  schemaUpper?: string;
  table: string;
  tableUpper: string;
  qualifiedName: string;
} | null {
  const match = /^\s*desc(?:ribe)?\s+(.+?)\s*;?\s*$/i.exec(statement);
  if (!match?.[1]) {
    return null;
  }

  const parts = splitOracleQualifiedIdentifier(match[1].trim());
  if (parts.length < 1 || parts.length > 2) {
    return null;
  }

  const identifiers = parts.map((part) => parseOracleIdentifier(part));
  if (identifiers.some((identifier) => !identifier)) {
    return null;
  }

  const [first, second] = identifiers as [
    { value: string; quoted: boolean },
    { value: string; quoted: boolean } | undefined,
  ];
  const schema = second ? first.value : undefined;
  const schemaUpper = second
    ? normalizeOracleIdentifierForLookup(first)
    : undefined;
  const tableIdentifier = second ?? first;
  const table = tableIdentifier.value;
  const tableUpper = normalizeOracleIdentifierForLookup(tableIdentifier);
  return {
    schema,
    schemaUpper,
    table,
    tableUpper,
    qualifiedName: schema ? `${schema}.${table}` : table,
  };
}

function splitOracleQualifiedIdentifier(target: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < target.length; index += 1) {
    const char = target[index];
    const next = target[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '""';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === "." && !quoted) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (quoted) {
    return [];
  }

  parts.push(current.trim());
  return parts;
}

function parseOracleIdentifier(
  identifier: string,
): { value: string; quoted: boolean } | null {
  if (!identifier) {
    return null;
  }

  if (identifier.startsWith('"') || identifier.endsWith('"')) {
    if (!/^"(?:[^"]|"")+"$/.test(identifier)) {
      return null;
    }
    return {
      value: identifier.slice(1, -1).replace(/""/g, '"'),
      quoted: true,
    };
  }

  if (!/^[A-Za-z_][\w$#]*$/.test(identifier)) {
    return null;
  }

  return { value: identifier, quoted: false };
}

function normalizeOracleIdentifierForLookup(identifier: {
  value: string;
  quoted: boolean;
}): string {
  return identifier.quoted ? identifier.value : identifier.value.toUpperCase();
}

function selectRelevantSchemas(
  schemas: string[],
  connection: DatabaseConnection,
): string[] {
  const selected = (connection.database || connection.schema || "").trim();
  if (selected && schemas.includes(selected)) {
    return [selected];
  }

  return schemas.filter(
    (schema) =>
      !["information_schema", "mysql", "performance_schema", "sys"].includes(
        schema.toLowerCase(),
      ),
  );
}

function selectRelevantPostgresSchemas(
  schemas: string[],
  connection: DatabaseConnection,
): string[] {
  const selected = (connection.schema || "").trim();
  if (selected && schemas.includes(selected)) {
    return [selected];
  }

  return schemas.filter((schema) => {
    const normalized = schema.toLowerCase();
    return (
      normalized !== "information_schema" &&
      normalized !== "pg_catalog" &&
      !normalized.startsWith("pg_toast") &&
      !normalized.startsWith("pg_temp_")
    );
  });
}

function selectRelevantOracleSchemas(
  schemas: string[],
  connection: DatabaseConnection,
): string[] {
  const selected = (
    connection.database ||
    connection.schema ||
    connection.serviceName ||
    connection.sid ||
    ""
  )
    .trim()
    .toUpperCase();
  if (selected && schemas.includes(selected)) {
    return [selected];
  }

  const userSchema = connection.user.trim().toUpperCase();
  if (userSchema && schemas.includes(userSchema)) {
    return [userSchema];
  }

  return schemas.filter(
    (schema) =>
      ![
        "ANONYMOUS",
        "APEX_PUBLIC_USER",
        "APPQOSSYS",
        "AUDSYS",
        "CTXSYS",
        "DBSNMP",
        "DIP",
        "GGSYS",
        "GSMADMIN_INTERNAL",
        "MDSYS",
        "OJVMSYS",
        "OLAPSYS",
        "ORDDATA",
        "ORDSYS",
        "OUTLN",
        "SYS",
        "SYSBACKUP",
        "SYSDG",
        "SYSKM",
        "SYSRAC",
        "SYSTEM",
        "WMSYS",
        "XDB",
      ].includes(schema.toUpperCase()),
  );
}

function createEmptyDatabaseMetadata(schemas: string[] = []): DatabaseMetadata {
  return {
    schemas,
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

function qualifyDatabaseObject(schema: unknown, name: unknown): string {
  const schemaName = String(schema ?? "");
  const objectName = String(name ?? "");
  return schemaName ? `${schemaName}.${objectName}` : objectName;
}

function createColumnMetadata(row: RowDataPacket): Array<{
  label: string;
  value: string;
}> {
  return [
    { label: "Type", value: String(row.columnType ?? "") },
    { label: "Key", value: String(row.columnKey || "None") },
    {
      label: "Null",
      value:
        String(row.isNullable).toUpperCase() === "YES"
          ? "Nullable"
          : "Not nullable",
    },
    {
      label: "Default",
      value: row.columnDefault == null ? "None" : String(row.columnDefault),
    },
    { label: "Comment", value: String(row.columnComment || "No comment") },
    ...(row.extra ? [{ label: "Extra", value: String(row.extra) }] : []),
  ].filter((item) => item.value !== "");
}

function createPostgresColumnMetadata(row: Record<string, unknown>): Array<{
  label: string;
  value: string;
}> {
  return [
    { label: "Type", value: formatPostgresDataType(row) },
    {
      label: "Null",
      value:
        String(row.is_nullable).toUpperCase() === "YES"
          ? "Nullable"
          : "Not nullable",
    },
    {
      label: "Default",
      value: row.column_default == null ? "None" : String(row.column_default),
    },
  ].filter((item) => item.value !== "");
}

function formatPostgresDataType(row: Record<string, unknown>): string {
  const dataType = String(row.data_type ?? row.udt_name ?? "");
  const udtName = String(row.udt_name ?? "");
  const characterLength = row.character_maximum_length;
  const numericPrecision = row.numeric_precision;
  const numericScale = row.numeric_scale;

  if (
    ["character varying", "character", "bit varying", "bit"].includes(
      dataType,
    ) &&
    characterLength !== null &&
    characterLength !== undefined
  ) {
    return `${dataType}(${String(characterLength)})`;
  }

  if (
    ["numeric", "decimal"].includes(dataType) &&
    numericPrecision !== null &&
    numericPrecision !== undefined
  ) {
    return numericScale !== null && numericScale !== undefined
      ? `${dataType}(${String(numericPrecision)},${String(numericScale)})`
      : `${dataType}(${String(numericPrecision)})`;
  }

  return dataType === "USER-DEFINED" && udtName ? udtName : dataType;
}

function formatPostgresIndexType(row: Record<string, unknown>): string {
  if (row.indisprimary === true) {
    return "PRIMARY";
  }
  const indexType = String(row.index_type || "INDEX").toUpperCase();
  return row.indisunique === true ? `UNIQUE ${indexType}` : indexType;
}

function createOracleColumnMetadata(row: Record<string, unknown>): Array<{
  label: string;
  value: string;
}> {
  return [
    { label: "Type", value: formatOracleDataType(row) },
    {
      label: "Null",
      value:
        String(row.NULLABLE).toUpperCase() === "Y"
          ? "Nullable"
          : "Not nullable",
    },
    {
      label: "Default",
      value: row.DATA_DEFAULT == null ? "None" : String(row.DATA_DEFAULT),
    },
  ].filter((item) => item.value !== "");
}

function formatOracleDataType(row: Record<string, unknown>): string {
  const dataType = String(row.DATA_TYPE ?? "");
  const precision = row.DATA_PRECISION;
  const scale = row.DATA_SCALE;
  const charLength = row.CHAR_LENGTH;
  const dataLength = row.DATA_LENGTH;
  if (["CHAR", "NCHAR", "VARCHAR2", "NVARCHAR2"].includes(dataType)) {
    const length = charLength ?? dataLength;
    return length ? `${dataType}(${String(length)})` : dataType;
  }
  if (dataType === "NUMBER" && precision !== null && precision !== undefined) {
    return scale !== null && scale !== undefined
      ? `NUMBER(${String(precision)},${String(scale)})`
      : `NUMBER(${String(precision)})`;
  }
  if (["FLOAT", "RAW"].includes(dataType) && dataLength) {
    return `${dataType}(${String(dataLength)})`;
  }
  return dataType;
}

function normalizeOracleObjectRow(
  row: Record<string, unknown> | unknown[],
): Record<string, unknown> {
  return Array.isArray(row) ? {} : row;
}

function normalizeOracleRow(
  row: Record<string, unknown> | unknown[],
): Record<string, DatabaseQueryValue> {
  if (Array.isArray(row)) {
    return {};
  }
  const normalized: Record<string, DatabaseQueryValue> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = normalizeOracleValue(value);
  }
  return normalized;
}

function normalizeOracleValue(value: unknown): DatabaseQueryValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return `0x${value.toString("hex")}`;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return JSON.stringify(value);
}

function formatOracleResultColumnType(
  field: OracleColumnMetadata,
): string | undefined {
  if (field.dbTypeName) {
    return field.dbTypeName;
  }
  if (field.fetchType) {
    return String(field.fetchType);
  }
  return undefined;
}

function normalizeMysqlRow(
  row: RowDataPacket,
): Record<string, DatabaseQueryValue> {
  const normalized: Record<string, DatabaseQueryValue> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = normalizeMysqlValue(value);
  }
  return normalized;
}

function normalizeMysqlValue(value: unknown): DatabaseQueryValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return `0x${value.toString("hex")}`;
  }
  return JSON.stringify(value);
}

function normalizePostgresRow(
  row: Record<string, unknown>,
): Record<string, DatabaseQueryValue> {
  const normalized: Record<string, DatabaseQueryValue> = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = normalizePostgresValue(value);
  }
  return normalized;
}

function normalizePostgresValue(value: unknown): DatabaseQueryValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return `0x${value.toString("hex")}`;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return JSON.stringify(value);
}

const POSTGRES_TYPE_NAME_BY_OID = createPostgresTypeNameByOid();

function createPostgresTypeNameByOid(): Map<number, string> {
  const oidByName = postgresDriver.types?.builtins ?? {};
  return new Map(
    Object.entries(oidByName).map(([name, oid]) => [
      Number(oid),
      name.toLowerCase(),
    ]),
  );
}

function formatPostgresResultColumnType(
  field: PostgresField,
): string | undefined {
  return POSTGRES_TYPE_NAME_BY_OID.get(field.dataTypeID);
}

function isPostgresRowsAffectedCommand(command?: string): boolean {
  const normalized = command?.trim().toUpperCase() ?? "";
  return Boolean(
    normalized && !["SELECT", "SHOW", "WITH"].includes(normalized),
  );
}

function isResultSetHeader(value: unknown): value is ResultSetHeader {
  return (
    value !== null &&
    typeof value === "object" &&
    "affectedRows" in value &&
    typeof (value as { affectedRows?: unknown }).affectedRows === "number"
  );
}

function formatMysqlColumnType(field: FieldPacket): string | undefined {
  const columnType = field.columnType;
  if (columnType === undefined) {
    return undefined;
  }

  const typeName = MYSQL_COLUMN_TYPE_NAMES[columnType];
  if (!typeName) {
    return undefined;
  }

  const columnLength = field.columnLength ?? 0;

  if (["varchar", "varbinary"].includes(typeName) && columnLength > 0) {
    const length =
      field.characterSet === 63
        ? columnLength
        : columnLength % 4 === 0
          ? columnLength / 4
          : columnLength;
    return `${typeName}(${length})`;
  }

  if (["decimal", "newdecimal"].includes(typeName) && field.decimals > 0) {
    return `decimal(${columnLength},${field.decimals})`;
  }

  return typeName === "newdecimal" ? "decimal" : typeName;
}

const MYSQL_COLUMN_TYPE_NAMES: Record<number, string> = {
  0: "decimal",
  1: "tinyint",
  2: "smallint",
  3: "int",
  4: "float",
  5: "double",
  6: "null",
  7: "timestamp",
  8: "bigint",
  9: "mediumint",
  10: "date",
  11: "time",
  12: "datetime",
  13: "year",
  15: "varchar",
  16: "bit",
  245: "json",
  246: "newdecimal",
  247: "enum",
  248: "set",
  249: "tinyblob",
  250: "mediumblob",
  251: "longblob",
  252: "text",
  253: "varchar",
  254: "char",
  255: "geometry",
};

function normalizeBuildSortKey(
  value: BuildQuerySortKey | undefined,
): BuildQuerySortKey {
  if (
    value === "id" ||
    value === "branch" ||
    value === "commit" ||
    value === "profile" ||
    value === "status" ||
    value === "duration" ||
    value === "completed"
  ) {
    return value;
  }

  return "completed";
}

function buildOrderExpression(sortBy: BuildQuerySortKey): string {
  switch (sortBy) {
    case "id":
      return "id";
    case "branch":
      return "lower(branch)";
    case "commit":
      return "lower(commit_hash)";
    case "profile":
      return "lower(button_name)";
    case "status":
      return "status";
    case "duration":
      return "COALESCE(duration_seconds, 0)";
    case "completed":
      return "datetime(COALESCE(completed_at, started_at))";
  }
}

function normalizeBuildStatus(
  value: BuildQueryOptions["status"],
): string | null {
  if (value === "Running") {
    return "running";
  }
  if (value === "Success") {
    return "success";
  }
  if (value === "Failed") {
    return "failed";
  }
  if (value === "Stopped") {
    return "stopped";
  }
  return null;
}

const UVICORN_ACCESS_REGEX =
  /^(?:INFO[:\s]+)?\s*([\d.]+|[a-f0-9:]+|\[[^\]]+\]):\d+\s*-\s*"([A-Z]+)\s+(\S+)\s+HTTP\/[\d.]+"\s+(\d{3})/i;
const COMMON_LOG_REGEX =
  /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"([A-Z]+)\s+(\S+)\s+HTTP\/[\d.]+"\s+(\d{3})\s+(\S+)/;
const DJANGO_ACCESS_REGEX =
  /\[(\d{2}\/[A-Za-z]+\/\d{4}\s+\d{2}:\d{2}:\d{2})\]\s+"([A-Z]+)\s+(\S+)\s+HTTP\/[\d.]+"\s+(\d{3})/;

type ParsedAccessLog = {
  capturedAt?: string;
  method: string;
  path: string;
  status: number;
  durationMs: number | null;
  source: string;
};

function parseAccessLogLine(line: string): ParsedAccessLog | null {
  const stripped = line.replace(/\u001b\[[0-9;]*m/g, "");

  const uvicorn = UVICORN_ACCESS_REGEX.exec(stripped);
  if (uvicorn) {
    return {
      method: uvicorn[2].toUpperCase(),
      path: uvicorn[3],
      status: Number.parseInt(uvicorn[4], 10),
      durationMs: null,
      source: uvicorn[1],
    };
  }

  const common = COMMON_LOG_REGEX.exec(stripped);
  if (common) {
    return {
      capturedAt: parseCommonLogDate(common[2]),
      method: common[3].toUpperCase(),
      path: common[4],
      status: Number.parseInt(common[5], 10),
      durationMs: null,
      source: common[1],
    };
  }

  const django = DJANGO_ACCESS_REGEX.exec(stripped);
  if (django) {
    return {
      capturedAt: parseCommonLogDate(django[1]),
      method: django[2].toUpperCase(),
      path: django[3],
      status: Number.parseInt(django[4], 10),
      durationMs: null,
      source: "",
    };
  }

  return null;
}

function parseCommonLogDate(value: string): string | undefined {
  // Examples: "22/May/2026 10:00:00" or "22/May/2026:10:00:00 +0000"
  const match =
    /^(\d{2})\/([A-Za-z]+)\/(\d{4})[\s:](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return undefined;
  const months: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const month = months[match[2] as keyof typeof months];
  if (month === undefined) return undefined;
  const date = new Date(
    Number(match[3]),
    month,
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function compareApiFetchValues(
  a: ApiFetchRecord,
  b: ApiFetchRecord,
  sortBy: NonNullable<ApiFetchQueryOptions["sortBy"]>,
): number {
  switch (sortBy) {
    case "status":
      return (a.status ?? 0) - (b.status ?? 0);
    case "durationMs":
      return (a.durationMs ?? 0) - (b.durationMs ?? 0);
    case "capturedAt":
      return (
        new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime()
      );
    case "method":
      return a.method.localeCompare(b.method);
    case "path":
      return a.path.localeCompare(b.path);
    case "source":
      return a.source.localeCompare(b.source);
    default:
      return 0;
  }
}

function formatBuildRow(row: BuildRow): RecentBuildRecord {
  return {
    id: `#${row.id}`,
    branch: row.branch || "unavailable",
    commit: row.commit_hash || "unavailable",
    commitCleanliness: normalizeCommitCleanliness(row.commit_cleanliness),
    profile: row.button_name || row.profile_name,
    status:
      row.status === "success"
        ? "Success"
        : row.status === "failed"
          ? "Failed"
          : row.status === "stopped"
            ? "Stopped"
            : "Running",
    duration:
      row.duration_seconds === null
        ? "Running"
        : formatDuration(row.duration_seconds),
    completed: formatDate(row.completed_at ?? row.started_at),
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    outcomeType: row.outcome_type,
  };
}

function buildCleanlinessFromGitStatus(
  git: GitStatusRecord,
): RecentBuildRecord["commitCleanliness"] {
  if (git.commit === "unavailable" || git.branch === "unavailable") {
    return "unknown";
  }

  return git.status === "Clean" ? "clean" : "dirty";
}

function normalizeCommitCleanliness(
  value: string,
): RecentBuildRecord["commitCleanliness"] {
  if (value === "clean" || value === "dirty") {
    return value;
  }
  return "unknown";
}

function environmentFromProfile(profile: string): string {
  const normalized = profile.toLowerCase();
  if (normalized === "prod" || normalized === "production") {
    return "Production";
  }
  if (normalized === "sit") {
    return "SIT";
  }
  return "Local";
}

function splitCommand(value: string): string[] {
  const matches = value.match(/"([^"]+)"|'([^']+)'|[^\s]+/g) ?? [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ""));
}

function quote(value: string): string {
  return value.includes(" ") ? `"${value}"` : value;
}

function validateProjectIdentity(name: string, code: string): string[] {
  const errors: string[] = [];
  if (!name) {
    errors.push("Project name is required");
  } else if (name.length > 16) {
    errors.push("Project name must be 16 characters or fewer");
  }

  if (!code) {
    errors.push("Project tag is required");
  } else if (code.length > 3) {
    errors.push("Project tag must be 3 characters or fewer");
  }

  return errors;
}

function validateMavenConfig(
  settings: ProjectSettingsRecord["maven"],
): string[] {
  const errors: string[] = [];
  const executable = settings.executable.trim();
  const settingsXml = settings.settingsXml.trim();
  const pomXml = settings.pomXml.trim();

  if (!executable) {
    errors.push("Maven executable is required");
  } else if (!isExistingFile(executable)) {
    errors.push(`Maven executable does not exist: ${executable}`);
  }

  if (!settingsXml) {
    errors.push("Maven settings.xml is required");
  } else if (!isExistingFile(settingsXml)) {
    errors.push(`Maven settings.xml does not exist: ${settingsXml}`);
  }

  if (!pomXml) {
    errors.push("Maven pom.xml is required");
  } else if (!isExistingFile(pomXml)) {
    errors.push(`Maven pom.xml does not exist: ${pomXml}`);
  }

  return errors;
}

type ProjectEnvRootDescriptor = Omit<ProjectEnvFileGroup, "files">;

function getProjectEnvRootDescriptors(
  settings: ProjectSettingsRecord,
): ProjectEnvRootDescriptor[] {
  const descriptors: ProjectEnvRootDescriptor[] = [];
  const seenRoots = new Set<string>();

  function add(scope: ProjectEnvScope, label: string, rootPath: string): void {
    const trimmedRoot = rootPath.trim();
    if (!trimmedRoot || seenRoots.has(`${scope}:${trimmedRoot}`)) {
      return;
    }
    seenRoots.add(`${scope}:${trimmedRoot}`);
    descriptors.push({ scope, label, rootPath: trimmedRoot });
  }

  if (isProjectFrontendEnabled(settings)) {
    add(
      "frontend",
      "Frontend",
      settings.services.frontend.workingDirectory ||
        settings.frontend.path ||
        "",
    );
  }

  if (settings.backendType === "python") {
    add(
      "backend",
      "Backend",
      settings.python.directory ||
        settings.services.python.workingDirectory ||
        "",
    );
    return descriptors;
  }

  const pomXml = settings.maven.pomXml.trim();
  add(
    "backend",
    "Backend",
    settings.gitProjectDirectory ||
      (pomXml ? dirname(pomXml) : "") ||
      settings.services.wildfly.workingDirectory ||
      "",
  );
  return descriptors;
}

function readProjectEnvFiles(rootPath: string): ProjectEnvFileRecord[] {
  if (!isExistingDirectory(rootPath)) {
    return [];
  }

  return readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isEnvFileName(entry.name))
    .map((entry) => readProjectEnvFile(join(rootPath, entry.name)))
    .sort((a, b) =>
      envFileSortKey(a.name).localeCompare(envFileSortKey(b.name)),
    );
}

function readProjectEnvFile(filePath: string): ProjectEnvFileRecord {
  return {
    path: filePath,
    name: basename(filePath),
    variables: parseEnvVariables(readFileSync(filePath, "utf8")),
  };
}

function isEnvFileName(name: string): boolean {
  return /^\.env(?:$|[._-].+)/.test(name);
}

function envFileSortKey(name: string): string {
  return name === ".env" ? "" : name;
}

function parseEnvVariables(content: string): ProjectEnvVariable[] {
  return splitEnvLines(content).lines.flatMap((line, lineIndex) => {
    const parsed = parseEnvLine(line);
    return parsed
      ? [{ lineIndex, name: parsed.name, value: readEnvValue(parsed.rawValue) }]
      : [];
  });
}

function updateEnvContent(
  content: string,
  variables: ProjectEnvVariable[],
): string {
  const { lines, lineBreak, trailingLineBreak } = splitEnvLines(content);
  const updates = new Map(
    variables.map((variable) => [variable.lineIndex, variable]),
  );
  const nextLines = lines.map((line, lineIndex) => {
    const update = updates.get(lineIndex);
    const parsed = parseEnvLine(line);
    if (!update || !parsed || parsed.name !== update.name) {
      return line;
    }

    return replaceEnvLineValue(line, update.value);
  });

  return nextLines.join(lineBreak) + (trailingLineBreak ? lineBreak : "");
}

function splitEnvLines(content: string): {
  lines: string[];
  lineBreak: string;
  trailingLineBreak: boolean;
} {
  const lineBreak = content.includes("\r\n") ? "\r\n" : "\n";
  const trailingLineBreak = /\r?\n$/.test(content);
  const lines = content.split(/\r?\n/);
  if (trailingLineBreak) {
    lines.pop();
  }
  return { lines, lineBreak, trailingLineBreak };
}

function parseEnvLine(line: string): {
  name: string;
  rawValue: string;
} | null {
  const match = line.match(
    /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/,
  );
  if (!match) {
    return null;
  }

  return { name: match[1], rawValue: match[2] };
}

function readEnvValue(rawValue: string): string {
  const { valuePart } = splitEnvValueAndComment(rawValue);
  const trimmed = valuePart.trim();
  const quote = trimmed[0];
  if (
    (quote === `"` || quote === `'`) &&
    trimmed.length >= 2 &&
    trimmed[trimmed.length - 1] === quote
  ) {
    const inner = trimmed.slice(1, -1);
    return quote === `"` ? inner.replace(/\\"/g, `"`) : inner;
  }

  return trimmed;
}

function replaceEnvLineValue(line: string, nextValue: string): string {
  const match = line.match(
    /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=)(.*)$/,
  );
  if (!match) {
    return line;
  }

  const rawValue = match[2];
  const leadingWhitespace = rawValue.match(/^\s*/)?.[0] ?? "";
  const { valuePart, commentPart } = splitEnvValueAndComment(rawValue);
  const trimmedValue = valuePart.trim();
  const quote = trimmedValue[0];
  const formattedValue =
    (quote === `"` || quote === `'`) &&
    trimmedValue.length >= 2 &&
    trimmedValue[trimmedValue.length - 1] === quote
      ? `${quote}${formatQuotedEnvValue(nextValue, quote)}${quote}`
      : nextValue;

  return `${match[1]}${leadingWhitespace}${formattedValue}${commentPart}`;
}

function splitEnvValueAndComment(rawValue: string): {
  valuePart: string;
  commentPart: string;
} {
  const commentMatch = rawValue.match(/(\s+#.*)$/);
  if (!commentMatch || commentMatch.index === undefined) {
    return { valuePart: rawValue, commentPart: "" };
  }

  return {
    valuePart: rawValue.slice(0, commentMatch.index),
    commentPart: commentMatch[1],
  };
}

function formatQuotedEnvValue(value: string, quote: string): string {
  return quote === `"`
    ? value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    : value;
}

function isExistingFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function isExistingDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function slugifyProjectId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function settingsActivityEntries(
  previous: ProjectSettingsRecord,
  next: ProjectSettingsRecord,
): SettingsActivityEntry[] {
  const entries: SettingsActivityEntry[] = [];

  const add = (
    title: string,
    meta: string,
    tone: ActivityTone = "info",
  ): void => {
    entries.push({ title, meta, tone });
  };
  const addIfChanged = (
    before: string | undefined,
    after: string | undefined,
    title: string,
    meta: string,
  ): void => {
    if ((before ?? "") !== (after ?? "")) {
      add(title, meta);
    }
  };

  addIfChanged(
    previous.appLogFile,
    next.appLogFile,
    "Project settings updated",
    "Application log file updated",
  );
  addIfChanged(
    previous.gitProjectDirectory,
    next.gitProjectDirectory,
    "Git settings updated",
    "Git project directory updated",
  );
  addIfChanged(
    previous.defaultBranch,
    next.defaultBranch,
    "Git settings updated",
    "Default branch updated",
  );
  addIfChanged(
    previous.remote,
    next.remote,
    "Git settings updated",
    "Git remote updated",
  );

  addIfChanged(
    previous.maven.executable,
    next.maven.executable,
    "Maven settings updated",
    "Maven executable path updated",
  );
  addIfChanged(
    previous.maven.settingsXml,
    next.maven.settingsXml,
    "Maven settings updated",
    "settings.xml path updated",
  );
  addIfChanged(
    previous.maven.pomXml,
    next.maven.pomXml,
    "Maven settings updated",
    "pom.xml path updated",
  );
  if (previous.maven.skipTests !== next.maven.skipTests) {
    add(
      "Maven settings updated",
      `Skip tests turned ${next.maven.skipTests ? "on" : "off"}`,
    );
  }

  for (const service of [
    "frontend",
    getProjectBackendServiceName(next),
  ] as ServiceName[]) {
    const before = previous.services[service];
    const after = next.services[service];
    const label = serviceLabel(service);
    const title = `${label} settings updated`;

    addIfChanged(
      before.workingDirectory,
      after.workingDirectory,
      title,
      `${label} working directory updated`,
    );
    addIfChanged(
      before.command,
      after.command,
      title,
      `${label} command updated`,
    );
    addIfChanged(
      before.healthUrl,
      after.healthUrl,
      title,
      `${label} health URL updated`,
    );

    if (service === "frontend") {
      addIfChanged(
        before.appUrl,
        after.appUrl,
        title,
        "Frontend app URL updated",
      );
    } else if (service === "wildfly") {
      addIfChanged(
        before.appUrl,
        after.appUrl,
        title,
        "WildFly KMU URL updated",
      );
      addIfChanged(
        before.managementUrl,
        after.managementUrl,
        title,
        "WildFly admin console URL updated",
      );
    } else {
      addIfChanged(
        before.appUrl,
        after.appUrl,
        title,
        "Python app URL updated",
      );
    }

    if ((before.autoStart ?? false) !== (after.autoStart ?? false)) {
      add(
        title,
        `${label} auto start turned ${(after.autoStart ?? false) ? "on" : "off"}`,
      );
    }
  }

  const previousProfiles = new Map(
    previous.buildProfiles.map((profile) => [profile.id, profile]),
  );
  const nextProfiles = new Map(
    next.buildProfiles.map((profile) => [profile.id, profile]),
  );

  for (const profile of next.buildProfiles) {
    const before = previousProfiles.get(profile.id);
    if (!before) {
      add(
        "Build profile added",
        `Profile "${profileDisplayName(profile)}" added`,
        "success",
      );
      continue;
    }

    if (buildProfileChanged(before, profile)) {
      if (
        before.buttonName !== profile.buttonName &&
        profileChangeCount(before, profile) === 1
      ) {
        add(
          "Build profile renamed",
          `Profile "${profileDisplayName(before)}" renamed to "${profileDisplayName(profile)}"`,
        );
      } else {
        add(
          "Build profile updated",
          `Profile "${profileDisplayName(profile)}" updated`,
        );
      }
    }
  }

  for (const profile of previous.buildProfiles) {
    if (!nextProfiles.has(profile.id)) {
      add(
        "Build profile deleted",
        `Profile "${profileDisplayName(profile)}" deleted`,
        "failed",
      );
    }
  }

  return entries.length > 0
    ? entries
    : [
        {
          title: "Settings saved",
          meta: "No setting changes detected",
          tone: "neutral",
        },
      ];
}

function profileDisplayName(profile: BuildProfileRecord): string {
  return profile.buttonName.trim() || profile.profileName.trim() || "Unnamed";
}

function buildProfileChanged(
  previous: BuildProfileRecord,
  next: BuildProfileRecord,
): boolean {
  return profileChangeCount(previous, next) > 0;
}

function profileChangeCount(
  previous: BuildProfileRecord,
  next: BuildProfileRecord,
): number {
  return (
    Number(previous.buttonName !== next.buttonName) +
    Number(previous.profileName !== next.profileName) +
    Number(previous.goals !== next.goals) +
    Number(previous.confirm !== next.confirm) +
    Number(previous.outcomeType !== next.outcomeType)
  );
}

function readPythonDependencies(
  python: PythonWebServerConfig,
): PythonDependencyRecord[] {
  const projectDirectory = python.directory.trim();
  if (!projectDirectory || !existsSync(projectDirectory)) {
    return [];
  }

  try {
    if (!statSync(projectDirectory).isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  for (const executable of pythonExecutableCandidates(
    projectDirectory,
    python.venvPath,
  )) {
    const result = spawnSync(executable, ["-m", "pip", "freeze"], {
      cwd: projectDirectory,
      windowsHide: true,
      encoding: "utf8",
      timeout: 10000,
    });

    if (result.error || result.status !== 0) {
      continue;
    }

    return parseRequirementsDependencies(
      (result.stdout as string) ?? "",
      "python -m pip freeze",
    )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 200);
  }

  return [];
}

function pythonExecutableCandidates(
  projectDirectory: string,
  venvPath: string | undefined,
): string[] {
  const candidates: string[] = [];
  for (const venv of pythonVenvCandidates(projectDirectory, venvPath)) {
    const executable = join(
      venv,
      process.platform === "win32" ? "Scripts" : "bin",
      process.platform === "win32" ? "python.exe" : "python",
    );
    if (existsSync(executable)) {
      candidates.push(executable);
    }
  }

  candidates.push("python");
  if (process.platform !== "win32") {
    candidates.push("python3");
  }

  return [...new Set(candidates)];
}

function pythonVenvCandidates(
  projectDirectory: string,
  venvPath: string | undefined,
): string[] {
  const candidates: string[] = [];
  const normalizedVenvPath = (venvPath ?? "").trim().replace(/[\\/]+$/, "");
  if (normalizedVenvPath) {
    candidates.push(
      isAbsolute(normalizedVenvPath)
        ? normalizedVenvPath
        : join(projectDirectory, normalizedVenvPath),
    );
  }

  candidates.push(
    join(projectDirectory, ".venv"),
    join(projectDirectory, "venv"),
  );
  return [...new Set(candidates)];
}

function parseRequirementsDependencies(
  content: string,
  source: string,
): PythonDependencyRecord[] {
  return content
    .split(/\r?\n/)
    .map((line) => parseRequirementSpec(line, source))
    .filter((dependency): dependency is PythonDependencyRecord =>
      Boolean(dependency),
    );
}

function parseRequirementSpec(
  value: string,
  source: string,
): PythonDependencyRecord | null {
  const cleaned = value
    .replace(/\s+#.*$/, "")
    .split(";")[0]
    .trim();
  const editable = cleaned.match(/^-e\s+.+[#&]egg=([A-Za-z0-9_.-]+)/iu);
  if (editable) {
    return {
      name: normalizePythonDependencyName(editable[1]),
      version: "Editable install",
      source,
    };
  }

  if (
    !cleaned ||
    cleaned.startsWith("#") ||
    cleaned.startsWith("-") ||
    /^https?:\/\//i.test(cleaned) ||
    /^git\+/i.test(cleaned)
  ) {
    return null;
  }

  const directReference = cleaned.match(
    /^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*@\s*(.+)$/u,
  );
  if (directReference) {
    return {
      name: normalizePythonDependencyName(directReference[1]),
      version: "Direct reference",
      source,
    };
  }

  const versioned = cleaned.match(
    /^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*((?:===|==|~=|!=|<=|>=|<|>).+)$/u,
  );
  if (versioned) {
    return {
      name: normalizePythonDependencyName(versioned[1]),
      version: versioned[2].trim(),
      source,
    };
  }

  const nameOnly = cleaned.match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?$/u);
  if (!nameOnly) {
    return null;
  }

  return {
    name: normalizePythonDependencyName(nameOnly[1]),
    version: "Unpinned",
    source,
  };
}

function normalizePythonDependencyName(name: string): string {
  return name.trim().replace(/[-_.]+/g, "-");
}

function serviceProcessKey(projectId: string, service: ServiceName): string {
  return `${projectId}:${service}`;
}

function logKey(projectId: string, channel: LogChannel): string {
  return `${projectId}:${channel}`;
}

function stamp(message: string): string {
  return `${new Date().toTimeString().slice(0, 8)} ${message}`;
}

function serviceLabel(service: ServiceName): string {
  if (service === "wildfly") {
    return "WildFly";
  }
  if (service === "python") {
    return "Python";
  }
  return "Frontend";
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatDurationMs(durationMs: number): string {
  return `${Math.max(1, durationMs).toFixed(1)} ms`;
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function pythonServerStartCommand(command: string): string {
  if (process.platform === "win32") {
    return `.\\venv\\Scripts\\activate && ${command}`;
  }

  return `. venv/bin/activate && ${command}`;
}

function createServiceEnvironment(service: ServiceName): NodeJS.ProcessEnv {
  const pathKey = getPathEnvironmentKey();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
  };
  env[pathKey] = createServicePath(process.env[pathKey]);

  if (service === "python") {
    // Python's stdout/stderr is block-buffered when not attached to a TTY,
    // which hides uvicorn/flask/django access logs until the buffer flushes.
    // Force line-buffered output and UTF-8 so request logs stream live.
    env.PYTHONUNBUFFERED = "1";
    env.PYTHONIOENCODING = "utf-8";
  }

  return env;
}

function createServicePath(currentPath: string | undefined): string {
  const entries = [
    ...servicePathCandidates(),
    ...(currentPath?.split(delimiter).filter(Boolean) ?? []),
  ];
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      if (!entry || seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    })
    .join(delimiter);
}

function getPathEnvironmentKey(): string {
  return (
    Object.keys(process.env).find((key) => key.toLowerCase() === "path") ??
    "PATH"
  );
}

function servicePathCandidates(): string[] {
  if (process.platform === "win32") {
    return [];
  }

  const home = userInfo().homedir;
  return existingDirectories([
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    join(home, ".volta", "bin"),
    join(home, ".asdf", "shims"),
    join(home, ".asdf", "bin"),
    join(home, ".fnm"),
    join(home, ".bun", "bin"),
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    ...nvmNodeBinCandidates(home),
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ]);
}

function nvmNodeBinCandidates(home: string): string[] {
  const versionsDir = join(home, ".nvm", "versions", "node");
  try {
    return readdirSync(versionsDir)
      .map((version) => join(versionsDir, version, "bin"))
      .filter((candidate) => isExistingDirectory(candidate))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function existingDirectories(paths: string[]): string[] {
  return paths.filter((path) => isExistingDirectory(path));
}

function killProcessByPort(port: number): void {
  if (process.platform !== "win32") {
    return;
  }
  const result = spawnSync("cmd", ["/c", `netstat -ano | findstr :${port}`], {
    windowsHide: true,
    encoding: "utf8",
  });
  const output = (result.stdout as unknown as string) ?? "";
  const pids = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    // Format: Proto  Local Address  Foreign Address  State  PID
    if (parts.length >= 5 && parts[1].endsWith(`:${port}`)) {
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) {
        pids.add(pid);
      }
    }
  }
  for (const pid of pids) {
    spawnSync("taskkill", ["/pid", pid, "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }

  child.kill("SIGTERM");
}

function terminateProcessTreeAsync(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    if (process.platform === "win32" && child.pid) {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/T", "/F"],
        {
          windowsHide: true,
          stdio: "ignore",
        },
      );
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    } else {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    }
  });
}

function spawnCollect(
  command: string,
  args: string[],
  cwd: string,
): Promise<string[]> {
  return new Promise((resolvePromise) => {
    const lines: string[] = [stamp(`$ ${command} ${args.join(" ")}`)];
    const child = spawn(command, args, { cwd, windowsHide: true });
    child.stdout.on("data", (chunk: Buffer) => {
      lines.push(...chunk.toString().split(/\r?\n/).filter(Boolean).map(stamp));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      lines.push(...chunk.toString().split(/\r?\n/).filter(Boolean).map(stamp));
    });
    child.on("error", (error) => {
      lines.push(stamp(error.message));
      resolvePromise(lines);
    });
    child.on("exit", (code) => {
      lines.push(stamp(`git exited with code ${code ?? "unknown"}`));
      resolvePromise(lines);
    });
  });
}

function spawnSyncText(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  return result.stdout.trim();
}
