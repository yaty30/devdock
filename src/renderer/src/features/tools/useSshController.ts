import { useEffect, useMemo, useRef, useState } from "react";
import {
  getSshEndpoint,
  getSshHost,
  getSshUsername,
  hasValidSshCredential,
  isValidSshServerCredential,
  readStoredSelectedSshServerId,
  readStoredSshServers,
  storeSelectedSshServerId,
  storeSshServers,
  type SftpConnectionStatus,
  type SshActiveHostContext,
  type SshConnectionStatus,
  type SshServerConfig,
  type SshToolTab,
} from "./sshFeatureState";

type SshFeatureModule = typeof import("./SshTool");

export type SshController = {
  activeTab: SshToolTab;
  connectionStatus: SshConnectionStatus;
  featureModule: SshFeatureModule | null;
  hasValidCredential: boolean;
  reconnectAttempt: number;
  remoteCwd: string | null;
  selectedServer: SshServerConfig | null;
  selectedServerId: string;
  servers: SshServerConfig[];
  settingsOpen: boolean;
  settingsRequired: boolean;
  sftpConnectionError: string | null;
  sftpConnectionStatus: SftpConnectionStatus;
  terminalConnectionEnabled: boolean;
  terminalConnectionSignal: number;
  activeSessionId: string | null;
  closeSettings: () => void;
  handleCommandSubmit: (command: string) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    error?: string;
  }>;
  handleConnectionToggle: (server: SshServerConfig) => void;
  handleTerminalConnectionStatusChange: (status: SshConnectionStatus) => void;
  handleTerminalHostChange: (context: SshActiveHostContext) => void;
  openSettings: () => void;
  saveServers: (nextServers: SshServerConfig[]) => void;
  setActiveTab: (tab: SshToolTab) => void;
  setSelectedServerId: (serverId: string) => void;
};

export function useSshController({
  enabled,
  routeActive,
  onUnavailableRoute,
}: {
  enabled: boolean;
  routeActive: boolean;
  onUnavailableRoute: () => void;
}): SshController {
  const [featureModule, setFeatureModule] = useState<SshFeatureModule | null>(
    null,
  );
  const [servers, setServers] = useState<SshServerConfig[]>([]);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SshToolTab>("ssh");
  const [connectionStatus, setConnectionStatus] =
    useState<SshConnectionStatus>("idle");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [terminalConnectionEnabled, setTerminalConnectionEnabled] =
    useState(false);
  const [terminalConnectionSignal, setTerminalConnectionSignal] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [remoteCwd, setRemoteCwd] = useState<string | null>(null);
  const [sftpConnectionStatus, setSftpConnectionStatus] =
    useState<SftpConnectionStatus>("idle");
  const [sftpConnectionError, setSftpConnectionError] = useState<string | null>(
    null,
  );
  const reconnectTimerRef = useRef<number | null>(null);
  const manualDisconnectRef = useRef(false);
  const activeServerIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const autoLoginAttemptedRef = useRef<string | null>(null);
  const credentialPromptedRef = useRef(false);
  const directorySyncRequestRef = useRef(0);
  const terminalHostProfileMapRef = useRef<Map<string, string>>(new Map());

  const selectedServer = enabled
    ? (servers.find((server) => server.id === selectedServerId) ??
      servers[0] ??
      null)
    : null;
  const hasValidCredential = useMemo(
    () => enabled && hasValidSshCredential(servers),
    [enabled, servers],
  );
  const settingsRequired = enabled && routeActive && !hasValidCredential;

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let cancelled = false;
    void import("./SshTool")
      .then((module) => {
        if (cancelled) {
          return;
        }
        const storedServers = readStoredSshServers();
        setFeatureModule(module);
        setServers(storedServers);
        setSelectedServerId(readStoredSelectedSshServerId(storedServers));
      })
      .catch((error) => {
        console.error("[ssh:feature-load]", error);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !featureModule) {
      return;
    }
    storeSshServers(servers);
    setSelectedServerId((current) =>
      servers.some((server) => server.id === current)
        ? current
        : (servers[0]?.id ?? ""),
    );
  }, [enabled, featureModule, servers]);

  useEffect(() => {
    if (!enabled || !featureModule) {
      return;
    }
    if (selectedServerId) {
      storeSelectedSshServerId(selectedServerId);
    }
  }, [enabled, selectedServerId, featureModule]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (enabled || !routeActive) {
      return;
    }
    onUnavailableRoute();
  }, [enabled, routeActive, onUnavailableRoute]);

  useEffect(() => {
    if (!settingsRequired) {
      credentialPromptedRef.current = false;
      return;
    }

    if (credentialPromptedRef.current) {
      return;
    }

    credentialPromptedRef.current = true;
    setSettingsOpen(true);
  }, [settingsRequired]);

  // XtermTerminal now owns the visible SSH login flow. This effect only resets
  // the old guard when leaving the SSH tool so profile changes can start fresh.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (!routeActive) {
      autoLoginAttemptedRef.current = null;
    }
  }, [enabled, routeActive]);

  // Cancel pending SSH activity when selected server changes.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    if (
      activeServerIdRef.current !== null &&
      activeServerIdRef.current !== selectedServerId
    ) {
      clearReconnectTimer();
      setTerminalConnectionActive(false);
      void disconnectActiveSession();
      manualDisconnectRef.current = false;
      setConnectionStatus("idle");
      setReconnectAttempt(0);
      setRemoteCwd(null);
      setSftpConnectionStatus("idle");
      setSftpConnectionError(null);
    }
    activeServerIdRef.current = selectedServerId || null;
  }, [enabled, selectedServerId]);

  // Cleanup SSH timers on unmount.
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    return () => {
      clearReconnectTimer();
      void disconnectActiveSession();
    };
  }, [enabled]);

  function saveServers(nextServers: SshServerConfig[]): void {
    if (!enabled) {
      return;
    }
    setServers(nextServers);
    const selectedStillExists = nextServers.some(
      (server) => server.id === selectedServerId,
    );
    if (!selectedStillExists) {
      clearReconnectTimer();
      setTerminalConnectionActive(false);
      void disconnectActiveSession();
      manualDisconnectRef.current = false;
      setConnectionStatus("idle");
      setReconnectAttempt(0);
      setRemoteCwd(null);
      setSelectedServerId(nextServers[0]?.id ?? "");
    }
    setSettingsOpen(false);
  }

  function closeSettings(): void {
    setSettingsOpen(false);
  }

  function openSettings(): void {
    setSettingsOpen(true);
  }

  function clearReconnectTimer(): void {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function setTerminalConnectionActive(active: boolean): void {
    setTerminalConnectionEnabled(active);
    setTerminalConnectionSignal((current) => current + 1);
  }

  async function disconnectActiveSession(): Promise<void> {
    const sessionId = activeSessionIdRef.current;
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    setSftpConnectionStatus("idle");
    setSftpConnectionError(null);
    if (!enabled) {
      return;
    }
    if (!sessionId) {
      return;
    }

    await window.ivsDashboard.sshDisconnect(sessionId).catch((error) => {
      console.error("[ssh:disconnect]", error);
    });
  }

  async function connectServer(
    server: SshServerConfig,
    status: SshConnectionStatus,
    currentAttempt: number,
  ): Promise<void> {
    if (!enabled) {
      return;
    }
    if (!isValidSshServerCredential(server)) {
      return;
    }

    activeServerIdRef.current = server.id;
    clearReconnectTimer();
    await disconnectActiveSession();
    setConnectionStatus(status);
    setSftpConnectionStatus("connecting");
    setSftpConnectionError(null);

    const result = await window.ivsDashboard
      .sshConnect({
        serverId: server.id,
        name: server.name,
        address: getSshEndpoint(server),
        username: getSshUsername(server),
        password: server.password,
        macs: server.macs,
        ciphers: server.ciphers,
      })
      .catch((error) => ({
        ok: false,
        sessionId: null,
        error:
          error instanceof Error
            ? error.message
            : "SSH backend is not available.",
      }));

    if (activeServerIdRef.current !== server.id) {
      if (result.sessionId) {
        await window.ivsDashboard
          .sshDisconnect(result.sessionId)
          .catch((error) => {
            console.error("[ssh:disconnect-stale]", error);
          });
      }
      return;
    }

    if (result.ok && result.sessionId) {
      activeSessionIdRef.current = result.sessionId;
      setActiveSessionId(result.sessionId);
      setRemoteCwd(result.cwd ?? null);
      setSftpConnectionStatus("ready");
      setSftpConnectionError(null);
      setConnectionStatus("connected");
      setReconnectAttempt(0);
      return;
    }

    setActiveSessionId(null);
    setSftpConnectionStatus("failed");
    setSftpConnectionError(result.error ?? "Unable to start SFTP session.");
    if (shouldRetryConnection(server, currentAttempt)) {
      scheduleReconnect(server, currentAttempt + 1);
      return;
    }

    setConnectionStatus("failed");
  }

  async function syncDirectoryToTerminalHost(
    context: SshActiveHostContext,
  ): Promise<void> {
    if (!enabled) {
      return;
    }
    const hostProfileKey = getTerminalHostProfileKey(context);
    const mappedProfileId =
      terminalHostProfileMapRef.current.get(hostProfileKey);
    const mappedProfile = mappedProfileId
      ? (servers.find((server) => server.id === mappedProfileId) ?? null)
      : null;
    const profile =
      mappedProfile ??
      findSshProfileForTerminalHost(
        context,
        servers,
        selectedServer,
        activeSessionIdRef.current === null,
      );
    const jumpProfile =
      !profile &&
      selectedServer &&
      isValidSshServerCredential(selectedServer) &&
      !isSameTerminalHostAndProfile(context, selectedServer)
        ? selectedServer
        : null;
    if ((!profile || !isValidSshServerCredential(profile)) && !jumpProfile) {
      await disconnectActiveSession();
      setRemoteCwd(context.cwd ?? null);
      setSftpConnectionStatus("failed");
      setSftpConnectionError(
        "No saved SSH profile matches this terminal host.",
      );
      return;
    }
    const targetProfile = profile ?? jumpProfile;
    if (!targetProfile) {
      await disconnectActiveSession();
      setRemoteCwd(context.cwd ?? null);
      setSftpConnectionStatus("failed");
      setSftpConnectionError(
        "No SSH profile is available for this terminal host.",
      );
      return;
    }
    const directorySessionServerId = profile
      ? targetProfile.id
      : getTerminalHostDirectorySessionId(context, targetProfile);

    if (
      activeServerIdRef.current === directorySessionServerId &&
      activeSessionIdRef.current
    ) {
      if (profile) {
        terminalHostProfileMapRef.current.set(hostProfileKey, profile.id);
      }
      setRemoteCwd(resolveTerminalDirectoryCwd(context.cwd, remoteCwd));
      setSftpConnectionStatus("ready");
      setSftpConnectionError(null);
      setConnectionStatus("connected");
      return;
    }

    const requestId = directorySyncRequestRef.current + 1;
    directorySyncRequestRef.current = requestId;
    activeServerIdRef.current = directorySessionServerId;
    await disconnectActiveSession();
    setSftpConnectionStatus("connecting");
    setSftpConnectionError(null);

    const result = await window.ivsDashboard
      .sshConnect({
        serverId: directorySessionServerId,
        name: profile
          ? profile.name
          : `${targetProfile.name} -> ${context.host}`,
        address: profile
          ? getSshEndpoint(targetProfile)
          : `${context.host.trim()}:22`,
        username: profile
          ? getSshUsername(targetProfile)
          : context.username.trim() || getSshUsername(targetProfile),
        password: targetProfile.password,
        macs: targetProfile.macs,
        ciphers: targetProfile.ciphers,
        jump: profile
          ? undefined
          : {
              address: getSshEndpoint(targetProfile),
              username: getSshUsername(targetProfile),
              password: targetProfile.password,
              macs: targetProfile.macs,
              ciphers: targetProfile.ciphers,
            },
      })
      .catch((error) => ({
        ok: false,
        sessionId: null,
        error:
          error instanceof Error
            ? error.message
            : "SSH backend is not available.",
      }));

    if (directorySyncRequestRef.current !== requestId) {
      if (result.sessionId) {
        await window.ivsDashboard
          .sshDisconnect(result.sessionId)
          .catch((error) =>
            console.error("[ssh:disconnect-stale-directory]", error),
          );
      }
      return;
    }

    if (result.ok && result.sessionId) {
      if (profile) {
        terminalHostProfileMapRef.current.set(hostProfileKey, profile.id);
      }
      activeSessionIdRef.current = result.sessionId;
      setActiveSessionId(result.sessionId);
      setRemoteCwd(resolveTerminalDirectoryCwd(context.cwd, result.cwd));
      setSftpConnectionStatus("ready");
      setSftpConnectionError(null);
      setConnectionStatus("connected");
      setReconnectAttempt(0);
      return;
    }

    setActiveSessionId(null);
    setRemoteCwd(resolveTerminalDirectoryCwd(context.cwd, null));
    setSftpConnectionStatus("failed");
    setSftpConnectionError(result.error ?? "Unable to start SFTP session.");
  }

  function handleTerminalConnectionStatusChange(
    status: SshConnectionStatus,
  ): void {
    if (!enabled) {
      return;
    }
    clearReconnectTimer();
    if (status === "connecting") {
      manualDisconnectRef.current = false;
      setReconnectAttempt(0);
      setConnectionStatus("connecting");
      return;
    }
    if (status === "connected") {
      setConnectionStatus("connected");
      return;
    }
    if (status === "failed" || status === "disconnected") {
      setTerminalConnectionActive(false);
      void disconnectActiveSession();
      setReconnectAttempt(0);
      setRemoteCwd(null);
      setSftpConnectionStatus("idle");
      setSftpConnectionError(null);
      setConnectionStatus(status);
    }
  }

  function handleTerminalHostChange(context: SshActiveHostContext): void {
    if (!enabled) {
      return;
    }
    setConnectionStatus("connected");
    void syncDirectoryToTerminalHost(context);
  }

  function shouldRetryConnection(
    server: SshServerConfig,
    currentAttempt: number,
  ): boolean {
    return (
      enabled &&
      server.autoReconnect &&
      !manualDisconnectRef.current &&
      currentAttempt < server.maxReconnectAttempts &&
      isValidSshServerCredential(server) &&
      activeServerIdRef.current === server.id
    );
  }

  function scheduleReconnect(
    server: SshServerConfig,
    nextAttempt: number,
  ): void {
    if (!enabled) {
      return;
    }
    setReconnectAttempt(nextAttempt);
    setConnectionStatus("reconnecting");
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      if (
        manualDisconnectRef.current ||
        activeServerIdRef.current !== server.id
      ) {
        return;
      }
      void connectServer(server, "reconnecting", nextAttempt);
    }, server.reconnectDelayMs);
  }

  function handleConnect(server: SshServerConfig): void {
    if (!enabled) {
      return;
    }
    manualDisconnectRef.current = false;
    setTerminalConnectionActive(true);
    setReconnectAttempt(0);
    activeServerIdRef.current = server.id;
    void disconnectActiveSession();
    setRemoteCwd(null);
    setSftpConnectionStatus("idle");
    setSftpConnectionError(null);
    setConnectionStatus("connecting");
  }

  function handleDisconnect(): void {
    if (!enabled) {
      return;
    }
    manualDisconnectRef.current = true;
    clearReconnectTimer();
    setTerminalConnectionActive(false);
    void disconnectActiveSession();
    setReconnectAttempt(0);
    setRemoteCwd(null);
    setSftpConnectionStatus("idle");
    setSftpConnectionError(null);
    setConnectionStatus("disconnected");
  }

  function handleConnectionToggle(server: SshServerConfig): void {
    if (!enabled) {
      return;
    }
    if (
      connectionStatus === "connected" ||
      connectionStatus === "connecting" ||
      connectionStatus === "reconnecting"
    ) {
      handleDisconnect();
      return;
    }

    handleConnect(server);
  }

  async function handleCommandSubmit(command: string) {
    if (!enabled) {
      return {
        stdout: "",
        stderr: "",
        exitCode: null,
        error: "SSH is currently unavailable.",
      };
    }
    const sessionId = activeSessionIdRef.current;
    if (connectionStatus !== "connected" || !sessionId) {
      return {
        stdout: "",
        stderr: "",
        exitCode: null,
        error: "Not connected. Please connect to the SSH server first.",
      };
    }

    try {
      const result = await window.ivsDashboard.sshExec(sessionId, command);
      return result;
    } catch (error) {
      return {
        stdout: "",
        stderr: "",
        exitCode: null,
        error:
          error instanceof Error
            ? error.message
            : "SSH backend is not available.",
      };
    }
  }

  return {
    activeTab,
    connectionStatus,
    featureModule,
    hasValidCredential,
    reconnectAttempt,
    remoteCwd,
    selectedServer,
    selectedServerId,
    servers,
    settingsOpen,
    settingsRequired,
    sftpConnectionError,
    sftpConnectionStatus,
    terminalConnectionEnabled,
    terminalConnectionSignal,
    activeSessionId,
    closeSettings,
    handleCommandSubmit,
    handleConnectionToggle,
    handleTerminalConnectionStatusChange,
    handleTerminalHostChange,
    openSettings,
    saveServers,
    setActiveTab,
    setSelectedServerId,
  };
}

function findSshProfileForTerminalHost(
  context: SshActiveHostContext,
  servers: SshServerConfig[],
  selectedServer: SshServerConfig | null,
  allowSelectedFallback: boolean,
): SshServerConfig | null {
  const host = normalizeTerminalHost(context.host);
  const username = context.username.trim().toLowerCase();
  const exact = servers.find((server) => {
    const serverHost = normalizeTerminalHost(getSshHost(server));
    const serverUser = getSshUsername(server).toLowerCase();
    return serverHost === host && (!username || serverUser === username);
  });
  if (exact) {
    return exact;
  }
  if (allowSelectedFallback && selectedServer) {
    const selectedUser = getSshUsername(selectedServer).toLowerCase();
    if (!username || selectedUser === username) {
      return selectedServer;
    }
  }
  return null;
}

function normalizeTerminalHost(value: string): string {
  const trimmed = value
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  const colonIndex = trimmed.lastIndexOf(":");
  if (colonIndex > 0 && /^\d+$/.test(trimmed.slice(colonIndex + 1))) {
    return trimmed.slice(0, colonIndex);
  }
  return trimmed;
}

function getTerminalHostProfileKey(context: SshActiveHostContext): string {
  return `${context.username.trim().toLowerCase()}@${normalizeTerminalHost(
    context.host,
  )}`;
}

function getTerminalHostDirectorySessionId(
  context: SshActiveHostContext,
  jumpProfile: SshServerConfig,
): string {
  return `${jumpProfile.id}->${getTerminalHostProfileKey(context)}`;
}

function isSameTerminalHostAndProfile(
  context: SshActiveHostContext,
  profile: SshServerConfig,
): boolean {
  const contextHost = normalizeTerminalHost(context.host);
  const profileHost = normalizeTerminalHost(getSshHost(profile));
  const contextUser = context.username.trim().toLowerCase();
  const profileUser = getSshUsername(profile).toLowerCase();
  return (
    contextHost === profileHost && (!contextUser || contextUser === profileUser)
  );
}

function resolveTerminalDirectoryCwd(
  terminalCwd: string | undefined,
  backendCwd: string | null | undefined,
): string | null {
  const promptCwd = terminalCwd?.trim() ?? "";
  const resolvedBackendCwd = backendCwd?.trim() || null;
  if (!promptCwd || promptCwd === "~") {
    return resolvedBackendCwd;
  }
  if (promptCwd.startsWith("~/")) {
    return resolvedBackendCwd
      ? `${resolvedBackendCwd.replace(/\/+$/, "")}/${promptCwd.slice(2)}`
      : null;
  }
  if (promptCwd.startsWith("/")) {
    return promptCwd;
  }
  return resolvedBackendCwd ?? promptCwd;
}
