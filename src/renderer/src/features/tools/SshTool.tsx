import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Download,
  Eye,
  EyeOff,
  FileText,
  Folder,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  PlugZap,
  Plus,
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
import type { SshExecResult } from "../../../../shared/dashboardTypes";

export type SshServerConfig = {
  id: string;
  name: string;
  address: string;
  username: string;
  password: string;
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

type SftpItem = {
  id: string;
  name: string;
  type: "file" | "folder";
  size: string;
  modified: string;
};

type TransferDragPayload = {
  source: "local" | "remote";
  itemId: string;
};

const SSH_SERVERS_STORAGE_KEY = "ivs-ssh-tool-servers";
const SSH_SELECTED_SERVER_STORAGE_KEY = "ivs-ssh-tool-selected-server";
const DEFAULT_SSH_SERVER_ID = "local-dev";
const DEFAULT_SSH_SERVERS: SshServerConfig[] = [
  {
    id: DEFAULT_SSH_SERVER_ID,
    name: "Local Dev",
    address: "127.0.0.1:22",
    username: "",
    password: "",
    autoLogin: false,
    autoReconnect: false,
    maxReconnectAttempts: SSH_RECONNECT_ATTEMPTS_DEFAULT,
    reconnectDelayMs: SSH_RECONNECT_DELAY_DEFAULT_MS,
  },
];
const INITIAL_LOCAL_ITEMS: SftpItem[] = [
  {
    id: "local-src",
    name: "src",
    type: "folder",
    size: "--",
    modified: "Today 09:42",
  },
  {
    id: "local-env",
    name: ".env.local",
    type: "file",
    size: "2 KB",
    modified: "Today 08:16",
  },
  {
    id: "local-package",
    name: "package.json",
    type: "file",
    size: "5 KB",
    modified: "Yesterday 17:31",
  },
];
const INITIAL_REMOTE_ITEMS: SftpItem[] = [
  {
    id: "remote-app",
    name: "app",
    type: "folder",
    size: "--",
    modified: "May 27 10:12",
  },
  {
    id: "remote-logs",
    name: "logs",
    type: "folder",
    size: "--",
    modified: "May 27 10:04",
  },
  {
    id: "remote-readme",
    name: "README.md",
    type: "file",
    size: "3 KB",
    modified: "May 26 15:22",
  },
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
    server.username.trim().length > 0 &&
    server.password.trim().length > 0
  );
}

export function hasValidSshCredential(
  servers: ReadonlyArray<SshServerConfig>,
): boolean {
  return servers.some(isValidSshServerCredential);
}

export function SshHeaderTabs(): JSX.Element {
  return (
    <div className="tabs" role="tablist" aria-label="SSH sections">
      <button className="tab active" type="button" role="tab" aria-selected>
        SSH
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
        className="icon-button primary header-settings-button ssh-header-disconnect-button"
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
  credentialRequired = false,
  onSave,
  onClose,
}: {
  open: boolean;
  servers: SshServerConfig[];
  credentialRequired?: boolean;
  onSave: (servers: SshServerConfig[]) => void;
  onClose: () => void;
}): JSX.Element {
  const [draftServers, setDraftServers] = useState<SshServerConfig[]>(servers);
  const [visiblePasswordIds, setVisiblePasswordIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const dirty = useMemo(
    () => !areSshServerConfigsEqual(draftServers, servers),
    [draftServers, servers],
  );
  const savedServerIds = useMemo(
    () => new Set(servers.map((server) => server.id)),
    [servers],
  );
  const draftHasValidCredential = useMemo(
    () => hasValidSshCredential(draftServers),
    [draftServers],
  );
  const shouldShowCredentialWarning =
    credentialRequired && !draftHasValidCredential;

  useEffect(() => {
    if (open) {
      setDraftServers(servers);
      setVisiblePasswordIds(new Set());
      setDiscardConfirmOpen(false);
    }
  }, [open, servers]);

  function requestClose(): void {
    if (dirty) {
      setDiscardConfirmOpen(true);
      return;
    }

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
    const nextIndex = draftServers.length + 1;
    setDraftServers((current) => [
      ...current,
      {
        id: `ssh-${Date.now()}`,
        name: `Remote ${nextIndex}`,
        address: "",
        username: "",
        password: "",
        autoLogin: false,
        autoReconnect: false,
        maxReconnectAttempts: SSH_RECONNECT_ATTEMPTS_DEFAULT,
        reconnectDelayMs: SSH_RECONNECT_DELAY_DEFAULT_MS,
      },
    ]);
  }

  function removeServer(serverId: string): void {
    setDraftServers((current) =>
      current.length <= 1
        ? current
        : current.filter((server) => server.id !== serverId),
    );
    setVisiblePasswordIds((current) => {
      if (!current.has(serverId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(serverId);
      return next;
    });
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
      username: server.username.trim(),
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
    setDiscardConfirmOpen(false);
    onClose();
  }

  return (
    <Modal
      open={open}
      title={
        <span className="ssh-settings-title">
          SSH Settings
          <span className="build-profiles-count-badge">
            {draftServers.length}
          </span>
        </span>
      }
      size="xl"
      className="ssh-settings-modal"
      contentClassName="ssh-settings-modal-content"
      closeLabel="Close SSH settings"
      headerAction={
        <button
          className="icon-button primary"
          type="button"
          aria-label="Add SSH server"
          title="Add SSH server"
          onClick={addServer}
        >
          <Plus size={16} />
        </button>
      }
      onClose={requestClose}
    >
      <div className="ssh-settings-table-wrap">
        <table className="build-profiles-table ssh-settings-table">
          <thead>
            <tr>
              <th>Remote Name</th>
              <th>Address</th>
              <th>Username</th>
              <th>Password</th>
              <th>Auto-login</th>
              <th>Auto-reconnect</th>
              <th>Retry attempts</th>
              <th>Retry delay (ms)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {draftServers.map((server) => {
              const passwordVisible = visiblePasswordIds.has(server.id);

              return (
                <tr
                  className={
                    savedServerIds.has(server.id)
                      ? undefined
                      : "ssh-server-row-new"
                  }
                  key={server.id}
                >
                  <td>
                    <div className="ssh-server-name-cell">
                      {!savedServerIds.has(server.id) ? (
                        <span
                          className="ssh-server-new-dot"
                          aria-hidden="true"
                        />
                      ) : null}
                      <input
                        aria-label="Remote name"
                        type="text"
                        value={server.name}
                        onChange={(event) =>
                          updateServer(server.id, { name: event.target.value })
                        }
                      />
                    </div>
                  </td>
                  <td>
                    <input
                      aria-label="Address"
                      placeholder="host:22"
                      type="text"
                      value={server.address}
                      onChange={(event) =>
                        updateServer(server.id, { address: event.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Username"
                      type="text"
                      value={server.username}
                      onChange={(event) =>
                        updateServer(server.id, {
                          username: event.target.value,
                        })
                      }
                    />
                  </td>
                  <td>
                    <span className="ssh-password-field">
                      <input
                        aria-label="Password"
                        type={passwordVisible ? "text" : "password"}
                        value={server.password}
                        autoComplete="current-password"
                        onChange={(event) =>
                          updateServer(server.id, {
                            password: event.target.value,
                          })
                        }
                      />
                      <button
                        className="icon-button secondary ssh-password-toggle"
                        type="button"
                        aria-label={
                          passwordVisible ? "Hide password" : "Show password"
                        }
                        title={
                          passwordVisible ? "Hide password" : "Show password"
                        }
                        onClick={() => togglePasswordVisibility(server.id)}
                      >
                        {passwordVisible ? (
                          <EyeOff size={15} />
                        ) : (
                          <Eye size={15} />
                        )}
                      </button>
                    </span>
                  </td>
                  <td>
                    <label className="builder-confirm ssh-auto-login-field">
                      <input
                        type="checkbox"
                        checked={server.autoLogin}
                        onChange={(event) =>
                          updateServer(server.id, {
                            autoLogin: event.target.checked,
                          })
                        }
                      />
                    </label>
                  </td>
                  <td>
                    <label className="builder-confirm ssh-auto-login-field">
                      <input
                        type="checkbox"
                        checked={server.autoReconnect}
                        onChange={(event) =>
                          updateServer(server.id, {
                            autoReconnect: event.target.checked,
                          })
                        }
                      />
                    </label>
                  </td>
                  <td>
                    <input
                      aria-label="Retry attempts"
                      className="ssh-numeric-input"
                      type="number"
                      min={SSH_RECONNECT_ATTEMPTS_MIN}
                      max={SSH_RECONNECT_ATTEMPTS_MAX}
                      step={1}
                      disabled={!server.autoReconnect}
                      value={server.maxReconnectAttempts}
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        updateServer(server.id, {
                          maxReconnectAttempts: Number.isFinite(parsed)
                            ? parsed
                            : SSH_RECONNECT_ATTEMPTS_DEFAULT,
                        });
                      }}
                      onBlur={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        updateServer(server.id, {
                          maxReconnectAttempts: clampInteger(
                            parsed,
                            SSH_RECONNECT_ATTEMPTS_MIN,
                            SSH_RECONNECT_ATTEMPTS_MAX,
                            SSH_RECONNECT_ATTEMPTS_DEFAULT,
                          ),
                        });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Retry delay in milliseconds"
                      className="ssh-numeric-input"
                      type="number"
                      min={SSH_RECONNECT_DELAY_MIN_MS}
                      max={SSH_RECONNECT_DELAY_MAX_MS}
                      step={500}
                      disabled={!server.autoReconnect}
                      value={server.reconnectDelayMs}
                      onChange={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        updateServer(server.id, {
                          reconnectDelayMs: Number.isFinite(parsed)
                            ? parsed
                            : SSH_RECONNECT_DELAY_DEFAULT_MS,
                        });
                      }}
                      onBlur={(event) => {
                        const parsed = Number.parseInt(event.target.value, 10);
                        updateServer(server.id, {
                          reconnectDelayMs: clampInteger(
                            parsed,
                            SSH_RECONNECT_DELAY_MIN_MS,
                            SSH_RECONNECT_DELAY_MAX_MS,
                            SSH_RECONNECT_DELAY_DEFAULT_MS,
                          ),
                        });
                      }}
                    />
                  </td>
                  <td>
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label="Remove server"
                      title="Remove server"
                      disabled={draftServers.length <= 1}
                      onClick={() => removeServer(server.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
      {discardConfirmOpen ? (
        <ConfirmDialog
          title="Discard SSH settings changes?"
          message=""
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

export function SshTool({
  selectedServer,
  disabled = false,
  connectionStatus = "idle",
  reconnectAttempt = 0,
  reconnectMaxAttempts = 0,
  remoteCwd = null,
  onConfigure,
  onCommandSubmit,
}: {
  selectedServer: SshServerConfig | null;
  disabled?: boolean;
  connectionStatus?: SshConnectionStatus;
  reconnectAttempt?: number;
  reconnectMaxAttempts?: number;
  remoteCwd?: string | null;
  onConfigure?: () => void;
  onCommandSubmit?: (command: string) => Promise<SshExecResult>;
}): JSX.Element {
  const [command, setCommand] = useState("");
  const [commandRunning, setCommandRunning] = useState(false);
  const [localPath, setLocalPath] = useState("D:/Projects/ivs-dashboard");
  const [remotePath, setRemotePath] = useState("/var/www/app");
  const [localItems, setLocalItems] = useState<SftpItem[]>(INITIAL_LOCAL_ITEMS);
  const [remoteItems, setRemoteItems] =
    useState<SftpItem[]>(INITIAL_REMOTE_ITEMS);
  const [commandPanelCollapsed, setCommandPanelCollapsed] = useState(false);
  const [dragOverPanel, setDragOverPanel] = useState<"local" | "remote" | null>(
    null,
  );
  const [terminalLines, setTerminalLines] = useState<string[]>(() => [
    "SSH session idle.",
    "Select a server and enter a command.",
  ]);
  const previousStatusRef = useRef<SshConnectionStatus>(connectionStatus);
  const previousServerIdRef = useRef<string | null>(selectedServer?.id ?? null);

  const connected = connectionStatus === "connected";
  const commandInputDisabled = disabled;
  const commandSubmitDisabled = disabled || commandRunning;

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
        ? `${selectedServer.username}@${selectedServer.address}`
        : (selectedServer?.address ?? "server");

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
  async function submitCommand(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (commandSubmitDisabled) {
      return;
    }
    const trimmed = command.trim();
    if (!trimmed) {
      return;
    }
    setCommand("");

    if (trimmed === "clear") {
      setTerminalLines([formatSshPrompt(selectedServer, remoteCwd)]);
      return;
    }

    const prompt = formatSshPrompt(selectedServer, remoteCwd);
    appendLines([`${prompt} ${trimmed}`]);

    if (!connected) {
      appendLines(["Not connected. Please connect to the SSH server first."]);
      return;
    }

    if (!onCommandSubmit) {
      appendLines(["SSH backend is not available. Command was not executed."]);
      return;
    }

    setCommandRunning(true);
    try {
      const result = await onCommandSubmit(trimmed);
      appendLines(formatSshExecResult(result));
    } catch (error) {
      appendLines([
        `Command error: ${
          error instanceof Error
            ? error.message
            : "SSH backend is not available."
        }`,
      ]);
    } finally {
      setCommandRunning(false);
    }
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
      transferListedItem(payloadText, target);
      return;
    }

    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length === 0) {
      return;
    }
    const items = droppedFiles.map(fileToSftpItem);
    if (target === "local") {
      setLocalItems((current) => mergeSftpItems(current, items));
    } else {
      setRemoteItems((current) => mergeSftpItems(current, items));
    }
    appendTransferLine(
      `${items.length} item${items.length === 1 ? "" : "s"} added to ${target}.`,
    );
  }

  function transferListedItem(
    payloadText: string,
    target: "local" | "remote",
  ): void {
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
      const copiedItem = {
        ...item,
        id: `${target}-${Date.now()}-${item.name}`,
        modified: "Just now",
      };
      if (target === "local") {
        setLocalItems((current) => mergeSftpItems(current, [copiedItem]));
        appendTransferLine(`Downloaded ${item.name} to ${localPath}.`);
      } else {
        setRemoteItems((current) => mergeSftpItems(current, [copiedItem]));
        appendTransferLine(`Uploaded ${item.name} to ${remotePath}.`);
      }
    } catch {
      // Ignore malformed external drag data.
    }
  }

  function appendTransferLine(line: string): void {
    setTerminalLines((current) => [...current, line]);
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
        <SshTerminalOutput lines={terminalLines} />
        <form className="ssh-command-row" onSubmit={submitCommand}>
          <TerminalSquare size={17} />
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={
              connected
                ? "Enter SSH command"
                : "Connect to a server to run commands"
            }
            aria-label="SSH command"
            disabled={commandInputDisabled}
          />
          <button
            className="button primary compact"
            type="submit"
            disabled={commandSubmitDisabled}
          >
            {commandRunning ? "Running" : "Run"}
          </button>
        </form>
      </Panel>

      <div className="ssh-directory-column">
        <SftpPanel
          title="Local Directory"
          path={localPath}
          transferLabel="Drop here to download"
          items={localItems}
          source="local"
          dragOver={dragOverPanel === "local"}
          actionIcon={<Download size={15} />}
          disabled={disabled}
          onPathChange={setLocalPath}
          onDragStart={handleItemDragStart}
          onDragOver={handleDirectoryDragOver}
          onDrop={handleDirectoryDrop}
          onDragLeave={() => setDragOverPanel(null)}
        />
        <SftpPanel
          title="Remote Directory"
          path={remotePath}
          transferLabel="Drop here to upload"
          items={remoteItems}
          source="remote"
          dragOver={dragOverPanel === "remote"}
          actionIcon={<Upload size={15} />}
          disabled={disabled}
          onPathChange={setRemotePath}
          onDragStart={handleItemDragStart}
          onDragOver={handleDirectoryDragOver}
          onDrop={handleDirectoryDrop}
          onDragLeave={() => setDragOverPanel(null)}
        />
      </div>
    </section>
  );
}

function SftpPanel({
  title,
  path,
  transferLabel,
  items,
  source,
  dragOver,
  actionIcon,
  disabled,
  onPathChange,
  onDragStart,
  onDragOver,
  onDrop,
  onDragLeave,
}: {
  title: string;
  path: string;
  transferLabel: string;
  items: SftpItem[];
  source: "local" | "remote";
  dragOver: boolean;
  actionIcon: JSX.Element;
  disabled: boolean;
  onPathChange: (path: string) => void;
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
  return (
    <Panel
      title={title}
      className={`ssh-directory-panel${dragOver ? " drag-over" : ""}`}
      action={
        <span className="ssh-transfer-badge">
          {actionIcon}
          {transferLabel}
        </span>
      }
    >
      <input
        className="ssh-path-input"
        value={path}
        onChange={(event) => onPathChange(event.target.value)}
        aria-label={`${title} path`}
        disabled={disabled}
      />
      <div
        className="ssh-file-list"
        onDragOver={(event) => onDragOver(event, source)}
        onDrop={(event) => onDrop(event, source)}
        onDragLeave={onDragLeave}
      >
        {items.map((item) => (
          <div
            className="ssh-file-row"
            draggable={!disabled}
            key={item.id}
            onDragStart={(event) => onDragStart(event, source, item.id)}
          >
            {item.type === "folder" ? (
              <Folder size={16} />
            ) : (
              <FileText size={16} />
            )}
            <strong>{item.name}</strong>
            <span>{item.size}</span>
            <span>{item.modified}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function normalizeStoredServer(value: unknown): SshServerConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<SshServerConfig>;
  const id =
    typeof record.id === "string" && record.id.length > 0
      ? record.id
      : `ssh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: typeof record.name === "string" ? record.name : "Remote",
    address: typeof record.address === "string" ? record.address.trim() : "",
    username: typeof record.username === "string" ? record.username.trim() : "",
    password: typeof record.password === "string" ? record.password : "",
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

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
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
      server.username === other.username &&
      server.password === other.password &&
      server.autoLogin === other.autoLogin &&
      server.autoReconnect === other.autoReconnect &&
      server.maxReconnectAttempts === other.maxReconnectAttempts &&
      server.reconnectDelayMs === other.reconnectDelayMs
    );
  });
}

function fileToSftpItem(file: File): SftpItem {
  return {
    id: `file-${Date.now()}-${file.name}`,
    name: file.name,
    type: "file",
    size: formatFileSize(file.size),
    modified: "Just now",
  };
}

function mergeSftpItems(current: SftpItem[], incoming: SftpItem[]): SftpItem[] {
  const existingNames = new Set(current.map((item) => item.name));
  const additions = incoming.filter((item) => !existingNames.has(item.name));
  return [...additions, ...current];
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

  return output
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter(
      (line, index, lines) => line.length > 0 || index < lines.length - 1,
    );
}

function SshTerminalOutput({ lines }: { lines: string[] }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: lines.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 22,
    overscan: 16,
  });

  useEffect(() => {
    if (lines.length === 0) {
      return;
    }
    virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
  }, [lines.length, virtualizer]);

  return (
    <div
      className="ssh-terminal"
      data-testid="ssh-terminal"
      ref={containerRef}
      aria-live="polite"
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
                transform: `translateY(${virtualItem.start}px)`,
              }}
              dangerouslySetInnerHTML={{
                __html: renderTerminalLineHtml(line),
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function formatSshPrompt(
  server: SshServerConfig | null,
  remoteCwd: string | null,
): string {
  const address = server?.address.trim() || "ssh";
  const host = address.includes(":")
    ? address.slice(0, address.lastIndexOf(":"))
    : address;
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
  return stripAnsiControlSequences(ansiToHtml(escapeHtml(line)));
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
  return value.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

function stripAnsiControlSequences(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
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
