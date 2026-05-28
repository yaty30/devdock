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
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileText,
  Folder,
  FolderPlus,
  FolderUp,
  Home,
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

type SftpTreeRow = SftpItem & {
  depth: number;
  expanded?: boolean;
  hasChildren?: boolean;
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
    id: "remote-env",
    name: ".env",
    type: "file",
    size: "1 KB",
    modified: "May 27 09:58",
  },
  {
    id: "remote-readme",
    name: "README.md",
    type: "file",
    size: "3 KB",
    modified: "May 26 15:22",
  },
];
const LOCAL_TREE_CHILDREN: SftpItem[] = [
  {
    id: "local-src-components",
    name: "components",
    type: "folder",
    size: "--",
    modified: "Today 09:20",
  },
  {
    id: "local-src-pages",
    name: "pages",
    type: "folder",
    size: "--",
    modified: "Today 08:58",
  },
  {
    id: "local-src-assets",
    name: "assets",
    type: "folder",
    size: "--",
    modified: "Today 08:45",
  },
];
const REMOTE_TREE_CHILDREN: SftpItem[] = [
  {
    id: "remote-app-http",
    name: "Http",
    type: "folder",
    size: "--",
    modified: "May 27 10:11",
  },
  {
    id: "remote-app-models",
    name: "Models",
    type: "folder",
    size: "--",
    modified: "May 27 10:11",
  },
  {
    id: "remote-app-providers",
    name: "Providers",
    type: "folder",
    size: "--",
    modified: "May 27 10:11",
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
                ? "Type here"
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
          items={localItems}
          source="local"
          dragOver={dragOverPanel === "local"}
          disabled={disabled}
          onPathChange={setLocalPath}
          onDragStart={handleItemDragStart}
          onDragOver={handleDirectoryDragOver}
          onDrop={handleDirectoryDrop}
          onDragLeave={() => setDragOverPanel(null)}
        />
        <SftpPanel
          title="Remote: admin@promaxgb10-64b5"
          path={remotePath}
          items={remoteItems}
          source="remote"
          dragOver={dragOverPanel === "remote"}
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
  items,
  source,
  dragOver,
  disabled,
  onPathChange,
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
  const treeRows = buildSftpTreeRows(source, items);
  const panelLabel = source === "local" ? "Local Directory" : "Remote Directory";

  return (
    <Panel
      title={title}
      className={`ssh-directory-panel${dragOver ? " drag-over" : ""}`}
      action={<SftpPanelActions disabled={disabled} label={panelLabel} />}
    >
      <div className="ssh-path-row" aria-label={`${title} navigation`}>
        <SftpNavButton label={`${panelLabel} back`} disabled={disabled}>
          <ArrowLeft size={15} />
        </SftpNavButton>
        <SftpNavButton label={`${panelLabel} forward`} disabled={disabled}>
          <ArrowRight size={15} />
        </SftpNavButton>
        <SftpNavButton
          label={`${panelLabel} parent directory`}
          disabled={disabled}
          onClick={() => onPathChange(getParentDirectoryPath(path, source))}
        >
          <FolderUp size={15} />
        </SftpNavButton>
        <SftpNavButton
          label={`${panelLabel} home`}
          disabled={disabled}
          onClick={() => onPathChange(getDefaultDirectoryPath(source))}
        >
          <Home size={15} />
        </SftpNavButton>
        <input
          className="ssh-path-input"
          value={path}
          onChange={(event) => onPathChange(event.target.value)}
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
          {treeRows.map((item) => (
            <div
              className={`ssh-file-row ssh-file-row-depth-${item.depth}`}
              draggable={!disabled}
              key={item.id}
              onDragStart={(event) => onDragStart(event, source, item.id)}
              role="row"
            >
              <div className="ssh-file-name-cell">
                <span className="ssh-tree-guides" aria-hidden="true" />
                <span className="ssh-tree-chevron" aria-hidden="true">
                  {item.type === "folder" && item.hasChildren ? (
                    item.expanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )
                  ) : null}
                </span>
                <span className="ssh-file-kind-icon" aria-hidden="true">
                  {item.type === "folder" ? (
                    <Folder size={16} />
                  ) : (
                    <FileText size={16} />
                  )}
                </span>
                <strong>{item.name}</strong>
              </div>
              <span className="ssh-file-size-cell">{item.size}</span>
              <span className="ssh-file-modified-cell">{item.modified}</span>
              <button
                className="ssh-row-action-button"
                type="button"
                aria-label={`${item.name} actions`}
                disabled={disabled}
              >
                <MoreHorizontal size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function SftpPanelActions({
  disabled,
  label,
}: {
  disabled: boolean;
  label: string;
}): JSX.Element {
  return (
    <span className="ssh-directory-actions" aria-label={`${label} actions`}>
      <SftpActionButton label={`${label} upload`} disabled={disabled}>
        <Upload size={15} />
      </SftpActionButton>
      <SftpActionButton label={`${label} download`} disabled={disabled}>
        <Download size={15} />
      </SftpActionButton>
      <SftpActionButton label={`${label} new folder`} disabled={disabled}>
        <FolderPlus size={15} />
      </SftpActionButton>
      <SftpActionButton label={`${label} refresh`} disabled={disabled}>
        <RefreshCw size={15} />
      </SftpActionButton>
      <SftpActionButton label={`${label} more options`} disabled={disabled}>
        <MoreHorizontal size={15} />
      </SftpActionButton>
    </span>
  );
}

function SftpActionButton({
  children,
  disabled,
  label,
}: {
  children: JSX.Element;
  disabled: boolean;
  label: string;
}): JSX.Element {
  return (
    <button
      className="ssh-directory-action-button"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
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

function buildSftpTreeRows(
  source: "local" | "remote",
  items: SftpItem[],
): SftpTreeRow[] {
  return source === "local"
    ? buildLocalTreeRows(items)
    : buildRemoteTreeRows(items);
}

function buildLocalTreeRows(items: SftpItem[]): SftpTreeRow[] {
  const src = findSftpItem(items, "src", INITIAL_LOCAL_ITEMS[0]);
  const env = findSftpItem(items, ".env.local", INITIAL_LOCAL_ITEMS[1]);
  const packageJson = findSftpItem(
    items,
    "package.json",
    INITIAL_LOCAL_ITEMS[2],
  );
  const knownNames = new Set(["src", ".env.local", "package.json"]);

  return [
    { ...src, depth: 0, expanded: true, hasChildren: true },
    ...LOCAL_TREE_CHILDREN.map((item) => ({ ...item, depth: 1 })),
    { ...env, depth: 0 },
    { ...packageJson, depth: 0 },
    ...items
      .filter((item) => !knownNames.has(item.name))
      .map((item) => ({ ...item, depth: 0 })),
  ];
}

function buildRemoteTreeRows(items: SftpItem[]): SftpTreeRow[] {
  const app = findSftpItem(items, "app", INITIAL_REMOTE_ITEMS[0]);
  const logs = findSftpItem(items, "logs", INITIAL_REMOTE_ITEMS[1]);
  const env = findSftpItem(items, ".env", INITIAL_REMOTE_ITEMS[2]);
  const readme = findSftpItem(items, "README.md", INITIAL_REMOTE_ITEMS[3]);
  const knownNames = new Set(["app", "logs", ".env", "README.md"]);

  return [
    { ...app, depth: 0, expanded: true, hasChildren: true },
    ...REMOTE_TREE_CHILDREN.map((item) => ({ ...item, depth: 1 })),
    { ...logs, depth: 0, expanded: false, hasChildren: true },
    { ...env, depth: 0 },
    { ...readme, depth: 0 },
    ...items
      .filter((item) => !knownNames.has(item.name))
      .map((item) => ({ ...item, depth: 0 })),
  ];
}

function findSftpItem(
  items: SftpItem[],
  name: string,
  fallback: SftpItem,
): SftpItem {
  return items.find((item) => item.name === name) ?? fallback;
}

function getDefaultDirectoryPath(source: "local" | "remote"): string {
  return source === "local" ? "D:/Projects/ivs-dashboard" : "/var/www/app";
}

function getParentDirectoryPath(
  path: string,
  source: "local" | "remote",
): string {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  if (!normalized) {
    return getDefaultDirectoryPath(source);
  }

  const separator = normalized.includes("/") ? "/" : "\\";
  const index = normalized.lastIndexOf(separator);
  if (index <= 0) {
    return normalized;
  }

  return normalized.slice(0, index);
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

function SshTerminalOutput({ lines }: { lines: string[] }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: lines.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => SSH_TERMINAL_ROW_HEIGHT,
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
