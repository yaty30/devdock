import {
  formatSshEndpoint,
  parseSshEndpointInput,
} from "../../../../shared/sshHost";

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
export type SftpConnectionStatus = "idle" | "connecting" | "ready" | "failed";
export type SshToolTab = "ssh" | "monitor";
export type SshActiveHostContext = {
  username: string;
  host: string;
  cwd?: string;
};

const SSH_PORT_DEFAULT = 22;
const SSH_RECONNECT_ATTEMPTS_DEFAULT = 3;
const SSH_RECONNECT_DELAY_DEFAULT_MS = 3000;
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
    ? (stored ?? "")
    : (servers[0]?.id ?? "");
}

export function storeSelectedSshServerId(serverId: string): void {
  window.localStorage.setItem(SSH_SELECTED_SERVER_STORAGE_KEY, serverId);
}

export function isValidSshServerCredential(server: SshServerConfig): boolean {
  const parsedAddress = parseSshEndpointInput(server.address);
  const parsedPort =
    Number.isInteger(server.port) &&
    server.port >= 1 &&
    server.port <= 65535;
  return parsedAddress.ok && parsedPort && server.username.trim().length > 0;
}

export function getSshEndpoint(server: SshServerConfig): string {
  const parsed = parseSshEndpointInput(server.address);
  if (parsed.ok) {
    return formatSshEndpoint(parsed.host, parsed.port ?? server.port);
  }
  return formatSshEndpoint(server.address.trim(), server.port);
}

export function getSshHost(server: SshServerConfig): string {
  const parsed = parseSshEndpointInput(server.address);
  return parsed.ok ? parsed.host : server.address.trim();
}

export function getSshUsername(server: SshServerConfig): string {
  return server.username.trim();
}

export function hasValidSshCredential(servers: SshServerConfig[]): boolean {
  return servers.some(isValidSshServerCredential);
}

function normalizeStoredServer(value: unknown): SshServerConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<Record<keyof SshServerConfig, unknown>>;
  const id = normalizeText(record.id);
  const name = normalizeText(record.name);
  const address = normalizeText(record.address);
  const username = normalizeText(record.username);
  const password = normalizeText(record.password);
  if (!id || !name || !address) {
    return null;
  }

  const port = normalizePort(record.port);
  const maxReconnectAttempts = normalizeInteger(
    record.maxReconnectAttempts,
    SSH_RECONNECT_ATTEMPTS_DEFAULT,
  );
  const reconnectDelayMs = normalizeInteger(
    record.reconnectDelayMs,
    SSH_RECONNECT_DELAY_DEFAULT_MS,
  );
  return {
    id,
    name,
    address,
    port,
    username,
    password,
    macs: normalizeText(record.macs),
    ciphers: normalizeText(record.ciphers),
    autoLogin: record.autoLogin === true,
    autoReconnect: record.autoReconnect === true,
    maxReconnectAttempts,
    reconnectDelayMs,
  };
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePort(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return Math.min(Math.max(value, 1), 65535);
  }
  return SSH_PORT_DEFAULT;
}

function normalizeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : fallback;
}
