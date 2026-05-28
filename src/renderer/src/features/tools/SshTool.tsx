import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  Eye,
  EyeOff,
  File as FileIcon,
  FileText,
  Folder,
  FolderPlus,
  Home,
  Image,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Settings,
  TerminalSquare,
  Trash2,
  Upload,
} from "lucide-react";
import {
  AppSelect,
  type AppSelectOption,
} from "../../components/common/AppSelect";
import { Panel } from "../../components/common/Panel";
import { ConfirmDialog } from "../../components/dialogs/ConfirmDialog";
import { Modal } from "../../components/dialogs/Modal";
import { FontSizeDropdown } from "../../components/layout/HeaderActions";
import type { FontSizeMode } from "../../types";
import type {
  DirectoryEntry,
  FilePreviewResult,
  SshExecResult,
} from "../../../../shared/dashboardTypes";

export type SshServerConfig = {
  id: string;
  name: string;
  address: string;
  port: number;
  username: string;
  password: string;
  macs: string;
  ciphers: string;
  autoLogin: boolean;
  autoReconnect: boolean;
  maxReconnectAttempts: number;
  reconnectDelayMs: number;
};

export type SshConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "failed"
  | "disconnected"
  | "reconnecting";

export const SSH_RECONNECT_ATTEMPTS_MIN = 0;
export const SSH_RECONNECT_ATTEMPTS_MAX = 10;
export const SSH_RECONNECT_ATTEMPTS_DEFAULT = 3;
export const SSH_RECONNECT_DELAY_MIN_MS = 1000;
export const SSH_RECONNECT_DELAY_MAX_MS = 60000;
export const SSH_RECONNECT_DELAY_DEFAULT_MS = 3000;
export const SSH_PORT_MIN = 1;
export const SSH_PORT_MAX = 65535;
export const SSH_PORT_DEFAULT = 22;

type SftpItem = {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  size: string;
  modified: string;
};

type DirectorySource = "local" | "remote";

export type SshToolTab = "ssh" | "monitor";

type SftpActionMenuState = {
  source: DirectorySource;
  item: SftpItem;
  x?: number;
  y?: number;
} | null;

type SftpNameDialogState = {
  mode: "new-folder" | "rename";
  source: DirectorySource;
  item?: SftpItem;
  value: string;
} | null;

type SftpDeleteState = {
  source: DirectorySource;
  item: SftpItem;
} | null;

type FilePreviewState = {
  source: DirectorySource;
  item: SftpItem;
  loading: boolean;
  result: FilePreviewResult | null;
  error: string | null;
} | null;

type DirectoryActionLogEntry = {
  id: string;
  time: string;
  action: string;
  location: string;
  source: DirectorySource;
  item: string;
  status: "success" | "failed";
  detail: string;
};

type TerminalCommandLogEntry = {
  id: string;
  time: string;
  command: string;
  location: string;
  status: "success" | "failed";
  exitCode: string;
};

type TerminalSuggestion = {
  value: string;
  label: string;
  source: "command" | "path" | "file" | "history";
};

type TransferDragPayload = {
  source: DirectorySource;
  itemId: string;
};

const SSH_SERVERS_STORAGE_KEY = "ivs-ssh-tool-servers";
const SSH_SELECTED_SERVER_STORAGE_KEY = "ivs-ssh-tool-selected-server";
const DEFAULT_SSH_SERVER_ID = "local-dev";
const DEFAULT_SSH_SERVERS: SshServerConfig[] = [
  {
    id: DEFAULT_SSH_SERVER_ID,
    name: "Local Dev",
    address: "127.0.0.1",
    port: SSH_PORT_DEFAULT,
    username: "",
    password: "",
    macs: "",
    ciphers: "",
    autoLogin: false,
    autoReconnect: false,
    maxReconnectAttempts: SSH_RECONNECT_ATTEMPTS_DEFAULT,
    reconnectDelayMs: SSH_RECONNECT_DELAY_DEFAULT_MS,
  },
];
const TERMINAL_DIRECTORY_NAMES = new Set([
  "Desktop",
  "Documents",
  "Downloads",
  "Music",
  "Pictures",
  "Public",
  "snap",
  "Templates",
  "Videos",
]);
const SSH_TERMINAL_ROW_HEIGHT = 20;
const SSH_COMMAND_SUGGESTIONS = [
  "ls",
  "ls -la",
  "ls -ltr",
  "pwd",
  "cd",
  "cat",
  "clear",
  "cp",
  "df -h",
  "du -sh",
  "find",
  "grep",
  "head",
  "less",
  "mkdir",
  "mv",
  "pwd",
  "rm",
  "tail",
  "touch",
  "vim",
];

export function readStoredSshServers(): SshServerConfig[] {
  const stored = window.localStorage.getItem(SSH_SERVERS_STORAGE_KEY);
  if (!stored) {
    return DEFAULT_SSH_SERVERS;
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) {
      return DEFAULT_SSH_SERVERS;
    }
    const servers = parsed
      .map(normalizeStoredServer)
      .filter((server): server is SshServerConfig => server !== null);
    return servers.length > 0 ? servers : DEFAULT_SSH_SERVERS;
  } catch {
    return DEFAULT_SSH_SERVERS;
  }
}

export function storeSshServers(servers: SshServerConfig[]): void {
  window.localStorage.setItem(SSH_SERVERS_STORAGE_KEY, JSON.stringify(servers));
}

export function readStoredSelectedSshServerId(
  servers: SshServerConfig[],
): string {
  const stored = window.localStorage.getItem(SSH_SELECTED_SERVER_STORAGE_KEY);
  return servers.some((server) => server.id === stored)
    ? (stored ?? servers[0].id)
    : servers[0].id;
}

export function storeSelectedSshServerId(serverId: string): void {
  window.localStorage.setItem(SSH_SELECTED_SERVER_STORAGE_KEY, serverId);
}

export function isValidSshServerCredential(server: SshServerConfig): boolean {
  return (
    server.address.trim().length > 0 &&
    isValidSshPort(server.port) &&
    server.username.trim().length > 0 &&
    server.password.trim().length > 0
  );
}

export function getSshEndpoint(server: SshServerConfig): string {
  return `${server.address.trim()}:${normalizeSshPort(server.port)}`;
}

export function hasValidSshCredential(
  servers: ReadonlyArray<SshServerConfig>,
): boolean {
  return servers.some(isValidSshServerCredential);
}

export function SshHeaderTabs({
  activeTab = "ssh",
  onTabChange,
}: {
  activeTab?: SshToolTab;
  onTabChange?: (tab: SshToolTab) => void;
}): JSX.Element {
  return (
    <div className="tabs" role="tablist" aria-label="SSH sections">
      <button
        className={`tab${activeTab === "ssh" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeTab === "ssh"}
        onClick={() => onTabChange?.("ssh")}
      >
        SSH
      </button>
      <button
        className={`tab${activeTab === "monitor" ? " active" : ""}`}
        type="button"
        role="tab"
        aria-selected={activeTab === "monitor"}
        onClick={() => onTabChange?.("monitor")}
      >
        Monitor
      </button>
    </div>
  );
}

export function SshHeaderActions({
  servers,
  selectedServerId,
  fontSizeMode,
  disabled = false,
  connectionStatus = "idle",
  onServerChange,
  onConnectionToggle,
  onSettingsClick,
  onFontSizeChange,
}: {
  servers: SshServerConfig[];
  selectedServerId: string;
  fontSizeMode: FontSizeMode;
  disabled?: boolean;
  connectionStatus?: SshConnectionStatus;
  onServerChange: (serverId: string) => void;
  onConnectionToggle?: (server: SshServerConfig) => void;
  onSettingsClick: () => void;
  onFontSizeChange: (mode: FontSizeMode) => void;
}): JSX.Element {
  const options = useMemo<Array<AppSelectOption<string>>>(
    () =>
      servers.map((server) => ({
        value: server.id,
        label: server.name || server.address || "Remote server",
      })),
    [servers],
  );
  const safeValue = servers.some((server) => server.id === selectedServerId)
    ? selectedServerId
    : (servers[0]?.id ?? DEFAULT_SSH_SERVER_ID);
  const selectedServer =
    servers.find((server) => server.id === safeValue) ?? servers[0] ?? null;
  const connectInProgress =
    connectionStatus === "connecting" || connectionStatus === "reconnecting";
  const connected = connectionStatus === "connected";
  const toggleDisabled =
    disabled ||
    !selectedServer ||
    !isValidSshServerCredential(selectedServer) ||
    connectInProgress;
  const toggleLabel = connected ? "Disconnect SSH" : "Connect SSH";

  return (
    <>
      <AppSelect
        className="ssh-server-select"
        value={safeValue}
        options={options}
        onChange={onServerChange}
        ariaLabel="SSH server"
        minDropdownWidth={180}
        showDots={false}
        disabled={disabled}
      />
      <button
        className={`icon-button primary header-settings-button ${connected ? "ssh-header-connected-button" : "ssh-header-connect-button"}`}
        type="button"
        aria-label={toggleLabel}
        title={toggleLabel}
        disabled={toggleDisabled}
        onClick={() => {
          if (selectedServer) {
            onConnectionToggle?.(selectedServer);
          }
        }}
      >
        {connected ? <Plug size={18} /> : <PlugZap size={18} />}
      </button>
      <button
        className="icon-button secondary header-settings-button"
        type="button"
        aria-label="SSH settings"
        title="SSH settings"
        onClick={onSettingsClick}
      >
        <Settings size={18} />
      </button>
      <FontSizeDropdown value={fontSizeMode} onChange={onFontSizeChange} />
    </>
  );
}

export function SshSettingsModal({
  open,
  servers,
  selectedServerId,
  connectionStatus = "idle",
  credentialRequired = false,
  onSave,
  onClose,
}: {
  open: boolean;
  servers: SshServerConfig[];
  selectedServerId?: string;
  connectionStatus?: SshConnectionStatus;
  credentialRequired?: boolean;
  onSave: (servers: SshServerConfig[]) => void;
  onClose: () => void;
}): JSX.Element {
  const [draftServers, setDraftServers] = useState<SshServerConfig[]>(servers);
  const [selectedDraftServerId, setSelectedDraftServerId] = useState(
    selectedServerId ?? servers[0]?.id ?? "",
  );
  const [visiblePasswordIds, setVisiblePasswordIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const dirty = useMemo(
    () => !areSshServerConfigsEqual(draftServers, servers),
    [draftServers, servers],
  );
  const savedServerIds = useMemo(
    () => new Set(servers.map((server) => server.id)),
    [servers],
  );
  const selectedServer =
    draftServers.find((server) => server.id === selectedDraftServerId) ??
    draftServers[0] ??
    null;
  const selectedServerIndex = selectedServer
    ? draftServers.findIndex((server) => server.id === selectedServer.id)
    : -1;
  const selectedDisplayName = selectedServer
    ? getSshSettingsServerName(selectedServer, selectedServerIndex)
    : "New Connection";
  const selectedStatus = selectedServer
    ? getSshSettingsStatus(
        selectedServer.id,
        selectedServerId,
        connectionStatus,
      )
    : "disconnected";
  const draftHasValidCredential = useMemo(
    () => hasValidSshCredential(draftServers),
    [draftServers],
  );
  const shouldShowCredentialWarning =
    credentialRequired && !draftHasValidCredential;

  useEffect(() => {
    if (open) {
      setDraftServers(servers);
      setSelectedDraftServerId(
        servers.some((server) => server.id === selectedServerId)
          ? (selectedServerId ?? "")
          : (servers[0]?.id ?? ""),
      );
      setVisiblePasswordIds(new Set());
      setDeleteConfirmOpen(false);
    }
  }, [open, selectedServerId, servers]);

  useEffect(() => {
    if (draftServers.length === 0) {
      setSelectedDraftServerId("");
      return;
    }
    if (!draftServers.some((server) => server.id === selectedDraftServerId)) {
      setSelectedDraftServerId(draftServers[0].id);
    }
  }, [draftServers, selectedDraftServerId]);

  function requestClose(): void {
    onClose();
  }

  function updateServer(
    serverId: string,
    updates: Partial<SshServerConfig>,
  ): void {
    setDraftServers((current) =>
      current.map((server) =>
        server.id === serverId ? { ...server, ...updates } : server,
      ),
    );
  }

  function addServer(): void {
    const nextServer = {
      id: `ssh-${Date.now()}`,
      name: "",
      address: "",
      port: SSH_PORT_DEFAULT,
      username: "",
      password: "",
      macs: "",
      ciphers: "",
      autoLogin: false,
      autoReconnect: false,
      maxReconnectAttempts: SSH_RECONNECT_ATTEMPTS_DEFAULT,
      reconnectDelayMs: SSH_RECONNECT_DELAY_DEFAULT_MS,
    } satisfies SshServerConfig;
    setDraftServers((current) => [...current, nextServer]);
    setSelectedDraftServerId(nextServer.id);
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(
        `[data-ssh-field="remote-name-${nextServer.id}"]`,
      );
      input?.focus();
    }, 0);
  }

  function deleteSelectedServer(): void {
    if (!selectedServer || draftServers.length <= 1) {
      return;
    }
    setDeleteConfirmOpen(true);
  }

  function confirmDeleteSelectedServer(): void {
    if (!selectedServer || draftServers.length <= 1) {
      setDeleteConfirmOpen(false);
      return;
    }
    const removedServerId = selectedServer.id;
    const nextServers = draftServers.filter(
      (server) => server.id !== removedServerId,
    );
    const nextIndex = Math.min(
      Math.max(0, selectedServerIndex),
      nextServers.length - 1,
    );
    setDraftServers(nextServers);
    setSelectedDraftServerId(nextServers[nextIndex]?.id ?? "");
    setVisiblePasswordIds((current) => {
      if (!current.has(removedServerId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(removedServerId);
      return next;
    });
    setDeleteConfirmOpen(false);
  }

  function togglePasswordVisibility(serverId: string): void {
    setVisiblePasswordIds((current) => {
      const next = new Set(current);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
      }
      return next;
    });
  }

  function saveSettings(): void {
    const normalized = draftServers.map((server, index) => ({
      ...server,
      name: server.name.trim() || `Remote ${index + 1}`,
      address: server.address.trim(),
      port: normalizeSshPort(server.port),
      username: server.username.trim(),
      macs: normalizeSshAlgorithmList(server.macs),
      ciphers: normalizeSshAlgorithmList(server.ciphers),
      maxReconnectAttempts: clampInteger(
        server.maxReconnectAttempts,
        SSH_RECONNECT_ATTEMPTS_MIN,
        SSH_RECONNECT_ATTEMPTS_MAX,
        SSH_RECONNECT_ATTEMPTS_DEFAULT,
      ),
      reconnectDelayMs: clampInteger(
        server.reconnectDelayMs,
        SSH_RECONNECT_DELAY_MIN_MS,
        SSH_RECONNECT_DELAY_MAX_MS,
        SSH_RECONNECT_DELAY_DEFAULT_MS,
      ),
    }));
    if (!hasValidSshCredential(normalized)) {
      return;
    }
    onSave(normalized);
    setDeleteConfirmOpen(false);
    onClose();
  }

  function updateSelectedServer(updates: Partial<SshServerConfig>): void {
    if (!selectedServer) {
      return;
    }
    updateServer(selectedServer.id, updates);
  }

  function updateSelectedNumber(
    key: "port" | "maxReconnectAttempts" | "reconnectDelayMs",
    value: string,
    fallback: number,
  ): void {
    const parsed = Number.parseInt(value, 10);
    updateSelectedServer({
      [key]: Number.isFinite(parsed) ? parsed : fallback,
    });
  }

  return (
    <Modal
      open={open}
      title="SSH Settings"
      size="xl"
      className="ssh-settings-modal"
      contentClassName="ssh-settings-modal-content"
      closeLabel="Close SSH settings"
      headerAction={
        <button
          className="icon-button primary"
          type="button"
          aria-label="Add connection"
          title="Add connection"
          onClick={addServer}
        >
          <Plus size={18} />
        </button>
      }
      onClose={requestClose}
    >
      <div className="ssh-settings-layout">
        <aside className="ssh-settings-sidebar" aria-label="Saved SSH connections">
          <div className="ssh-settings-connection-list">
            {draftServers.map((server, index) => {
              const displayName = getSshSettingsServerName(server, index);
              const serverStatus = getSshSettingsStatus(
                server.id,
                selectedServerId,
                connectionStatus,
              );
              const selected = server.id === selectedDraftServerId;
              return (
                <button
                  className={`ssh-settings-connection-card${
                    selected ? " selected" : ""
                  }${savedServerIds.has(server.id) ? "" : " is-new"}`}
                  type="button"
                  key={server.id}
                  aria-pressed={selected}
                  onClick={() => setSelectedDraftServerId(server.id)}
                >
                  <span className="ssh-settings-connection-icon" aria-hidden="true">
                    <TerminalSquare size={22} />
                  </span>
                  <span className="ssh-settings-connection-copy">
                    <strong>{displayName}</strong>
                    <span>{formatSshSettingsEndpoint(server)}</span>
                  </span>
                  {serverStatus === "connected" ? (
                    <span className="ssh-settings-card-status" aria-label={`${displayName} connected`} />
                  ) : selected ? null : (
                    <span className="ssh-settings-card-menu" aria-hidden="true">
                      <MoreHorizontal size={16} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            className="ssh-settings-add-connection"
            type="button"
            onClick={addServer}
          >
            <Plus size={18} />
            Add connection
          </button>
        </aside>

        {selectedServer ? (
          <section className="ssh-settings-editor" aria-label="SSH connection editor">
            <div className="ssh-settings-editor-header">
              <h3>{selectedDisplayName}</h3>
              <span className={`ssh-settings-status-badge ${selectedStatus}`}>
                <span aria-hidden="true" />
                {formatSshSettingsStatus(selectedStatus)}
              </span>
            </div>

            <div className="ssh-settings-section">
              <h4>
                <TerminalSquare size={17} />
                Connection
              </h4>
              <label className="ssh-settings-field">
                <span>Remote Name</span>
                <input
                  aria-label="Remote Name"
                  data-ssh-field={`remote-name-${selectedServer.id}`}
                  type="text"
                  value={selectedServer.name}
                  placeholder="Local Dev"
                  onChange={(event) => updateSelectedServer({ name: event.target.value })}
                />
              </label>
              <div className="ssh-settings-host-port-row">
                <label className="ssh-settings-field">
                  <span>Address</span>
                  <input
                    aria-label="Address"
                    type="text"
                    value={selectedServer.address}
                    placeholder="127.0.0.1"
                    onChange={(event) => updateSelectedServer({ address: event.target.value })}
                  />
                </label>
                <label className="ssh-settings-field ssh-settings-port-field">
                  <span>Port</span>
                  <input
                    aria-label="Port"
                    className="ssh-numeric-input"
                    type="number"
                    min={SSH_PORT_MIN}
                    max={SSH_PORT_MAX}
                    step={1}
                    value={selectedServer.port}
                    onChange={(event) =>
                      updateSelectedNumber(
                        "port",
                        event.target.value,
                        SSH_PORT_DEFAULT,
                      )
                    }
                    onBlur={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      updateSelectedServer({
                        port: clampInteger(
                          parsed,
                          SSH_PORT_MIN,
                          SSH_PORT_MAX,
                          SSH_PORT_DEFAULT,
                        ),
                      });
                    }}
                  />
                </label>
              </div>
              <label className="ssh-settings-field">
                <span>Username</span>
                <input
                  aria-label="Username"
                  type="text"
                  value={selectedServer.username}
                  placeholder="admin"
                  onChange={(event) => updateSelectedServer({ username: event.target.value })}
                />
              </label>
              <label className="ssh-settings-field">
                <span>Password</span>
                <span className="ssh-password-field">
                  <input
                    aria-label="Password"
                    type={visiblePasswordIds.has(selectedServer.id) ? "text" : "password"}
                    value={selectedServer.password}
                    autoComplete="current-password"
                    onChange={(event) => updateSelectedServer({ password: event.target.value })}
                  />
                  <button
                    className="icon-button secondary ssh-password-toggle"
                    type="button"
                    aria-label={
                      visiblePasswordIds.has(selectedServer.id)
                        ? "Hide password"
                        : "Show password"
                    }
                    title={
                      visiblePasswordIds.has(selectedServer.id)
                        ? "Hide password"
                        : "Show password"
                    }
                    onClick={() => togglePasswordVisibility(selectedServer.id)}
                  >
                    {visiblePasswordIds.has(selectedServer.id) ? (
                      <EyeOff size={16} />
                    ) : (
                      <Eye size={16} />
                    )}
                  </button>
                </span>
              </label>
            </div>

            <div className="ssh-settings-section">
              <h4>
                <PlugZap size={17} />
                Advanced SSH Algorithms
              </h4>
              <label className="ssh-settings-field">
                <span>MACs</span>
                <input
                  aria-label="MACs"
                  type="text"
                  value={selectedServer.macs}
                  placeholder="hmac-sha2-256"
                  onChange={(event) => updateSelectedServer({ macs: event.target.value })}
                />
              </label>
              <label className="ssh-settings-field">
                <span>Ciphers</span>
                <input
                  aria-label="Ciphers"
                  type="text"
                  value={selectedServer.ciphers}
                  placeholder="aes128-ctr"
                  onChange={(event) => updateSelectedServer({ ciphers: event.target.value })}
                />
              </label>
              <p className="ssh-settings-helper ssh-settings-helper-full">
                Use comma or space separated values, matching OpenSSH options like MACs=hmac-sha2-256 and Ciphers=aes128-ctr.
              </p>
            </div>

            <div className="ssh-settings-section compact">
              <h4>
                <Settings size={17} />
                Options
              </h4>
              <label className="ssh-settings-check-field">
                <span>Auto-login</span>
                <span className="ssh-settings-checkbox-copy">
                  <input
                    type="checkbox"
                    checked={selectedServer.autoLogin}
                    onChange={(event) => updateSelectedServer({ autoLogin: event.target.checked })}
                  />
                  Enable auto-login
                </span>
              </label>
              <label className="ssh-settings-check-field">
                <span>Auto-reconnect</span>
                <span className="ssh-settings-checkbox-copy">
                  <input
                    type="checkbox"
                    checked={selectedServer.autoReconnect}
                    onChange={(event) => updateSelectedServer({ autoReconnect: event.target.checked })}
                  />
                  Enable auto-reconnect
                </span>
              </label>
            </div>

            <div className="ssh-settings-section">
              <h4>
                <RefreshCw size={17} />
                Retry Settings
              </h4>
              <label className="ssh-settings-field">
                <span>Retry attempts</span>
                <input
                  aria-label="Retry attempts"
                  className="ssh-numeric-input"
                  type="number"
                  min={SSH_RECONNECT_ATTEMPTS_MIN}
                  max={SSH_RECONNECT_ATTEMPTS_MAX}
                  step={1}
                  disabled={!selectedServer.autoReconnect}
                  value={selectedServer.maxReconnectAttempts}
                  onChange={(event) =>
                    updateSelectedNumber(
                      "maxReconnectAttempts",
                      event.target.value,
                      SSH_RECONNECT_ATTEMPTS_DEFAULT,
                    )
                  }
                  onBlur={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    updateSelectedServer({
                      maxReconnectAttempts: clampInteger(
                        parsed,
                        SSH_RECONNECT_ATTEMPTS_MIN,
                        SSH_RECONNECT_ATTEMPTS_MAX,
                        SSH_RECONNECT_ATTEMPTS_DEFAULT,
                      ),
                    });
                  }}
                />
              </label>
              <label className="ssh-settings-field">
                <span>Retry delay (ms)</span>
                <input
                  aria-label="Retry delay in milliseconds"
                  className="ssh-numeric-input"
                  type="number"
                  min={SSH_RECONNECT_DELAY_MIN_MS}
                  max={SSH_RECONNECT_DELAY_MAX_MS}
                  step={500}
                  disabled={!selectedServer.autoReconnect}
                  value={selectedServer.reconnectDelayMs}
                  onChange={(event) =>
                    updateSelectedNumber(
                      "reconnectDelayMs",
                      event.target.value,
                      SSH_RECONNECT_DELAY_DEFAULT_MS,
                    )
                  }
                  onBlur={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    updateSelectedServer({
                      reconnectDelayMs: clampInteger(
                        parsed,
                        SSH_RECONNECT_DELAY_MIN_MS,
                        SSH_RECONNECT_DELAY_MAX_MS,
                        SSH_RECONNECT_DELAY_DEFAULT_MS,
                      ),
                    });
                  }}
                />
              </label>
              {!selectedServer.autoReconnect ? (
                <p className="ssh-settings-helper">
                  Retry settings are disabled while auto-reconnect is off.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      {shouldShowCredentialWarning ? (
        <div className="ssh-settings-warning" role="status">
          Add at least one server address, username, and password to enable SSH.
        </div>
      ) : dirty ? (
        <div className="ssh-settings-warning" role="status">
          You have unsaved SSH settings changes.
        </div>
      ) : null}
      <div className="ssh-settings-footer">
        <button
          className="button danger compact ssh-settings-delete-button"
          type="button"
          disabled={!selectedServer || draftServers.length <= 1}
          onClick={deleteSelectedServer}
        >
          <Trash2 size={16} />
          Delete
        </button>
        <div className="ssh-settings-footer-actions">
          <button
            className="button secondary compact"
            type="button"
            onClick={requestClose}
          >
            Cancel
          </button>
          <button
            className="button primary compact"
            type="button"
            disabled={!draftHasValidCredential}
            onClick={saveSettings}
          >
            Save
          </button>
        </div>
      </div>
      {deleteConfirmOpen && selectedServer ? (
        <ConfirmDialog
          title="Delete SSH connection?"
          message={`Delete ${selectedDisplayName}? This only removes the saved connection profile.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onClose={() => setDeleteConfirmOpen(false)}
          onConfirm={confirmDeleteSelectedServer}
        />
      ) : null}
    </Modal>
  );
}

function getSshSettingsServerName(
  server: SshServerConfig,
  index: number,
): string {
  return server.name.trim() || (index >= 0 ? `New Connection` : "New Connection");
}

function formatSshSettingsEndpoint(server: SshServerConfig): string {
  const endpoint = `${server.address.trim() || "No address"}:${normalizeSshPort(server.port)}`;
  const endpointUsername = server.username.trim() || "No user";
  return `${endpoint} - ${endpointUsername}`;
}

function getSshSettingsStatus(
  serverId: string,
  activeServerId: string | undefined,
  connectionStatus: SshConnectionStatus,
): "connected" | "connecting" | "disconnected" {
  if (serverId !== activeServerId) {
    return "disconnected";
  }
  if (connectionStatus === "connected") {
    return "connected";
  }
  if (connectionStatus === "connecting" || connectionStatus === "reconnecting") {
    return "connecting";
  }
  return "disconnected";
}

function formatSshSettingsStatus(
  status: "connected" | "connecting" | "disconnected",
): string {
  if (status === "connected") {
    return "Connected";
  }
  if (status === "connecting") {
    return "Connecting";
  }
  return "Disconnected";
}

function normalizeSshAlgorithmList(value: string): string {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(",");
}

export function SshTool({
  selectedServer,
  activeTab = "ssh",
  disabled = false,
  connectionStatus = "idle",
  reconnectAttempt = 0,
  reconnectMaxAttempts = 0,
  sshSessionId = null,
  remoteCwd = null,
  onConfigure,
  onCommandSubmit,
}: {
  selectedServer: SshServerConfig | null;
  activeTab?: SshToolTab;
  disabled?: boolean;
  connectionStatus?: SshConnectionStatus;
  reconnectAttempt?: number;
  reconnectMaxAttempts?: number;
  sshSessionId?: string | null;
  remoteCwd?: string | null;
  onConfigure?: () => void;
  onCommandSubmit?: (command: string) => Promise<SshExecResult>;
}): JSX.Element {
  const [command, setCommand] = useState("");
  const [commandRunning, setCommandRunning] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(0);
  const [terminalScrollRequest, setTerminalScrollRequest] = useState(0);
  const [terminalFocusRequest, setTerminalFocusRequest] = useState(0);
  const [localPath, setLocalPath] = useState("");
  const [localHomePath, setLocalHomePath] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [remoteHomePath, setRemoteHomePath] = useState("");
  const [localItems, setLocalItems] = useState<SftpItem[]>([]);
  const [remoteItems, setRemoteItems] =
    useState<SftpItem[]>([]);
  const [selectedLocalIds, setSelectedLocalIds] = useState<string[]>([]);
  const [selectedRemoteIds, setSelectedRemoteIds] = useState<string[]>([]);
  const [actionMenu, setActionMenu] = useState<SftpActionMenuState>(null);
  const [nameDialog, setNameDialog] = useState<SftpNameDialogState>(null);
  const [deleteTarget, setDeleteTarget] = useState<SftpDeleteState>(null);
  const [filePreview, setFilePreview] = useState<FilePreviewState>(null);
  const [localBusyCount, setLocalBusyCount] = useState(0);
  const [remoteBusyCount, setRemoteBusyCount] = useState(0);
  const [directoryActionLog, setDirectoryActionLog] = useState<DirectoryActionLogEntry[]>([]);
  const [terminalCommandLog, setTerminalCommandLog] = useState<TerminalCommandLogEntry[]>([]);
  const [localHistory, setLocalHistory] = useState<string[]>([]);
  const [localFuture, setLocalFuture] = useState<string[]>([]);
  const [remoteHistory, setRemoteHistory] = useState<string[]>([]);
  const [remoteFuture, setRemoteFuture] = useState<string[]>([]);
  const [commandPanelCollapsed, setCommandPanelCollapsed] = useState(false);
  const [dragOverPanel, setDragOverPanel] = useState<"local" | "remote" | null>(
    null,
  );
  const [terminalLines, setTerminalLines] = useState<string[]>(() => [
    "SSH session idle.",
    "Select a server and enter a command.",
  ]);
  const [streamPartialLine, setStreamPartialLine] = useState("");
  const [passwordMode, setPasswordMode] = useState(false);
  const [activeRemoteHost, setActiveRemoteHost] = useState<string | null>(null);
  const streamPartialRef = useRef("");
  const activeRemoteHostRef = useRef<string | null>(null);
  const passwordModeRef = useRef(false);
  const previousStatusRef = useRef<SshConnectionStatus>(connectionStatus);
  const previousServerIdRef = useRef<string | null>(selectedServer?.id ?? null);

  const connected = connectionStatus === "connected";
  const commandSubmitDisabled = disabled || commandRunning;
  const fallbackRemoteTitle = formatRemoteDirectoryTitle(selectedServer);
  const remoteTitle = activeRemoteHost
    ? formatRemoteDirectoryTitleForHost(selectedServer, activeRemoteHost)
    : fallbackRemoteTitle;
  const promptLocation = remoteCwd?.trim() || remotePath || "";
  const fallbackPrompt = formatSshPrompt(selectedServer, promptLocation);
  const activePrompt =
    connected && streamPartialLine ? streamPartialLine : fallbackPrompt;
  const commandSuggestions = useMemo(
    () =>
      buildTerminalSuggestions({
        command,
        history: commandHistory,
        remoteItems,
        remotePath: promptLocation,
      }),
    [command, commandHistory, promptLocation, remoteItems],
  );
  const visibleSuggestions = suggestionsOpen ? commandSuggestions.slice(0, 8) : [];

  useEffect(() => {
    let canceled = false;
    window.ivsDashboard
      .listLocalDirectory(null)
      .then((result) => {
        if (canceled) {
          return;
        }
        if (result.ok) {
          setLocalHomePath(result.path);
          setLocalPath(result.path);
          setLocalItems(toSftpItems(result.items, result.path, "local"));
        } else {
          setLocalHomePath(result.path);
          setLocalPath(result.path);
          setLocalItems([]);
          appendLines([`Local directory error: ${result.error ?? "Unable to list directory."}`]);
        }
      })
      .catch((error) => {
        if (!canceled) {
          appendLines([
            `Local directory error: ${
              error instanceof Error ? error.message : "Unable to list directory."
            }`,
          ]);
        }
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!connected || !sshSessionId) {
      setRemotePath(remoteCwd ?? "");
      setRemoteHomePath(remoteCwd ?? "");
      setRemoteItems([]);
      setRemoteHistory([]);
      setRemoteFuture([]);
      return;
    }

    const startPath = remoteCwd?.trim() || null;
    void loadRemoteDirectory(startPath, { recordHistory: false });
  }, [connected, sshSessionId, remoteCwd]);

  useEffect(() => {
    // Reset stream state whenever the active session changes.
    streamPartialRef.current = "";
    setStreamPartialLine("");
    setPasswordMode(false);
    passwordModeRef.current = false;
    if (!sshSessionId) {
      activeRemoteHostRef.current = null;
      setActiveRemoteHost(null);
    }
  }, [sshSessionId]);

  useEffect(() => {
    if (!sshSessionId || !window.ivsDashboard.onSshShellData) {
      return undefined;
    }
    const unsubscribe = window.ivsDashboard.onSshShellData((event) => {
      if (event.sessionId !== sshSessionId) {
        return;
      }
      handleShellStreamData(event.data);
    });
    return () => {
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sshSessionId]);

  useEffect(() => {
    if (commandSuggestions.length === 0) {
      setSuggestionsOpen(false);
      setHighlightedSuggestionIndex(0);
      return;
    }
    setHighlightedSuggestionIndex((current) =>
      Math.min(current, Math.max(0, commandSuggestions.length - 1)),
    );
  }, [commandSuggestions.length]);

  useEffect(() => {
    if (!actionMenu) {
      return undefined;
    }

    function dismissActionMenu(): void {
      setActionMenu(null);
    }

    function dismissOnOutsidePointer(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Element)) {
        dismissActionMenu();
        return;
      }
      if (target.closest(".ssh-row-action-menu, .ssh-row-action-button")) {
        return;
      }
      dismissActionMenu();
    }

    function dismissOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        dismissActionMenu();
      }
    }

    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    document.addEventListener("keydown", dismissOnEscape);
    document.addEventListener("scroll", dismissActionMenu, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer);
      document.removeEventListener("keydown", dismissOnEscape);
      document.removeEventListener("scroll", dismissActionMenu, true);
    };
  }, [actionMenu]);

  useEffect(() => {
    const serverId = selectedServer?.id ?? null;
    if (previousServerIdRef.current !== serverId) {
      previousServerIdRef.current = serverId;
      previousStatusRef.current = connectionStatus;
      return;
    }
    const previous = previousStatusRef.current;
    if (previous === connectionStatus) {
      return;
    }
    previousStatusRef.current = connectionStatus;

    const target =
      selectedServer?.username && selectedServer?.address
        ? `${selectedServer.username}@${getSshEndpoint(selectedServer)}`
        : selectedServer?.address
          ? getSshEndpoint(selectedServer)
          : "server";

    if (connectionStatus === "connecting") {
      appendLines([`Connecting to ${target}...`]);
    } else if (connectionStatus === "reconnecting") {
      const delaySec = selectedServer
        ? Math.round(selectedServer.reconnectDelayMs / 1000)
        : 0;
      const attemptInfo =
        reconnectAttempt > 0 && reconnectMaxAttempts > 0
          ? ` attempt ${reconnectAttempt} of ${reconnectMaxAttempts}`
          : "";
      appendLines([
        "Connection lost unexpectedly.",
        `Reconnecting in ${delaySec} second${delaySec === 1 ? "" : "s"}...${attemptInfo}.`,
      ]);
    } else if (connectionStatus === "connected") {
      appendLines([
        previous === "reconnecting"
          ? "Reconnected."
          : `Connected to ${target}.`,
      ]);
    } else if (connectionStatus === "disconnected") {
      appendLines(["Disconnected."]);
    } else if (connectionStatus === "failed") {
      const attemptsText =
        reconnectMaxAttempts > 0
          ? `Connection failed after ${reconnectMaxAttempts} reconnect attempt(s).`
          : "Connection failed.";
      appendLines([attemptsText]);
    }
  }, [
    connectionStatus,
    reconnectAttempt,
    reconnectMaxAttempts,
    selectedServer,
  ]);

  function appendLines(lines: string[]): void {
    if (lines.length === 0) {
      return;
    }
    setTerminalLines((current) => [...current, ...lines]);
  }

  function setPanelBusy(source: DirectorySource, busy: boolean): void {
    const update = (current: number): number => Math.max(0, current + (busy ? 1 : -1));
    if (source === "local") {
      setLocalBusyCount(update);
    } else {
      setRemoteBusyCount(update);
    }
  }

  function appendDirectoryActionLog(
    entry: Omit<DirectoryActionLogEntry, "id" | "time">,
  ): void {
    setDirectoryActionLog((current) => [
      {
        ...entry,
        id: `dir-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        time: formatMonitorTime(new Date()),
      },
      ...current,
    ].slice(0, 100));
  }

  function appendTerminalCommandLog(
    entry: Omit<TerminalCommandLogEntry, "id" | "time">,
  ): void {
    setTerminalCommandLog((current) => [
      {
        ...entry,
        id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        time: formatMonitorTime(new Date()),
      },
      ...current,
    ].slice(0, 100));
  }

  function requestTerminalInputFocus(): void {
    setTerminalFocusRequest((current) => current + 1);
  }

  function requestTerminalScrollToLatest(): void {
    setTerminalScrollRequest((current) => current + 1);
  }

  function handleShellStreamData(data: string): void {
    if (!data) {
      return;
    }
    const normalized = data
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const combined = streamPartialRef.current + normalized;
    const parts = combined.split("\n");
    const remainder = parts.pop() ?? "";
    streamPartialRef.current = remainder;
    if (parts.length > 0) {
      const finishedLines = parts.map((line) =>
        stripAnsiControlSequences(line),
      );
      setTerminalLines((current) => [...current, ...finishedLines]);
      // Newline arrived; password mode resets.
      if (passwordModeRef.current) {
        passwordModeRef.current = false;
        setPasswordMode(false);
      }
      requestTerminalScrollToLatest();
    }

    const partialClean = stripAnsiControlSequences(remainder);
    setStreamPartialLine(partialClean);

    if (isInteractivePasswordPrompt(partialClean)) {
      if (!passwordModeRef.current) {
        passwordModeRef.current = true;
        setPasswordMode(true);
      }
    }

    detectActiveHostFromPrompt(partialClean);
  }

  function detectActiveHostFromPrompt(partialLine: string): void {
    const match = /\[?([A-Za-z0-9._-]+)@([A-Za-z0-9._-]+)(?:[\s:][^\n]*)?[\]$#%>]\s*$/.exec(
      partialLine,
    );
    if (!match) {
      return;
    }
    const host = match[2];
    if (!host || host === activeRemoteHostRef.current) {
      return;
    }
    activeRemoteHostRef.current = host;
    setActiveRemoteHost(host);
    // Refresh the remote directory to point at the new active host's cwd.
    if (sshSessionId) {
      void loadRemoteDirectory(null, { recordHistory: false });
    }
  }

  async function runCommand(): Promise<void> {
    if (commandSubmitDisabled) {
      return;
    }
    const rawValue = command;
    const trimmed = passwordMode ? rawValue : rawValue.trim();

    // Connected: send raw input directly to the PTY (handles passwords, sudo,
    // nested ssh, and any interactive prompt). Do not echo locally; the remote
    // shell will echo what it wants.
    if (connected && sshSessionId && window.ivsDashboard.sshWrite) {
      setCommand("");
      setHistoryCursor(null);
      setSuggestionsOpen(false);

      if (passwordMode) {
        // Send the password followed by newline. Do not log, do not push to history.
        await window.ivsDashboard
          .sshWrite(sshSessionId, `${rawValue}\n`)
          .catch(() => undefined);
        passwordModeRef.current = false;
        setPasswordMode(false);
        requestTerminalInputFocus();
        return;
      }

      // Local "clear" convenience: do not send to PTY, just clear scrollback.
      if (trimmed === "clear") {
        setTerminalLines([]);
        setCommandHistory((current) => addCommandHistoryEntry(current, trimmed));
        requestTerminalScrollToLatest();
        requestTerminalInputFocus();
        return;
      }

      if (trimmed.length > 0) {
        setCommandHistory((current) => addCommandHistoryEntry(current, trimmed));
        appendTerminalCommandLog({
          command: trimmed,
          location: promptLocation || "--",
          status: "success",
          exitCode: "--",
        });
      }

      await window.ivsDashboard
        .sshWrite(sshSessionId, `${rawValue}\n`)
        .catch(() => undefined);
      requestTerminalInputFocus();
      return;
    }

    // Not connected (or no stream backend): preserve the legacy synthetic prompt.
    const commandLocation = promptLocation;
    const prompt = formatSshPrompt(selectedServer, commandLocation);
    if (!trimmed) {
      appendLines([prompt]);
      setCommand("");
      setHistoryCursor(null);
      setSuggestionsOpen(false);
      requestTerminalScrollToLatest();
      requestTerminalInputFocus();
      return;
    }
    setCommand("");
    setHistoryCursor(null);
    setSuggestionsOpen(false);

    if (trimmed === "clear") {
      setTerminalLines([]);
      setCommandHistory((current) => addCommandHistoryEntry(current, trimmed));
      requestTerminalScrollToLatest();
      requestTerminalInputFocus();
      return;
    }

    appendLines([`${prompt} ${trimmed}`]);
    setCommandHistory((current) => addCommandHistoryEntry(current, trimmed));
    requestTerminalScrollToLatest();

    if (!connected) {
      appendLines(["Not connected. Please connect to the SSH server first."]);
      requestTerminalInputFocus();
      return;
    }

    if (!onCommandSubmit) {
      appendLines(["SSH backend is not available. Command was not executed."]);
      requestTerminalInputFocus();
      return;
    }

    setCommandRunning(true);
    try {
      const result = await onCommandSubmit(trimmed);
      appendTerminalCommandLog({
        command: trimmed,
        location: commandLocation || "--",
        status: result.error || (result.exitCode !== null && result.exitCode !== 0) ? "failed" : "success",
        exitCode: result.exitCode === null ? "--" : String(result.exitCode),
      });
      appendLines(formatSshExecResult(result));
    } catch (error) {
      appendTerminalCommandLog({
        command: trimmed,
        location: commandLocation || "--",
        status: "failed",
        exitCode: "--",
      });
      appendLines([
        `Command error: ${
          error instanceof Error
            ? error.message
            : "SSH backend is not available."
        }`,
      ]);
    } finally {
      setCommandRunning(false);
      requestTerminalInputFocus();
    }
  }

  function handleCommandChange(value: string): void {
    setCommand(value);
    setHistoryCursor(null);
    setSuggestionsOpen(value.trim().length > 0);
    setHighlightedSuggestionIndex(0);
  }

  function acceptSuggestion(suggestion: TerminalSuggestion): void {
    setCommand(
      suggestion.source === "command" || suggestion.source === "history"
        ? suggestion.value
        : applyTerminalSuggestion(command, suggestion.value),
    );
    setSuggestionsOpen(false);
    setHighlightedSuggestionIndex(0);
  }

  function handleCommandKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      if (suggestionsOpen) {
        event.preventDefault();
        setSuggestionsOpen(false);
      }
      return;
    }

    if (event.key === "Tab") {
      if (visibleSuggestions.length > 0) {
        event.preventDefault();
        acceptSuggestion(visibleSuggestions[highlightedSuggestionIndex] ?? visibleSuggestions[0]);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (suggestionsOpen && visibleSuggestions.length > 0) {
        acceptSuggestion(visibleSuggestions[highlightedSuggestionIndex] ?? visibleSuggestions[0]);
        return;
      }
      void runCommand();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (suggestionsOpen && visibleSuggestions.length > 0) {
        setHighlightedSuggestionIndex((current) =>
          current <= 0 ? visibleSuggestions.length - 1 : current - 1,
        );
        return;
      }
      navigateCommandHistory("previous");
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (suggestionsOpen && visibleSuggestions.length > 0) {
        setHighlightedSuggestionIndex((current) =>
          current >= visibleSuggestions.length - 1 ? 0 : current + 1,
        );
        return;
      }
      navigateCommandHistory("next");
    }
  }

  function navigateCommandHistory(direction: "previous" | "next"): void {
    if (commandHistory.length === 0) {
      return;
    }
    setHistoryCursor((current) => {
      const nextIndex = direction === "previous"
        ? current === null
          ? commandHistory.length - 1
          : Math.max(0, current - 1)
        : current === null
          ? null
          : current >= commandHistory.length - 1
            ? null
            : current + 1;
      setCommand(nextIndex === null ? "" : (commandHistory[nextIndex] ?? ""));
      setSuggestionsOpen(false);
      return nextIndex;
    });
  }

  function handleItemDragStart(
    event: DragEvent<HTMLDivElement>,
    source: "local" | "remote",
    itemId: string,
  ): void {
    if (disabled) {
      event.preventDefault();
      return;
    }
    const payload: TransferDragPayload = { source, itemId };
    event.dataTransfer.setData(
      "application/x-ivs-ssh-item",
      JSON.stringify(payload),
    );
    event.dataTransfer.effectAllowed = "copy";
  }

  function handleDirectoryDragOver(
    event: DragEvent<HTMLDivElement>,
    target: "local" | "remote",
  ): void {
    if (disabled) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragOverPanel(target);
  }

  function handleDirectoryDrop(
    event: DragEvent<HTMLDivElement>,
    target: "local" | "remote",
  ): void {
    event.preventDefault();
    if (disabled) {
      return;
    }
    setDragOverPanel(null);
    const payloadText = event.dataTransfer.getData(
      "application/x-ivs-ssh-item",
    );
    if (payloadText) {
      void transferListedItem(payloadText, target);
      return;
    }

    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length === 0) {
      return;
    }
    if (target !== "remote" || !connected || !sshSessionId) {
      appendTransferLine("Drop skipped: connect SSH and drop files on the remote panel.");
      return;
    }
    void uploadDroppedFiles(droppedFiles);
  }

  async function uploadDroppedFiles(files: File[]): Promise<void> {
    if (!sshSessionId) {
      return;
    }
    setPanelBusy("remote", true);
    try {
      for (const file of files) {
        const filePath = (file as File & { path?: string }).path;
        if (!filePath) {
          appendTransferLine(`Upload skipped for ${file.name}: file path is unavailable.`);
          appendDirectoryActionLog({
            action: "Upload",
            location: remotePath || "--",
            source: "remote",
            item: file.name,
            status: "failed",
            detail: "File path is unavailable.",
          });
          continue;
        }
        const result = await window.ivsDashboard.sshUploadFile(
          sshSessionId,
          filePath,
          remotePath,
        );
        appendDirectoryActionLog({
          action: "Upload",
          location: remotePath || "--",
          source: "remote",
          item: file.name,
          status: result.ok ? "success" : "failed",
          detail: result.ok ? remotePath : (result.error ?? "Unknown error."),
        });
        appendTransferLine(
          result.ok
            ? `Uploaded ${file.name} to ${remotePath}.`
            : `Upload failed for ${file.name}: ${result.error ?? "Unknown error."}`,
        );
      }
    } finally {
      setPanelBusy("remote", false);
    }
    refreshDirectory("remote");
  }

  async function transferListedItem(
    payloadText: string,
    target: "local" | "remote",
  ): Promise<void> {
    try {
      const payload = JSON.parse(payloadText) as TransferDragPayload;
      if (payload.source === target) {
        return;
      }
      const sourceItems = payload.source === "local" ? localItems : remoteItems;
      const item = sourceItems.find(
        (candidate) => candidate.id === payload.itemId,
      );
      if (!item) {
        return;
      }
      if (item.type !== "file") {
        appendTransferLine(`Transfer skipped for ${item.name}: select a file.`);
        return;
      }
      if (!connected || !sshSessionId) {
        appendTransferLine("Transfer failed: Not connected.");
        return;
      }
      if (target === "local") {
        setPanelBusy("local", true);
        const result = await window.ivsDashboard.sshDownloadFile(
          sshSessionId,
          item.path,
          localPath,
        );
        appendDirectoryActionLog({
          action: "Download",
          location: localPath || "--",
          source: "local",
          item: item.name,
          status: result.ok ? "success" : "failed",
          detail: result.ok ? localPath : (result.error ?? "Unknown error."),
        });
        setPanelBusy("local", false);
        appendTransferLine(
          result.ok
            ? `Downloaded ${item.name} to ${localPath}.`
            : `Download failed for ${item.name}: ${result.error ?? "Unknown error."}`,
        );
        refreshDirectory("local");
      } else {
        setPanelBusy("remote", true);
        const result = await window.ivsDashboard.sshUploadFile(
          sshSessionId,
          item.path,
          remotePath,
        );
        appendDirectoryActionLog({
          action: "Upload",
          location: remotePath || "--",
          source: "remote",
          item: item.name,
          status: result.ok ? "success" : "failed",
          detail: result.ok ? remotePath : (result.error ?? "Unknown error."),
        });
        setPanelBusy("remote", false);
        appendTransferLine(
          result.ok
            ? `Uploaded ${item.name} to ${remotePath}.`
            : `Upload failed for ${item.name}: ${result.error ?? "Unknown error."}`,
        );
        refreshDirectory("remote");
      }
    } catch {
      // Ignore malformed external drag data.
    }
  }

  function appendTransferLine(line: string): void {
    setTerminalLines((current) => [...current, line]);
  }

  async function loadLocalDirectory(
    path: string | null,
    options: { recordHistory?: boolean } = {},
  ): Promise<void> {
    setPanelBusy("local", true);
    const currentPath = localPath;
    try {
      const result = await window.ivsDashboard.listLocalDirectory(path);
      if (!result.ok) {
        appendLines([`Local directory error: ${result.error ?? "Unable to list directory."}`]);
        return;
      }

      if (options.recordHistory !== false && currentPath && currentPath !== result.path) {
        setLocalHistory((history) => [...history, currentPath]);
        setLocalFuture([]);
      }
      if (!localHomePath) {
        setLocalHomePath(result.path);
      }
      setLocalPath(result.path);
      setLocalItems(toSftpItems(result.items, result.path, "local"));
      setSelectedLocalIds([]);
    } finally {
      setPanelBusy("local", false);
    }
  }

  async function loadRemoteDirectory(
    path: string | null,
    options: { recordHistory?: boolean } = {},
  ): Promise<void> {
    if (!connected || !sshSessionId) {
      appendLines(["Remote directory error: Not connected."]);
      return;
    }

    setPanelBusy("remote", true);
    const currentPath = remotePath;
    try {
      const result = await window.ivsDashboard.sshListDirectory(sshSessionId, path);
      if (!result.ok) {
        appendLines([`Remote directory error: ${result.error ?? "Unable to list directory."}`]);
        return;
      }

      if (options.recordHistory !== false && currentPath && currentPath !== result.path) {
        setRemoteHistory((history) => [...history, currentPath]);
        setRemoteFuture([]);
      }
      if (!remoteHomePath) {
        setRemoteHomePath(result.path);
      }
      setRemotePath(result.path);
      setRemoteItems(toSftpItems(result.items, result.path, "remote"));
      setSelectedRemoteIds([]);
    } finally {
      setPanelBusy("remote", false);
    }
  }

  function navigateDirectory(source: "local" | "remote", path: string): void {
    if (source === "local") {
      void loadLocalDirectory(path);
      return;
    }
    void loadRemoteDirectory(path);
  }

  function navigateHomeDirectory(source: "local" | "remote"): void {
    const path =
      source === "local"
        ? localHomePath || null
        : remoteHomePath || remoteCwd || null;
    if (source === "local") {
      void loadLocalDirectory(path);
      return;
    }
    void loadRemoteDirectory(path);
  }

  function refreshDirectory(source: "local" | "remote"): void {
    if (source === "local") {
      void loadLocalDirectory(localPath || null, { recordHistory: false });
      return;
    }
    void loadRemoteDirectory(remotePath || null, { recordHistory: false });
  }

  function navigateBack(source: "local" | "remote"): void {
    if (source === "local") {
      const previous = localHistory[localHistory.length - 1];
      if (!previous) {
        return;
      }
      setLocalHistory((history) => history.slice(0, -1));
      if (localPath) {
        setLocalFuture((future) => [localPath, ...future]);
      }
      void loadLocalDirectory(previous, { recordHistory: false });
      return;
    }

    const previous = remoteHistory[remoteHistory.length - 1];
    if (!previous) {
      return;
    }
    setRemoteHistory((history) => history.slice(0, -1));
    if (remotePath) {
      setRemoteFuture((future) => [remotePath, ...future]);
    }
    void loadRemoteDirectory(previous, { recordHistory: false });
  }

  function navigateForward(source: "local" | "remote"): void {
    if (source === "local") {
      const next = localFuture[0];
      if (!next) {
        return;
      }
      setLocalFuture((future) => future.slice(1));
      if (localPath) {
        setLocalHistory((history) => [...history, localPath]);
      }
      void loadLocalDirectory(next, { recordHistory: false });
      return;
    }

    const next = remoteFuture[0];
    if (!next) {
      return;
    }
    setRemoteFuture((future) => future.slice(1));
    if (remotePath) {
      setRemoteHistory((history) => [...history, remotePath]);
    }
    void loadRemoteDirectory(next, { recordHistory: false });
  }

  function openDirectoryItem(source: "local" | "remote", item: SftpItem): void {
    if (item.type !== "folder") {
      return;
    }
    const basePath = source === "local" ? localPath : remotePath;
    navigateDirectory(source, joinDirectoryPath(basePath, item.name, source));
  }

  function toggleItemSelection(
    source: DirectorySource,
    item: SftpItem,
    multiSelect: boolean,
  ): void {
    if (item.type === "folder") {
      openDirectoryItem(source, item);
      return;
    }

    const setSelected = source === "local" ? setSelectedLocalIds : setSelectedRemoteIds;
    setSelected((current) => {
      if (!multiSelect) {
        return [item.id];
      }
      return current.includes(item.id)
        ? current.filter((id) => id !== item.id)
        : [...current, item.id];
    });
    void openFilePreview(source, item);
  }

  async function openFilePreview(source: DirectorySource, item: SftpItem): Promise<void> {
    if (item.type !== "file") {
      return;
    }
    if (source === "remote" && (!connected || !sshSessionId)) {
      setFilePreview({
        source,
        item,
        loading: false,
        result: null,
        error: "Not connected.",
      });
      return;
    }

    setFilePreview({ source, item, loading: true, result: null, error: null });
    try {
      const result =
        source === "local"
          ? await window.ivsDashboard.previewLocalFile(item.path)
          : await window.ivsDashboard.sshPreviewFile(sshSessionId as string, item.path);
      setFilePreview({
        source,
        item,
        loading: false,
        result,
        error: result.ok ? null : (result.error ?? "Unable to preview file."),
      });
    } catch (error) {
      setFilePreview({
        source,
        item,
        loading: false,
        result: null,
        error: error instanceof Error ? error.message : "Unable to preview file.",
      });
    }
  }

  async function uploadSelectedItems(): Promise<void> {
    if (!connected || !sshSessionId) {
      appendLines(["Upload failed: Not connected."]);
      return;
    }
    const selectedItems = localItems.filter(
      (item) => selectedLocalIds.includes(item.id) && item.type === "file",
    );
    if (selectedItems.length === 0) {
      appendLines(["Upload skipped: select one or more local files."]);
      return;
    }

    setPanelBusy("remote", true);
    try {
      for (const item of selectedItems) {
        const result = await window.ivsDashboard.sshUploadFile(
          sshSessionId,
          item.path,
          remotePath,
        );
        appendDirectoryActionLog({
          action: "Upload",
          location: remotePath || "--",
          source: "remote",
          item: item.name,
          status: result.ok ? "success" : "failed",
          detail: result.ok ? remotePath : (result.error ?? "Unknown error."),
        });
        appendLines([
          result.ok
            ? `Uploaded ${item.name} to ${remotePath}.`
            : `Upload failed for ${item.name}: ${result.error ?? "Unknown error."}`,
        ]);
      }
    } finally {
      setPanelBusy("remote", false);
    }
    refreshDirectory("remote");
  }

  async function downloadSelectedItems(): Promise<void> {
    if (!connected || !sshSessionId) {
      appendLines(["Download failed: Not connected."]);
      return;
    }
    const selectedItems = remoteItems.filter(
      (item) => selectedRemoteIds.includes(item.id) && item.type === "file",
    );
    if (selectedItems.length === 0) {
      appendLines(["Download skipped: select one or more remote files."]);
      return;
    }

    setPanelBusy("local", true);
    try {
      for (const item of selectedItems) {
        const result = await window.ivsDashboard.sshDownloadFile(
          sshSessionId,
          item.path,
          localPath,
        );
        appendDirectoryActionLog({
          action: "Download",
          location: localPath || "--",
          source: "local",
          item: item.name,
          status: result.ok ? "success" : "failed",
          detail: result.ok ? localPath : (result.error ?? "Unknown error."),
        });
        appendLines([
          result.ok
            ? `Downloaded ${item.name} to ${localPath}.`
            : `Download failed for ${item.name}: ${result.error ?? "Unknown error."}`,
        ]);
      }
    } finally {
      setPanelBusy("local", false);
    }
    refreshDirectory("local");
  }

  function openNewFolderDialog(source: DirectorySource): void {
    setNameDialog({ mode: "new-folder", source, value: "" });
  }

  function openRenameDialog(source: DirectorySource, item: SftpItem): void {
    setActionMenu(null);
    setNameDialog({ mode: "rename", source, item, value: item.name });
  }

  function openDeleteDialog(source: DirectorySource, item: SftpItem): void {
    setActionMenu(null);
    setDeleteTarget({ source, item });
  }

  async function saveNameDialog(): Promise<void> {
    if (!nameDialog) {
      return;
    }
    const value = nameDialog.value.trim();
    if (!value) {
      return;
    }

    setPanelBusy(nameDialog.source, true);
    const result = await (nameDialog.mode === "new-folder"
      ? createDirectoryForSource(nameDialog.source, value)
      : nameDialog.item
        ? renameItemForSource(nameDialog.source, nameDialog.item, value)
        : Promise.resolve({ ok: false, error: "No item selected." }));
    appendDirectoryActionLog({
      action: nameDialog.mode === "new-folder" ? "New Folder" : "Rename",
      location: getDirectoryLocation(nameDialog.source, localPath, remotePath),
      source: nameDialog.source,
      item: nameDialog.mode === "new-folder" ? value : (nameDialog.item?.name ?? value),
      status: result.ok ? "success" : "failed",
      detail: result.ok
        ? nameDialog.mode === "new-folder"
          ? "Created"
          : `Renamed to ${value}`
        : (result.error ?? "Unknown error."),
    });
    setPanelBusy(nameDialog.source, false);
    if (!result.ok) {
      appendLines([
        `${nameDialog.mode === "new-folder" ? "New folder" : "Rename"} failed: ${result.error ?? "Unknown error."}`,
      ]);
      return;
    }

    setNameDialog(null);
    refreshDirectory(nameDialog.source);
  }

  async function createDirectoryForSource(
    source: DirectorySource,
    name: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (source === "local") {
      return window.ivsDashboard.createLocalDirectory(localPath, name);
    }
    if (!connected || !sshSessionId) {
      return { ok: false, error: "Not connected." };
    }
    return window.ivsDashboard.sshCreateDirectory(sshSessionId, remotePath, name);
  }

  async function renameItemForSource(
    source: DirectorySource,
    item: SftpItem,
    newName: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (source === "local") {
      return window.ivsDashboard.renameLocalPath(item.path, newName);
    }
    if (!connected || !sshSessionId) {
      return { ok: false, error: "Not connected." };
    }
    return window.ivsDashboard.sshRenamePath(sshSessionId, item.path, newName);
  }

  async function confirmDeleteItem(): Promise<void> {
    if (!deleteTarget) {
      return;
    }
    const { source, item } = deleteTarget;
    setPanelBusy(source, true);
    const result = await (source === "local"
      ? window.ivsDashboard.deleteLocalPath(item.path)
      : connected && sshSessionId
        ? window.ivsDashboard.sshDeletePath(sshSessionId, item.path, item.type)
        : Promise.resolve({ ok: false, error: "Not connected." }));
    appendDirectoryActionLog({
      action: "Delete",
      location: getDirectoryLocation(source, localPath, remotePath),
      source,
      item: item.name,
      status: result.ok ? "success" : "failed",
      detail: result.ok ? "Deleted" : (result.error ?? "Unknown error."),
    });
    setPanelBusy(source, false);

    if (!result.ok) {
      appendLines([`Delete failed for ${item.name}: ${result.error ?? "Unknown error."}`]);
      return;
    }
    setDeleteTarget(null);
    refreshDirectory(source);
  }

  return (
    <section
      className={`tools-screen ssh-tool-screen${
        disabled ? " ssh-tool-screen-disabled" : ""
      }${commandPanelCollapsed ? " ssh-command-panel-collapsed" : ""}`}
      data-testid="ssh-tool-screen"
      aria-disabled={disabled}
    >
      {disabled ? (
        <div className="ssh-setup-required" role="status">
          <TerminalSquare size={22} />
          <div>
            <h2>SSH server info required</h2>
            <p>
              Add at least one server address, username, and password to use
              SSH.
            </p>
          </div>
          <button
            className="button primary compact"
            type="button"
            onClick={onConfigure}
          >
            <Settings size={15} />
            Add server
          </button>
        </div>
      ) : null}
      {activeTab === "monitor" ? (
        <SshMonitorTab
          directoryActionLog={directoryActionLog}
          terminalCommandLog={terminalCommandLog}
        />
      ) : (
        <>
      <Panel
        title="CLI"
        className="ssh-cli-panel"
        action={
          <span className="ssh-panel-actions">
            <span
              className={`ssh-status ssh-status-${connectionStatus}`}
              data-status={connectionStatus}
            >
              <span className="ssh-status-dot" aria-hidden="true" />
              {formatConnectionStatusLabel(
                connectionStatus,
                reconnectAttempt,
                reconnectMaxAttempts,
              )}
            </span>
            <button
              className="icon-button secondary ssh-panel-collapse-button"
              type="button"
              aria-label={
                commandPanelCollapsed ? "Expand command panel" : "Collapse command panel"
              }
              title={
                commandPanelCollapsed ? "Expand command panel" : "Collapse command panel"
              }
              onClick={() => setCommandPanelCollapsed((current) => !current)}
            >
              {commandPanelCollapsed ? (
                <PanelLeftOpen size={16} />
              ) : (
                <PanelLeftClose size={16} />
              )}
            </button>
          </span>
        }
      >
        <SshTerminalOutput
          lines={terminalLines}
          prompt={activePrompt}
          command={command}
          disabled={disabled}
          running={commandRunning}
          passwordMode={passwordMode}
          suggestions={visibleSuggestions}
          highlightedSuggestionIndex={highlightedSuggestionIndex}
          scrollRequest={terminalScrollRequest}
          focusRequest={terminalFocusRequest}
          onCommandChange={handleCommandChange}
          onCommandKeyDown={handleCommandKeyDown}
          onSuggestionHover={setHighlightedSuggestionIndex}
          onSuggestionSelect={acceptSuggestion}
        />
      </Panel>

      <div className="ssh-directory-column">
        <SftpPanel
          title="Local Directory"
          path={localPath}
          items={localItems}
          source="local"
          dragOver={dragOverPanel === "local"}
          disabled={disabled}
          loading={localBusyCount > 0}
          selectedItemIds={selectedLocalIds}
          onPathChange={setLocalPath}
          canGoBack={localHistory.length > 0}
          canGoForward={localFuture.length > 0}
          onBack={() => navigateBack("local")}
          onForward={() => navigateForward("local")}
          onHome={() => navigateHomeDirectory("local")}
          onRefresh={() => refreshDirectory("local")}
          onUpload={() => void uploadSelectedItems()}
          onDownload={() => void downloadSelectedItems()}
          onNewFolder={() => openNewFolderDialog("local")}
          uploadDisabled={!connected || selectedLocalIds.length === 0}
          downloadDisabled={!connected || selectedRemoteIds.length === 0}
          onSubmitPath={(path) => navigateDirectory("local", path)}
          onSelectItem={(item, multiSelect) => toggleItemSelection("local", item, multiSelect)}
          actionMenu={actionMenu}
          onToggleActionMenu={(item, position) =>
            setActionMenu((current) =>
              current?.source === "local" && current.item.id === item.id && !position
                ? null
                : { source: "local", item, ...position },
            )
          }
          onCloseActionMenu={() => setActionMenu(null)}
          onRenameItem={(item) => openRenameDialog("local", item)}
          onDeleteItem={(item) => openDeleteDialog("local", item)}
          onDragStart={handleItemDragStart}
          onDragOver={handleDirectoryDragOver}
          onDrop={handleDirectoryDrop}
          onDragLeave={() => setDragOverPanel(null)}
        />
        <SftpPanel
          title={remoteTitle}
          path={remotePath}
          items={remoteItems}
          source="remote"
          dragOver={dragOverPanel === "remote"}
          disabled={disabled || !connected}
          loading={remoteBusyCount > 0}
          selectedItemIds={selectedRemoteIds}
          onPathChange={setRemotePath}
          canGoBack={remoteHistory.length > 0}
          canGoForward={remoteFuture.length > 0}
          onBack={() => navigateBack("remote")}
          onForward={() => navigateForward("remote")}
          onHome={() => navigateHomeDirectory("remote")}
          onRefresh={() => refreshDirectory("remote")}
          onUpload={() => void uploadSelectedItems()}
          onDownload={() => void downloadSelectedItems()}
          onNewFolder={() => openNewFolderDialog("remote")}
          uploadDisabled={!connected || selectedLocalIds.length === 0}
          downloadDisabled={!connected || selectedRemoteIds.length === 0}
          onSubmitPath={(path) => navigateDirectory("remote", path)}
          onSelectItem={(item, multiSelect) => toggleItemSelection("remote", item, multiSelect)}
          actionMenu={actionMenu}
          onToggleActionMenu={(item, position) =>
            setActionMenu((current) =>
              current?.source === "remote" && current.item.id === item.id && !position
                ? null
                : { source: "remote", item, ...position },
            )
          }
          onCloseActionMenu={() => setActionMenu(null)}
          onRenameItem={(item) => openRenameDialog("remote", item)}
          onDeleteItem={(item) => openDeleteDialog("remote", item)}
          onDragStart={handleItemDragStart}
          onDragOver={handleDirectoryDragOver}
          onDrop={handleDirectoryDrop}
          onDragLeave={() => setDragOverPanel(null)}
        />
      </div>
        </>
      )}
      {nameDialog ? (
        <SftpNameDialog
          state={nameDialog}
          onChange={(value) =>
            setNameDialog((current) => (current ? { ...current, value } : current))
          }
          onClose={() => setNameDialog(null)}
          onSave={() => void saveNameDialog()}
        />
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          title={`Delete ${deleteTarget.item.type}?`}
          message={`Delete "${deleteTarget.item.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDeleteItem()}
        />
      ) : null}
      <FilePreviewModal
        preview={filePreview}
        onClose={() => setFilePreview(null)}
      />
    </section>
  );
}

function SftpPanel({
  title,
  path,
  items,
  source,
  dragOver,
  disabled,
  loading,
  selectedItemIds,
  onPathChange,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onHome,
  onRefresh,
  onUpload,
  onDownload,
  onNewFolder,
  uploadDisabled,
  downloadDisabled,
  onSubmitPath,
  onSelectItem,
  actionMenu,
  onToggleActionMenu,
  onCloseActionMenu,
  onRenameItem,
  onDeleteItem,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
}: {
  title: string;
  path: string;
  items: SftpItem[];
  source: "local" | "remote";
  dragOver: boolean;
  disabled: boolean;
  loading: boolean;
  selectedItemIds: string[];
  onPathChange: (path: string) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onHome: () => void;
  onRefresh: () => void;
  onUpload: () => void;
  onDownload: () => void;
  onNewFolder: () => void;
  uploadDisabled: boolean;
  downloadDisabled: boolean;
  onSubmitPath: (path: string) => void;
  onSelectItem: (item: SftpItem, multiSelect: boolean) => void;
  actionMenu: SftpActionMenuState;
  onToggleActionMenu: (item: SftpItem, position?: { x: number; y: number }) => void;
  onCloseActionMenu: () => void;
  onRenameItem: (item: SftpItem) => void;
  onDeleteItem: (item: SftpItem) => void;
  onDragStart: (
    event: DragEvent<HTMLDivElement>,
    source: "local" | "remote",
    itemId: string,
  ) => void;
  onDragOver: (
    event: DragEvent<HTMLDivElement>,
    target: "local" | "remote",
  ) => void;
  onDrop: (
    event: DragEvent<HTMLDivElement>,
    target: "local" | "remote",
  ) => void;
  onDragLeave: () => void;
}): JSX.Element {
  const panelLabel = source === "local" ? "Local Directory" : "Remote Directory";

  return (
    <Panel
      title={title}
      className={`ssh-directory-panel${dragOver ? " drag-over" : ""}${loading ? " loading" : ""}`}
      action={
        <SftpPanelActions
          disabled={disabled}
          label={panelLabel}
          onUpload={onUpload}
          onDownload={onDownload}
          onNewFolder={onNewFolder}
          onRefresh={onRefresh}
          uploadDisabled={uploadDisabled}
          downloadDisabled={downloadDisabled}
        />
      }
    >
      <div className="ssh-path-row" aria-label={`${title} navigation`}>
        <SftpNavButton
          label={`${panelLabel} back`}
          disabled={disabled || !canGoBack}
          onClick={onBack}
        >
          <ArrowLeft size={15} />
        </SftpNavButton>
        <SftpNavButton
          label={`${panelLabel} forward`}
          disabled={disabled || !canGoForward}
          onClick={onForward}
        >
          <ArrowRight size={15} />
        </SftpNavButton>
        <SftpNavButton
          label={`${panelLabel} home`}
          disabled={disabled}
          onClick={onHome}
        >
          <Home size={15} />
        </SftpNavButton>
        <SftpNavButton
          label={`${panelLabel} refresh`}
          disabled={disabled}
          onClick={onRefresh}
        >
          <RefreshCw size={15} />
        </SftpNavButton>
        <input
          className="ssh-path-input"
          value={path}
          onChange={(event) => onPathChange(event.target.value)}
          onBlur={() => onSubmitPath(path)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
              onSubmitPath(event.currentTarget.value);
            }
          }}
          aria-label={`${title} path`}
          disabled={disabled}
        />
      </div>
      <div
        className="ssh-file-tree"
        onDragOver={(event) => onDragOver(event, source)}
        onDrop={(event) => onDrop(event, source)}
        onDragLeave={onDragLeave}
        data-testid={`${source}-directory-tree`}
      >
        <div className="ssh-file-tree-head" role="row">
          <span>Name</span>
          <span>Size</span>
          <span>Modified</span>
          <span aria-hidden="true" />
        </div>
        <div className="ssh-file-tree-body">
          {items.map((item) => (
            <div
              className={`ssh-file-row${selectedItemIds.includes(item.id) ? " selected" : ""}`}
              draggable={!disabled}
              key={item.id}
              onClick={(event) => onSelectItem(item, event.ctrlKey)}
              onContextMenu={(event) => {
                event.preventDefault();
                onToggleActionMenu(item, { x: event.clientX, y: event.clientY });
              }}
              onDragStart={(event) => onDragStart(event, source, item.id)}
              role="row"
            >
              <div className="ssh-file-name-cell">
                <span className="ssh-file-kind-icon" aria-hidden="true">
                  {renderSftpItemIcon(item)}
                </span>
                <SftpFileName name={item.name} />
              </div>
              <span className="ssh-file-size-cell">{item.size}</span>
              <span className="ssh-file-modified-cell">{item.modified}</span>
              <span className="ssh-row-action-cell">
                <button
                  className="ssh-row-action-button"
                  type="button"
                  aria-label={`${item.name} actions`}
                  disabled={disabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleActionMenu(item);
                  }}
                >
                  <MoreHorizontal size={15} />
                </button>
                {actionMenu?.source === source && actionMenu.item.id === item.id ? (
                  <div
                    className={`ssh-row-action-menu${actionMenu.x !== undefined ? " context" : ""}`}
                    role="menu"
                    style={
                      actionMenu.x !== undefined && actionMenu.y !== undefined
                        ? { left: actionMenu.x, top: actionMenu.y }
                        : undefined
                    }
                    tabIndex={-1}
                    onBlur={(event) => {
                      if (
                        !(event.relatedTarget instanceof Node) ||
                        !event.currentTarget.contains(event.relatedTarget)
                      ) {
                        onCloseActionMenu();
                      }
                    }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRenameItem(item);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteItem(item);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function SshMonitorTab({
  directoryActionLog,
  terminalCommandLog,
}: {
  directoryActionLog: DirectoryActionLogEntry[];
  terminalCommandLog: TerminalCommandLogEntry[];
}): JSX.Element {
  return (
    <div className="ssh-monitor-tab">
      <Panel title="Directory Action Log" className="ssh-monitor-panel recent-builds-panel">
        <div className="recent-builds-table-scroll ssh-monitor-table-scroll">
          <table className="recent-builds-table ssh-monitor-table directory-action-log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Location</th>
                <th>Source</th>
                <th>Item</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {directoryActionLog.length === 0 ? (
                <tr>
                  <td colSpan={7}>No directory actions yet.</td>
                </tr>
              ) : (
                directoryActionLog.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.time}</td>
                    <td>{entry.action}</td>
                    <td>{entry.location}</td>
                    <td>{entry.source}</td>
                    <td>{entry.item}</td>
                    <td>{entry.status}</td>
                    <td>{entry.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Terminal Command Log" className="ssh-monitor-panel recent-builds-panel">
        <div className="recent-builds-table-scroll ssh-monitor-table-scroll">
          <table className="recent-builds-table ssh-monitor-table terminal-command-log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Command</th>
                <th>Location</th>
                <th>Status</th>
                <th>Exit Code</th>
              </tr>
            </thead>
            <tbody>
              {terminalCommandLog.length === 0 ? (
                <tr>
                  <td colSpan={5}>No terminal commands yet.</td>
                </tr>
              ) : (
                terminalCommandLog.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.time}</td>
                    <td>{entry.command}</td>
                    <td>{entry.location}</td>
                    <td>{entry.status}</td>
                    <td>{entry.exitCode}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function FilePreviewModal({
  preview,
  onClose,
}: {
  preview: FilePreviewState;
  onClose: () => void;
}): JSX.Element {
  const result = preview?.result ?? null;
  return (
    <Modal
      open={preview !== null}
      title={preview?.item.name ?? "File Preview"}
      subtitle={preview ? `${preview.source}: ${preview.item.path}` : undefined}
      size="xl"
      className="ssh-preview-modal log-zoom-modal"
      contentClassName="ssh-preview-modal-content log-zoom-modal-content"
      closeLabel="Close preview"
      onClose={onClose}
    >
      {preview?.loading ? (
        <div className="ssh-preview-state">Loading preview...</div>
      ) : preview?.error ? (
        <div className="ssh-preview-state">{preview.error}</div>
      ) : result?.kind === "image" && result.content ? (
        <div className="ssh-preview-image-wrap">
          <img src={`data:${result.mimeType};base64,${result.content}`} alt={result.fileName} />
        </div>
      ) : result?.kind === "pdf" && result.content ? (
        <iframe
          className="ssh-preview-frame"
          title={result.fileName}
          src={`data:${result.mimeType};base64,${result.content}`}
        />
      ) : isTextPreview(result) ? (
        <pre className="ssh-preview-text">{formatPreviewText(result)}</pre>
      ) : (
        <div className="ssh-preview-state">Preview not available</div>
      )}
    </Modal>
  );
}

function SftpPanelActions({
  disabled,
  label,
  onUpload,
  onDownload,
  onNewFolder,
  onRefresh,
  uploadDisabled,
  downloadDisabled,
}: {
  disabled: boolean;
  label: string;
  onUpload: () => void;
  onDownload: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  uploadDisabled: boolean;
  downloadDisabled: boolean;
}): JSX.Element {
  return (
    <span className="ssh-directory-actions" aria-label={`${label} actions`}>
      <SftpActionButton
        label={`${label} new folder`}
        disabled={disabled}
        onClick={onNewFolder}
      >
        <FolderPlus size={15} />
      </SftpActionButton>
      <SftpActionButton
        label={`${label} refresh`}
        disabled={disabled}
        onClick={onRefresh}
      >
        <RefreshCw size={15} />
      </SftpActionButton>
    </span>
  );
}

function SftpFileName({ name }: { name: string }): JSX.Element {
  const textRef = useRef<HTMLElement | null>(null);
  const [truncated, setTruncated] = useState(false);

  function updateTruncation(): void {
    const element = textRef.current;
    setTruncated(Boolean(element && element.scrollWidth > element.clientWidth));
  }

  return (
    <strong
      ref={textRef}
      title={truncated ? name : undefined}
      onMouseEnter={updateTruncation}
      onFocus={updateTruncation}
      tabIndex={-1}
    >
      {name}
    </strong>
  );
}

function SftpNameDialog({
  state,
  onChange,
  onClose,
  onSave,
}: {
  state: NonNullable<SftpNameDialogState>;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}): JSX.Element {
  const title = state.mode === "new-folder" ? "New Folder" : "Rename";
  const label = state.mode === "new-folder" ? "Folder name" : "New name";
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <section
        className="add-project-dialog ssh-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ssh-name-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="ssh-name-dialog-title">{title}</h2>
        <div className="add-project-fields">
          <label>
            <span>{label}</span>
            <input
              autoFocus
              value={state.value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onSave();
                }
                if (event.key === "Escape") {
                  onClose();
                }
              }}
            />
          </label>
        </div>
        <div className="dialog-actions">
          <button className="button secondary compact" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary compact"
            type="button"
            onClick={onSave}
            disabled={!state.value.trim()}
          >
            {state.mode === "new-folder" ? "Create" : "Rename"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SftpActionButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: JSX.Element;
  disabled: boolean;
  label: string;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      className="ssh-directory-action-button"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SftpNavButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: JSX.Element;
  disabled: boolean;
  label: string;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button
      className="ssh-path-nav-button"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function joinDirectoryPath(
  basePath: string,
  itemName: string,
  source: DirectorySource,
): string {
  if (source === "remote") {
    const normalizedBase = basePath.trim().replace(/\/+$/, "") || "/";
    return normalizedBase === "/" ? `/${itemName}` : `${normalizedBase}/${itemName}`;
  }

  const normalizedBase = basePath.trim().replace(/[\\/]+$/, "");
  if (!normalizedBase) {
    return itemName;
  }
  const separator = normalizedBase.includes("/") ? "/" : "\\";
  return `${normalizedBase}${separator}${itemName}`;
}

function toSftpItems(
  entries: DirectoryEntry[],
  _currentPath: string,
  source: DirectorySource,
): SftpItem[] {
  return entries.map((entry) => ({
    id: `${source}-${entry.path}`,
    name: entry.name,
    path: entry.path,
    type: entry.type,
    size: formatDirectoryEntrySize(entry.size),
    modified: formatDirectoryEntryModified(entry.modifiedMs),
  }));
}

function formatDirectoryEntrySize(size: number | null): string {
  if (size === null) {
    return "--";
  }
  return formatFileSize(size);
}

function formatDirectoryEntryModified(modifiedMs: number | null): string {
  if (modifiedMs === null) {
    return "--";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(modifiedMs));
}

function isTextPreview(result: FilePreviewResult | null): result is FilePreviewResult {
  return Boolean(
    result?.content &&
      result.encoding === "utf8" &&
      ["text", "json", "xml"].includes(result.kind),
  );
}

function formatPreviewText(result: FilePreviewResult): string {
  if (result.kind !== "json" || !result.content) {
    return result.content ?? "";
  }

  try {
    return JSON.stringify(JSON.parse(result.content), null, 2);
  } catch {
    return result.content;
  }
}

function formatMonitorTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatRemoteDirectoryTitle(server: SshServerConfig | null): string {
  if (!server?.address.trim()) {
    return "Remote Directory";
  }

  const host = server.address.trim();
  const username = server.username.trim();
  return username ? `Remote: ${username}@${host}` : `Remote: ${host}`;
}

function formatRemoteDirectoryTitleForHost(
  server: SshServerConfig | null,
  host: string,
): string {
  const trimmedHost = host.trim();
  if (!trimmedHost) {
    return formatRemoteDirectoryTitle(server);
  }
  const username = server?.username.trim() ?? "";
  return username ? `Remote: ${username}@${trimmedHost}` : `Remote: ${trimmedHost}`;
}

function isInteractivePasswordPrompt(partialLine: string): boolean {
  const value = partialLine.toLowerCase();
  if (!value) {
    return false;
  }
  // Matches things like:
  //   "user@host's password:"
  //   "Password:"
  //   "Enter passphrase for key '...':"
  //   "[sudo] password for user:"
  return (
    /(^|[\s'"])password\s*:\s*$/.test(value) ||
    /password\s+for\s+\S+\s*:\s*$/.test(value) ||
    /enter\s+passphrase[^:]*:\s*$/.test(value) ||
    /'s\s+password\s*:\s*$/.test(value)
  );
}

function normalizeStoredServer(value: unknown): SshServerConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<SshServerConfig>;
  const parsedEndpoint = parseStoredSshEndpoint(
    typeof record.address === "string" ? record.address : "",
  );
  const id =
    typeof record.id === "string" && record.id.length > 0
      ? record.id
      : `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: typeof record.name === "string" ? record.name : "Remote",
    address: parsedEndpoint.host,
    port: normalizeSshPort(record.port ?? parsedEndpoint.port),
    username: typeof record.username === "string" ? record.username.trim() : "",
    password: typeof record.password === "string" ? record.password : "",
    macs: typeof record.macs === "string" ? normalizeSshAlgorithmList(record.macs) : "",
    ciphers: typeof record.ciphers === "string" ? normalizeSshAlgorithmList(record.ciphers) : "",
    autoLogin: Boolean(record.autoLogin),
    autoReconnect: Boolean(record.autoReconnect),
    maxReconnectAttempts: clampInteger(
      record.maxReconnectAttempts,
      SSH_RECONNECT_ATTEMPTS_MIN,
      SSH_RECONNECT_ATTEMPTS_MAX,
      SSH_RECONNECT_ATTEMPTS_DEFAULT,
    ),
    reconnectDelayMs: clampInteger(
      record.reconnectDelayMs,
      SSH_RECONNECT_DELAY_MIN_MS,
      SSH_RECONNECT_DELAY_MAX_MS,
      SSH_RECONNECT_DELAY_DEFAULT_MS,
    ),
  };
}

function parseStoredSshEndpoint(address: string): { host: string; port: number } {
  const trimmed = address.trim();
  if (!trimmed) {
    return { host: "", port: SSH_PORT_DEFAULT };
  }

  const lastColonIndex = trimmed.lastIndexOf(":");
  if (lastColonIndex <= 0 || lastColonIndex === trimmed.length - 1) {
    return { host: trimmed, port: SSH_PORT_DEFAULT };
  }

  const host = trimmed.slice(0, lastColonIndex).trim();
  const portText = trimmed.slice(lastColonIndex + 1).trim();
  if (!host || !/^\d+$/.test(portText)) {
    return { host: trimmed, port: SSH_PORT_DEFAULT };
  }

  return {
    host,
    port: normalizeSshPort(Number.parseInt(portText, 10)),
  };
}

function normalizeSshPort(value: unknown): number {
  return clampInteger(value, SSH_PORT_MIN, SSH_PORT_MAX, SSH_PORT_DEFAULT);
}

function isValidSshPort(value: unknown): boolean {
  return normalizeSshPort(value) === value;
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value, 10)
      : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  if (numeric < min) {
    return min;
  }
  if (numeric > max) {
    return max;
  }
  return numeric;
}

function areSshServerConfigsEqual(
  left: SshServerConfig[],
  right: SshServerConfig[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((server, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      server.id === other.id &&
      server.name === other.name &&
      server.address === other.address &&
      server.port === other.port &&
      server.username === other.username &&
      server.password === other.password &&
      server.macs === other.macs &&
      server.ciphers === other.ciphers &&
      server.autoLogin === other.autoLogin &&
      server.autoReconnect === other.autoReconnect &&
      server.maxReconnectAttempts === other.maxReconnectAttempts &&
      server.reconnectDelayMs === other.reconnectDelayMs
    );
  });
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatConnectionStatusLabel(
  status: SshConnectionStatus,
  attempt: number,
  maxAttempts: number,
): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting...";
    case "reconnecting":
      return attempt > 0 && maxAttempts > 0
        ? `Reconnecting (${attempt}/${maxAttempts})...`
        : "Reconnecting...";
    case "failed":
      return "Failed";
    case "disconnected":
      return "Disconnected";
    default:
      return "Idle";
  }
}

function formatSshExecResult(result: SshExecResult): string[] {
  const lines = [
    ...splitCommandOutput(result.stdout),
    ...splitCommandOutput(result.stderr),
  ];

  if (result.error) {
    lines.push(`Command error: ${result.error}`);
  }

  if (result.exitCode !== null && result.exitCode !== 0) {
    lines.push(`Command exited with code ${result.exitCode}.`);
  }

  return lines;
}

function splitCommandOutput(output: string): string[] {
  if (!output) {
    return [];
  }

  const lines = output
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
  while (lines.length > 0 && isBlankTerminalOutputLine(lines[0])) {
    lines.shift();
  }
  while (
    lines.length > 0 &&
    isBlankTerminalOutputLine(lines[lines.length - 1])
  ) {
    lines.pop();
  }

  return lines;
}

function isBlankTerminalOutputLine(line: string): boolean {
  return stripAnsiControlSequences(line).trim().length === 0;
}

function SshTerminalOutput({
  lines,
  prompt,
  command,
  disabled,
  running,
  passwordMode,
  suggestions,
  highlightedSuggestionIndex,
  scrollRequest,
  focusRequest,
  onCommandChange,
  onCommandKeyDown,
  onSuggestionHover,
  onSuggestionSelect,
}: {
  lines: string[];
  prompt: string;
  command: string;
  disabled: boolean;
  running: boolean;
  passwordMode: boolean;
  suggestions: TerminalSuggestion[];
  highlightedSuggestionIndex: number;
  scrollRequest: number;
  focusRequest: number;
  onCommandChange: (value: string) => void;
  onCommandKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onSuggestionHover: (index: number) => void;
  onSuggestionSelect: (suggestion: TerminalSuggestion) => void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldFollowOutputRef = useRef(true);
  const previousScrollRequestRef = useRef(scrollRequest);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: lines.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => SSH_TERMINAL_ROW_HEIGHT,
    overscan: 16,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const receivedExplicitScrollRequest = previousScrollRequestRef.current !== scrollRequest;
    previousScrollRequestRef.current = scrollRequest;
    if (receivedExplicitScrollRequest || shouldFollowOutputRef.current) {
      container.scrollTop = container.scrollHeight;
      shouldFollowOutputRef.current = true;
    }
  }, [lines.length, scrollRequest, virtualizer]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [focusRequest]);

  function handleScroll(): void {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    shouldFollowOutputRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < 48;
  }

  function focusInput(): void {
    inputRef.current?.focus();
    shouldFollowOutputRef.current = true;
  }

  function hasActiveTextSelection(): boolean {
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
  }

  function focusInputFromTerminalClick(
    event: ReactMouseEvent<HTMLDivElement>,
  ): void {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("input, button, textarea, select, a")
    ) {
      return;
    }
    // Allow drag-to-select inside the terminal; only refocus the input when
    // the user actually releases without selecting text.
    if (hasActiveTextSelection()) {
      return;
    }
    focusInput();
  }

  return (
    <div
      className="ssh-terminal"
      data-testid="ssh-terminal"
      ref={containerRef}
      aria-live="polite"
      onScroll={handleScroll}
      onClick={focusInputFromTerminalClick}
      style={{ userSelect: "text" }}
    >
      <div
        className="ssh-terminal-virtual-spacer"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const line = lines[virtualItem.index] ?? "";
          return (
            <div
              className={`ssh-terminal-line ${getTerminalLineClass(line)}`}
              data-index={virtualItem.index}
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              style={{
                minHeight: `${SSH_TERMINAL_ROW_HEIGHT}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
              dangerouslySetInnerHTML={{
                __html: renderTerminalLineHtml(line),
              }}
            />
          );
        })}
      </div>
      <div
        className="ssh-terminal-active-line"
        onClick={(event) => {
          event.stopPropagation();
          focusInputFromTerminalClick(event);
        }}
      >
        <span className="ssh-terminal-active-prompt">{prompt}</span>
        <input
          ref={inputRef}
          className="ssh-terminal-inline-input"
          type={passwordMode ? "password" : "text"}
          value={command}
          onChange={(event) => onCommandChange(event.target.value)}
          onKeyDown={onCommandKeyDown}
          aria-label={passwordMode ? "SSH password input" : "SSH command"}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={disabled || running}
          placeholder={
            running
              ? "running..."
              : passwordMode
                ? "password (hidden)"
                : disabled
                  ? "connect to run commands"
                  : ""
          }
        />
        {!passwordMode && suggestions.length > 0 && (
          <div className="ssh-terminal-suggestions" role="listbox">
            {suggestions.map((suggestion, index) => (
              <button
                className={`ssh-terminal-suggestion ${
                  index === highlightedSuggestionIndex ? "is-active" : ""
                }`}
                key={`${suggestion.source}-${suggestion.value}`}
                role="option"
                aria-selected={index === highlightedSuggestionIndex}
                type="button"
                onMouseEnter={() => onSuggestionHover(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSuggestionSelect(suggestion)}
              >
                <span>{suggestion.label}</span>
                <small>{suggestion.source}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function addCommandHistoryEntry(history: string[], command: string): string[] {
  const trimmed = command.trim();
  if (!trimmed) {
    return history;
  }
  const lastCommand = history[history.length - 1];
  if (lastCommand === trimmed) {
    return history;
  }
  return [...history, trimmed].slice(-100);
}

function buildTerminalSuggestions({
  command,
  history,
  remoteItems,
  remotePath,
}: {
  command: string;
  history: string[];
  remoteItems: SftpItem[];
  remotePath: string;
}): TerminalSuggestion[] {
  const query = getCurrentCommandToken(command).toLowerCase();
  const fullQuery = command.trimStart().toLowerCase();
  if (!query && !fullQuery) {
    return [];
  }

  const seen = new Set<string>();
  const suggestions: TerminalSuggestion[] = [];
  const addSuggestion = (value: string, source: TerminalSuggestion["source"]): void => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    const label = source === "file" ? quoteShellPathIfNeeded(trimmed) : trimmed;
    const lowerLabel = label.toLowerCase();
    const isCommandLike = source === "command" || source === "history";
    const matches = isCommandLike
      ? lowerLabel.startsWith(fullQuery)
      : lowerLabel.startsWith(query);
    if (!matches) {
      return;
    }
    seen.add(trimmed);
    suggestions.push({ value: label, label, source });
  };

  [...history].reverse().forEach((entry) => addSuggestion(entry, "history"));
  SSH_COMMAND_SUGGESTIONS.forEach((entry) => addSuggestion(entry, "command"));
  if (remotePath.trim()) {
    addSuggestion(remotePath, "path");
  }
  remoteItems.forEach((item) => addSuggestion(item.name, item.type === "folder" ? "path" : "file"));

  return suggestions.slice(0, 16);
}

function getCurrentCommandToken(command: string): string {
  const match = command.match(/(?:^|\s)(\S*)$/);
  return match?.[1] ?? command;
}

function applyTerminalSuggestion(command: string, suggestion: string): string {
  const token = getCurrentCommandToken(command);
  if (!token) {
    return suggestion;
  }
  const tokenStart = command.lastIndexOf(token);
  if (tokenStart < 0) {
    return suggestion;
  }
  return `${command.slice(0, tokenStart)}${suggestion}`;
}

function quoteShellPathIfNeeded(value: string): string {
  if (!/\s/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getDirectoryLocation(
  source: DirectorySource,
  localPath: string,
  remotePath: string,
): string {
  return (source === "local" ? localPath : remotePath) || "--";
}

function renderSftpItemIcon(item: SftpItem): JSX.Element {
  if (item.type === "folder") {
    return <Folder size={16} />;
  }
  const extension = getFileExtension(item.name);
  if (isImageExtension(extension)) {
    return <Image size={16} />;
  }
  if (isDocumentFileExtension(extension)) {
    return <FileText size={16} />;
  }
  return <FileIcon size={16} />;
}

function getFileExtension(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === name.length - 1) {
    return "";
  }
  return name.slice(dotIndex + 1).toLowerCase();
}

function isImageExtension(extension: string): boolean {
  return ["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"].includes(extension);
}

function isDocumentFileExtension(extension: string): boolean {
  return [
    "conf",
    "css",
    "csv",
    "html",
    "ini",
    "java",
    "js",
    "json",
    "log",
    "md",
    "sh",
    "sql",
    "text",
    "ts",
    "tsx",
    "txt",
    "xml",
    "yaml",
    "yml",
  ].includes(extension);
}

function formatSshPrompt(
  server: SshServerConfig | null,
  remoteCwd: string | null,
): string {
  const address = server?.address.trim() || "ssh";
  const host = address;
  const userHost = server?.username.trim()
    ? `${server.username.trim()}@${host}`
    : host;
  const cwd = remoteCwd?.trim() || "";
  return cwd ? `${userHost} ${cwd} >` : `${userHost} >`;
}

function getTerminalLineClass(line: string): string {
  const lower = stripAnsi(line).toLowerCase();
  if (/^[^\s@]+@[^\s]+(?:\s+\S.*)?\s[>$]\s?/.test(lower)) {
    return "ssh-terminal-line-prompt";
  }
  if (
    lower.startsWith("connecting ") ||
    lower.includes("session idle") ||
    lower.includes("select a server")
  ) {
    return "ssh-terminal-line-muted";
  }
  if (
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("denied")
  ) {
    return "ssh-terminal-line-error";
  }
  if (lower.includes("warn") || lower.includes("reconnecting")) {
    return "ssh-terminal-line-warning";
  }
  if (lower.includes("connected") || lower.includes("success")) {
    return "ssh-terminal-line-success";
  }
  return "ssh-terminal-line-output";
}

function renderTerminalLineHtml(line: string): string {
  if (line.includes("\u001b[")) {
    return stripAnsiControlSequences(ansiToHtml(escapeHtml(line)));
  }

  return (
    renderPromptLineHtml(line) ??
    renderLongListingLineHtml(line) ??
    renderDirectoryListingLineHtml(line) ??
    escapeHtml(line)
  );
}

function renderPromptLineHtml(line: string): string | null {
  const match = /^([^\s@]+@[^\s]+)(.*?\s[>$])(\s?)(.*)$/.exec(line);
  if (!match) {
    return null;
  }

  const [, userHost, promptMarker, spacer, commandText] = match;
  const commandHtml = commandText
    ? `<span class="ssh-terminal-token-command">${escapeHtml(commandText)}</span>`
    : "";

  return `<span class="ssh-terminal-token-userhost">${escapeHtml(userHost)}</span><span class="ssh-terminal-token-prompt-marker">${escapeHtml(promptMarker)}</span>${escapeHtml(spacer)}${commandHtml}`;
}

function renderLongListingLineHtml(line: string): string | null {
  const parts = line.match(/\s+|\S+/g) ?? [];
  const tokens = parts.filter((part) => !/^\s+$/.test(part));
  const permissionToken = tokens[0] ?? "";
  if (!/^[bcdlps-][rwxstST-]{9}[.+@]?$/.test(permissionToken)) {
    return null;
  }

  const nameClass = permissionToken.startsWith("d")
    ? "ssh-terminal-token-directory"
    : "ssh-terminal-token-file";
  let tokenIndex = 0;

  return parts
    .map((part) => {
      if (/^\s+$/.test(part)) {
        return escapeHtml(part);
      }

      const className =
        tokenIndex < 8 ? "ssh-terminal-token-meta" : nameClass;
      tokenIndex += 1;
      return `<span class="${className}">${escapeHtml(part)}</span>`;
    })
    .join("");
}

function renderDirectoryListingLineHtml(line: string): string | null {
  if (!line.trim()) {
    return null;
  }

  const startsWithTotal = /^total\s+\d+/i.test(line);
  let changed = startsWithTotal;

  const html = (line.match(/\s+|\S+/g) ?? [])
    .map((part) => {
      if (/^\s+$/.test(part)) {
        return escapeHtml(part);
      }

      if (startsWithTotal) {
        return `<span class="ssh-terminal-token-meta">${escapeHtml(part)}</span>`;
      }

      const cleanPart = part.replace(/[/:]+$/, "");
      if (TERMINAL_DIRECTORY_NAMES.has(cleanPart) || part.endsWith("/")) {
        changed = true;
        return `<span class="ssh-terminal-token-directory">${escapeHtml(part)}</span>`;
      }

      if (/\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(cleanPart)) {
        changed = true;
        return `<span class="ssh-terminal-token-file">${escapeHtml(part)}</span>`;
      }

      return escapeHtml(part);
    })
    .join("");

  return changed ? html : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripAnsi(value: string): string {
  return stripAnsiControlSequences(value);
}

function stripAnsiControlSequences(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()][A-Za-z0-9]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function ansiToHtml(value: string): string {
  const colorClassByCode: Record<string, string> = {
    "30": "ansi-black",
    "31": "ansi-red",
    "32": "ansi-green",
    "33": "ansi-yellow",
    "34": "ansi-blue",
    "35": "ansi-magenta",
    "36": "ansi-cyan",
    "37": "ansi-white",
    "90": "ansi-bright-black",
    "91": "ansi-bright-red",
    "92": "ansi-bright-green",
    "93": "ansi-bright-yellow",
    "94": "ansi-bright-blue",
    "95": "ansi-bright-magenta",
    "96": "ansi-bright-cyan",
    "97": "ansi-bright-white",
  };
  const segments: string[] = [];
  let cursor = 0;
  let activeClass = "";
  const pattern = /\u001b\[([0-9;]*)m/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) {
      segments.push(
        wrapAnsiSegment(value.slice(cursor, match.index), activeClass),
      );
    }
    const codes = match[1].split(";").filter(Boolean);
    if (codes.length === 0 || codes.includes("0")) {
      activeClass = "";
    } else {
      const colorCode = [...codes]
        .reverse()
        .find((code) => colorClassByCode[code]);
      if (colorCode) {
        activeClass = colorClassByCode[colorCode];
      }
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < value.length) {
    segments.push(wrapAnsiSegment(value.slice(cursor), activeClass));
  }

  return segments.join("");
}

function wrapAnsiSegment(value: string, className: string): string {
  return className ? `<span class="${className}">${value}</span>` : value;
}
