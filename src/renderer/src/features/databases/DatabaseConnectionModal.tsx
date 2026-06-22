import { useEffect, useState, type ReactNode } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import {
  AppSelect,
  type AppSelectOption,
} from "../../components/common/AppSelect";
import { ConfirmDialog } from "../../components/dialogs/ConfirmDialog";
import { Modal } from "../../components/dialogs/Modal";
import type {
  DatabaseConnection,
  DatabaseConnectionType,
  DatabaseSslMode,
  OracleConnectionMode,
} from "../../types";

export type DatabaseConnectionModalMode = "add" | "edit";

type DatabaseConnectionDraft = {
  id?: string;
  name: string;
  type: DatabaseConnectionType;
  host: string;
  port: string;
  user: string;
  password: string;
  savePassword: boolean;
  autoConnect: boolean;
  connectionTimeoutSeconds: string;
  database: string;
  sslMode: DatabaseSslMode;
  sslCaPath: string;
  sslCertPath: string;
  sslKeyPath: string;
  connectionMode: OracleConnectionMode;
  serviceName: string;
  sid: string;
  connectString: string;
  networkAlias: string;
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

const DEFAULT_CONNECTION_TIMEOUT_SECONDS = "10";

const DATABASE_TYPE_OPTIONS: Array<AppSelectOption<DatabaseConnectionType>> = [
  { value: "MySQL", label: "MySQL", dotColor: "#2563eb" },
  { value: "Oracle", label: "Oracle", dotColor: "#ef4444" },
  { value: "PostgreSQL", label: "PostgreSQL", dotColor: "#14b8a6" },
];

const DATABASE_SSL_OPTIONS: Array<AppSelectOption<DatabaseSslMode>> = [
  { value: "disabled", label: "Disabled", dotColor: "var(--muted)" },
  { value: "preferred", label: "Preferred", dotColor: "var(--info)" },
  { value: "required", label: "Required", dotColor: "var(--error)" },
  { value: "verify-ca", label: "Verify CA", dotColor: "var(--warning)" },
  { value: "verify-full", label: "Verify full", dotColor: "var(--success)" },
];

const ORACLE_CONNECTION_MODES: Array<AppSelectOption<OracleConnectionMode>> = [
  { value: "serviceName", label: "Service name" },
  { value: "sid", label: "SID" },
  { value: "connectString", label: "Connection string" },
  { value: "tnsAlias", label: "TNS alias" },
];

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
    if (mode === "edit") {
      return;
    }

    setDraft((current) => ({
      ...current,
      type,
      port: defaultPortForDatabaseType(type),
      sslMode: type === "Oracle" ? "disabled" : current.sslMode,
      connectionMode:
        type === "Oracle" ? current.connectionMode : "serviceName",
      serviceName: type === "Oracle" ? current.serviceName || "XEPDB1" : "",
      sid: type === "Oracle" ? current.sid : "",
      connectString: type === "Oracle" ? current.connectString : "",
      networkAlias: type === "Oracle" ? current.networkAlias : "",
      role: type === "Oracle" ? current.role : "",
      walletPath: type === "Oracle" ? current.walletPath : "",
      sslCaPath: type === "PostgreSQL" ? current.sslCaPath : "",
      sslCertPath: type === "PostgreSQL" ? current.sslCertPath : "",
      sslKeyPath: type === "PostgreSQL" ? current.sslKeyPath : "",
    }));
    setErrors({});
    setTestState({ status: "idle", message: "" });
  }

  function browseCertificateFile(
    title: string,
    key: "sslCaPath" | "sslCertPath" | "sslKeyPath",
  ): void {
    window.ivsDashboard
      .browsePath({
        kind: "file",
        title,
        defaultPath: draft[key] || undefined,
        filters: [
          {
            name: "Certificates and keys",
            extensions: ["pem", "crt", "cer", "key"],
          },
          { name: "All files", extensions: ["*"] },
        ],
      })
      .then((path) => {
        if (path) {
          updateDraft(key, path);
        }
      })
      .catch((error) => console.error(error));
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

  const isOracleIndirectTarget = isOracleIndirectConnection(draft);

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
                disabled={mode === "edit"}
                ariaLabel="Database type"
              />
            </ConnectionField>
          </div>
        </section>

        <section className="database-connection-section">
          <h3 className="database-connection-section-title">Server</h3>
          <div className="database-connection-form-grid">
            {!isOracleIndirectTarget ? (
              <>
                <ConnectionField label="Host" error={errors.host}>
                  <input
                    type="text"
                    value={draft.host}
                    placeholder="localhost"
                    onChange={(event) =>
                      updateDraft("host", event.target.value)
                    }
                  />
                </ConnectionField>
                <ConnectionField label="Port" error={errors.port}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={draft.port}
                    placeholder="1521"
                    onChange={(event) =>
                      updateDraft("port", event.target.value)
                    }
                  />
                </ConnectionField>
              </>
            ) : null}
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
            <label className="database-connection-checkbox">
              <input
                type="checkbox"
                checked={draft.autoConnect}
                onChange={(event) =>
                  updateDraft("autoConnect", event.target.checked)
                }
              />
              <span>Auto-connect on app start</span>
            </label>
          </div>
        </section>

        {draft.type !== "Oracle" ? (
          <section className="database-connection-section database-specific-fields">
            <h3 className="database-connection-section-title">
              {draft.type} options
            </h3>
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
                  options={DATABASE_SSL_OPTIONS}
                  onChange={(value) => updateDraft("sslMode", value)}
                  ariaLabel="SSL mode"
                />
              </ConnectionField>
              {draft.type === "PostgreSQL" && draft.sslMode !== "disabled" ? (
                <>
                  <ConnectionField label="CA certificate">
                    <CertificatePathField
                      value={draft.sslCaPath}
                      placeholder="Optional CA certificate path"
                      onChange={(value) => updateDraft("sslCaPath", value)}
                      onBrowse={() =>
                        browseCertificateFile(
                          "Select PostgreSQL CA certificate",
                          "sslCaPath",
                        )
                      }
                    />
                  </ConnectionField>
                  <ConnectionField label="Client certificate">
                    <CertificatePathField
                      value={draft.sslCertPath}
                      placeholder="Optional client certificate path"
                      onChange={(value) => updateDraft("sslCertPath", value)}
                      onBrowse={() =>
                        browseCertificateFile(
                          "Select PostgreSQL client certificate",
                          "sslCertPath",
                        )
                      }
                    />
                  </ConnectionField>
                  <ConnectionField label="Client key">
                    <CertificatePathField
                      value={draft.sslKeyPath}
                      placeholder="Optional client key path"
                      onChange={(value) => updateDraft("sslKeyPath", value)}
                      onBrowse={() =>
                        browseCertificateFile(
                          "Select PostgreSQL client key",
                          "sslKeyPath",
                        )
                      }
                    />
                  </ConnectionField>
                </>
              ) : null}
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
              {draft.connectionMode === "tnsAlias" ? (
                <ConnectionField
                  label="Network alias"
                  error={errors.networkAlias}
                >
                  <input
                    type="text"
                    value={draft.networkAlias}
                    placeholder="ORCLPDB1"
                    onChange={(event) =>
                      updateDraft("networkAlias", event.target.value)
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

function CertificatePathField({
  value,
  placeholder,
  onChange,
  onBrowse,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
}): JSX.Element {
  return (
    <span className="database-certificate-path-field">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" onClick={onBrowse}>
        Browse
      </button>
    </span>
  );
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
      autoConnect: connection.autoConnect ?? false,
      connectionTimeoutSeconds: String(
        Math.round((connection.connectionTimeoutMs ?? 10000) / 1000),
      ),
      database: connection.database ?? connection.schema ?? "",
      sslMode: connection.sslMode ?? "disabled",
      sslCaPath: connection.sslCaPath ?? "",
      sslCertPath: connection.sslCertPath ?? "",
      sslKeyPath: connection.sslKeyPath ?? "",
      connectionMode: connection.connectionMode ?? "serviceName",
      serviceName: connection.serviceName ?? connection.schema ?? "",
      sid: connection.sid ?? "",
      connectString: connection.connectString ?? "",
      networkAlias:
        connection.networkAlias ??
        (connection.connectionMode === "tnsAlias"
          ? (connection.connectString ?? connection.schema ?? "")
          : ""),
      role: connection.role ?? "",
      walletPath: connection.walletPath ?? "",
    };
  }

  return {
    name: "",
    type: "MySQL",
    host: "localhost",
    port: defaultPortForDatabaseType("MySQL"),
    user: "",
    password: "",
    savePassword: true,
    autoConnect: false,
    connectionTimeoutSeconds: DEFAULT_CONNECTION_TIMEOUT_SECONDS,
    database: "",
    sslMode: "disabled",
    sslCaPath: "",
    sslCertPath: "",
    sslKeyPath: "",
    connectionMode: "serviceName",
    serviceName: "XEPDB1",
    sid: "",
    connectString: "",
    networkAlias: "",
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
    "autoConnect",
    "connectionTimeoutSeconds",
    "database",
    "sslMode",
    "sslCaPath",
    "sslCertPath",
    "sslKeyPath",
    "connectionMode",
    "serviceName",
    "sid",
    "connectString",
    "networkAlias",
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

  if (!isOracleIndirectConnection(draft)) {
    if (!draft.host.trim()) {
      errors.host = "Required";
    }

    if (!draft.port.trim()) {
      errors.port = "Required";
    } else if (!/^\d+$/.test(draft.port.trim())) {
      errors.port = "Use numbers only";
    }
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
    if (draft.connectionMode === "tnsAlias" && !draft.networkAlias.trim()) {
      errors.networkAlias = "Required";
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
    draft.type === "Oracle"
      ? draft.connectionMode === "sid"
        ? draft.sid.trim()
        : draft.connectionMode === "connectString"
          ? draft.connectString.trim()
          : draft.connectionMode === "tnsAlias"
            ? draft.networkAlias.trim()
            : draft.serviceName.trim()
      : draft.type === "PostgreSQL"
        ? draft.database.trim()
        : draft.database.trim();

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
    autoConnect: draft.autoConnect,
    connectionTimeoutMs: timeoutSeconds * 1000,
    database: draft.database.trim(),
    schema,
    sslMode: draft.sslMode,
    sslCaPath: draft.sslCaPath.trim(),
    sslCertPath: draft.sslCertPath.trim(),
    sslKeyPath: draft.sslKeyPath.trim(),
    connectionMode: draft.connectionMode,
    serviceName: draft.serviceName.trim(),
    sid: draft.sid.trim(),
    connectString: draft.connectString.trim(),
    networkAlias: draft.networkAlias.trim(),
    role: draft.role.trim(),
    walletPath: draft.walletPath.trim(),
    latency: existing?.latency ?? "Not tested",
    uptime: existing?.uptime ?? "Session",
    activeSessions: existing?.activeSessions ?? 1,
  };
}

function isOracleIndirectConnection(draft: DatabaseConnectionDraft): boolean {
  return (
    draft.type === "Oracle" &&
    (draft.connectionMode === "connectString" ||
      draft.connectionMode === "tnsAlias")
  );
}

function defaultPortForDatabaseType(type: DatabaseConnectionType): string {
  if (type === "Oracle") {
    return "1521";
  }
  if (type === "PostgreSQL") {
    return "5432";
  }
  return "3306";
}
