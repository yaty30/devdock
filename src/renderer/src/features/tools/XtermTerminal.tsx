import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { RefreshCw } from "lucide-react";
import { Panel } from "../../components/common/Panel";
import { normalizeSshHostInput } from "../../../../shared/sshHost";

type SessionStatus = "idle" | "starting" | "ready" | "exited" | "error";

type XtermTerminalProps = {
  title?: string;
  className?: string;
  disabled?: boolean;
  connectEnabled?: boolean;
  lifecycleSignal?: number;
  autoSsh?: XtermAutoSshConfig | null;
  extraActions?: JSX.Element;
  refitSignal?: unknown;
  resizeSuspended?: boolean;
  onConnectionStatusChange?: (status: XtermConnectionStatus) => void;
  onActiveHostChange?: (host: XtermActiveHost) => void;
};

export type XtermConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "failed"
  | "disconnected";

export type XtermActiveHost = {
  username: string;
  host: string;
  cwd?: string;
};

export type XtermAutoSshConfig = {
  key: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  autoLogin: boolean;
  macs?: string;
  ciphers?: string;
};

const TERMINAL_THEME = {
  background: "#0b1220",
  foreground: "#e5e9f0",
  cursor: "#7dd3fc",
  cursorAccent: "#0b1220",
  selectionBackground: "rgba(125, 211, 252, 0.35)",
  black: "#1f2937",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e5e9f0",
  brightBlack: "#475569",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#f8fafc",
};
const MAC_FAILURE_HINT =
  "\r\n\u001b[33m[hint] Corrupted MAC usually needs SSH algorithm tuning. " +
  "Try SSH settings: MACs=hmac-sha2-256,hmac-sha2-512,hmac-sha1 " +
  "and Ciphers=aes128-ctr,aes192-ctr,aes256-ctr.\u001b[0m";

export function XtermTerminal({
  title = "Xterm",
  className,
  disabled = false,
  connectEnabled = true,
  lifecycleSignal = 0,
  autoSsh = null,
  extraActions,
  refitSignal,
  resizeSuspended = false,
  onConnectionStatusChange,
  onActiveHostChange,
}: XtermTerminalProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const resizeSuspendedRef = useRef(resizeSuspended);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [shellLabel, setShellLabel] = useState<string>("Local Shell");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [terminalInputDisabled, setTerminalInputDisabled] = useState(
    disabled || !connectEnabled || !autoSsh,
  );
  const [restartTick, setRestartTick] = useState(0);

  const autoSshKey = autoSsh?.key ?? "local";

  useEffect(() => {
    resizeSuspendedRef.current = resizeSuspended;
  }, [resizeSuspended]);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) {
      return;
    }
    if (disabled || !connectEnabled) {
      setStatus("idle");
      setShellLabel("Local Shell");
      setErrorMessage(null);
      setTerminalInputDisabled(true);
      return;
    }
    const hostElement = host;

    let disposed = false;
    const api = window.ivsDashboard;
    const offDataListeners: Array<() => void> = [];
    let inputDisposer: { dispose: () => void } | null = null;
    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame: number | null = null;
    let promptBuffer = "";
    let hostKeyAccepted = false;
    let passwordSent = false;
    let lastActiveHostKey = "";
    let hasRemotePrompt = false;
    let remoteConnectionClosed = false;
    let macFailureHintShown = false;
    let inputGate: "locked" | "connecting" | "connected" = autoSsh
      ? "connecting"
      : "locked";

    function setInputGate(
      nextInputGate: "locked" | "connecting" | "connected",
    ): void {
      inputGate = nextInputGate;
      const nextInputDisabled = nextInputGate === "locked";
      if (term) {
        term.options.disableStdin = nextInputDisabled;
      }
      setTerminalInputDisabled(nextInputDisabled);
    }

    function scheduleFitAndResize(): void {
      if (disposed || resizeSuspendedRef.current || !term || !fitAddon) {
        return;
      }
      if (resizeFrame !== null) {
        return;
      }
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        if (
          disposed ||
          resizeSuspendedRef.current ||
          !term ||
          !fitAddon ||
          !isElementReadyForFit(hostElement)
        ) {
          return;
        }
        try {
          fitAddon.fit();
        } catch {
          return;
        }
        const sessionId = sessionIdRef.current;
        if (sessionId) {
          void api.xtermResize(sessionId, term.cols, term.rows);
        }
      });
    }

    function startTerminal(): void {
      if (disposed || !hostElement.isConnected) {
        return;
      }

      setStatus("starting");
      setErrorMessage(null);

      term = new Terminal({
        cursorBlink: true,
        fontFamily:
          '"JetBrains Mono", "Cascadia Code", "Fira Code", "Consolas", monospace',
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 5000,
        theme: TERMINAL_THEME,
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(hostElement);
      term.options.disableStdin = inputGate === "locked";
      setTerminalInputDisabled(inputGate === "locked");
      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
      scheduleFitAndResize();

      const initialCols = term.cols;
      const initialRows = term.rows;

      void api
        .xtermCreateSession({ cols: initialCols, rows: initialRows })
        .then((result) => {
          if (disposed) {
            if (result.ok && result.sessionId) {
              void api.xtermKillSession(result.sessionId);
            }
            return;
          }
          if (!term || !result.ok || !result.sessionId) {
            setStatus("error");
            setInputGate("locked");
            setErrorMessage(
              result.error ?? "Failed to start terminal session.",
            );
            term?.writeln(
              `\u001b[31mTerminal session error: ${
                result.error ?? "Unable to start PTY."
              }\u001b[0m`,
            );
            return;
          }
          const activeSessionId = result.sessionId;
          sessionIdRef.current = activeSessionId;
          if (result.shell) {
            setShellLabel(formatShellLabel(result.shell));
          }
          setStatus("ready");
          scheduleFitAndResize();

          const offData = api.onXtermData((event) => {
            if (!disposed && event.sessionId === sessionIdRef.current) {
              const data = event.data;
              term?.write(data);
              if (autoSsh) {
                promptBuffer = trimPromptBuffer(promptBuffer + data);
                if (!hasRemotePrompt && isSshFailure(promptBuffer)) {
                  const macIntegrityFailure =
                    isMacIntegrityFailure(promptBuffer);
                  onConnectionStatusChange?.("failed");
                  setInputGate("locked");
                  if (macIntegrityFailure && !macFailureHintShown) {
                    macFailureHintShown = true;
                    term?.writeln(MAC_FAILURE_HINT);
                  }
                  promptBuffer = "";
                  return;
                }
                const activeHost = parseActiveHost(promptBuffer);
                if (activeHost) {
                  hasRemotePrompt = true;
                  remoteConnectionClosed = false;
                  const activeHostKey = `${activeHost.username}@${activeHost.host}`;
                  if (activeHostKey !== lastActiveHostKey) {
                    lastActiveHostKey = activeHostKey;
                    setInputGate("connected");
                    onConnectionStatusChange?.("connected");
                    onActiveHostChange?.(activeHost);
                  }
                } else if (hasRemotePrompt && isSshClosed(promptBuffer)) {
                  remoteConnectionClosed = true;
                } else if (
                  hasRemotePrompt &&
                  remoteConnectionClosed &&
                  isLocalPrompt(promptBuffer)
                ) {
                  onConnectionStatusChange?.("disconnected");
                  setInputGate("connected");
                  hasRemotePrompt = false;
                  remoteConnectionClosed = false;
                  promptBuffer = "";
                  return;
                }
                if (
                  autoSsh.autoLogin &&
                  !hostKeyAccepted &&
                  isHostKeyPrompt(promptBuffer)
                ) {
                  hostKeyAccepted = true;
                  promptBuffer = "";
                  void api.xtermInput(activeSessionId, "yes\r");
                } else if (
                  autoSsh.autoLogin &&
                  !passwordSent &&
                  isPasswordPrompt(promptBuffer)
                ) {
                  passwordSent = true;
                  promptBuffer = "";
                  void api.xtermInput(activeSessionId, `${autoSsh.password}\r`);
                }
              }
            }
          });
          offDataListeners.push(offData);

          const offExit = api.onXtermExit((event) => {
            if (disposed || event.sessionId !== sessionIdRef.current) {
              return;
            }
            setStatus("exited");
            if (autoSsh) {
              setInputGate("locked");
              onConnectionStatusChange?.("disconnected");
            }
            term?.writeln(
              `\r\n\u001b[33m[process exited with code ${event.exitCode}]\u001b[0m`,
            );
          });
          offDataListeners.push(offExit);

          inputDisposer = term.onData((data) => {
            const sessionId = sessionIdRef.current;
            if (!sessionId) {
              return;
            }
            if (inputGate !== "locked") {
              void api.xtermInput(sessionId, data);
              return;
            }
          });

          if (autoSsh) {
            const sshCommand = buildSshCommand(autoSsh);
            if (!sshCommand.ok) {
              onConnectionStatusChange?.("failed");
              setInputGate("locked");
              term.writeln(
                `\r\n\u001b[31mSSH connection error: ${sshCommand.error}\u001b[0m`,
              );
              return;
            }
            setInputGate("connecting");
            setShellLabel(`SSH: ${formatAutoSshTarget(autoSsh)}`);
            onConnectionStatusChange?.("connecting");
            term.writeln(
              `\r\n\u001b[36mConnecting to ${formatAutoSshTarget(autoSsh)}...\u001b[0m`,
            );
            window.setTimeout(() => {
              if (!disposed && sessionIdRef.current === activeSessionId) {
                void api.xtermInput(activeSessionId, `${sshCommand.command}\r`);
              }
            }, 250);
          }
        })
        .catch((error: unknown) => {
          if (disposed) {
            return;
          }
          const message =
            error instanceof Error
              ? error.message
              : "Failed to start terminal session.";
          setStatus("error");
          onConnectionStatusChange?.("failed");
          setInputGate("locked");
          setErrorMessage(message);
          term?.writeln(
            `\u001b[31mTerminal session error: ${message}\u001b[0m`,
          );
        });

      resizeObserver =
        typeof ResizeObserver !== "undefined"
          ? new ResizeObserver(() => scheduleFitAndResize())
          : null;
      if (resizeObserver) {
        resizeObserver.observe(hostElement);
      }
      window.addEventListener("resize", scheduleFitAndResize);
    }

    const setupTimer = window.setTimeout(startTerminal, 0);

    return () => {
      disposed = true;
      window.clearTimeout(setupTimer);
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
      }
      window.removeEventListener("resize", scheduleFitAndResize);
      resizeObserver?.disconnect();
      for (const off of offDataListeners) {
        try {
          off();
        } catch {
          // ignore listener teardown errors
        }
      }
      inputDisposer?.dispose();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) {
        void api.xtermKillSession(sessionId);
      }
      const terminalToDispose = term;
      if (terminalToDispose) {
        window.setTimeout(() => {
          try {
            terminalToDispose.dispose();
          } catch {
            // ignore
          }
        }, 0);
      }
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [autoSshKey, connectEnabled, disabled, lifecycleSignal, restartTick]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const term = terminalRef.current;
      if (
        resizeSuspendedRef.current ||
        !isElementReadyForFit(containerRef.current)
      ) {
        return;
      }
      if (
        refitTerminal(term, fitAddonRef.current) &&
        sessionIdRef.current &&
        term
      ) {
        void window.ivsDashboard.xtermResize(
          sessionIdRef.current,
          term.cols,
          term.rows,
        );
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [refitSignal]);

  function handleClickTerminal(): void {
    if (terminalInputDisabled) {
      terminalRef.current?.blur();
      return;
    }
    terminalRef.current?.focus();
  }

  function handleRestart(): void {
    setRestartTick((tick) => tick + 1);
  }

  const statusLabel = formatStatusLabel(status, shellLabel, errorMessage);

  return (
    <Panel
      title={title}
      className={`xterm-tool-panel${className ? ` ${className}` : ""}`}
      action={
        <span className="xterm-panel-actions">
          <span
            className={`xterm-status xterm-status-${status}`}
            data-status={status}
          >
            <span className="xterm-status-dot" aria-hidden="true" />
            {statusLabel}
          </span>
          <button
            type="button"
            className="xterm-action-button"
            onClick={handleRestart}
            aria-label="Restart terminal"
            title="Restart terminal"
            disabled={disabled || !connectEnabled}
          >
            <RefreshCw size={15} />
          </button>
          {extraActions}
        </span>
      }
    >
      <div
        className={`xterm-tool-host${terminalInputDisabled ? " xterm-tool-host-disabled" : ""}`}
        data-testid="xterm-terminal-host"
        aria-disabled={terminalInputDisabled}
        ref={containerRef}
        onClick={handleClickTerminal}
      />
    </Panel>
  );
}

function formatStatusLabel(
  status: SessionStatus,
  shellLabel: string,
  errorMessage: string | null,
): string {
  switch (status) {
    case "starting":
      return "Starting...";
    case "ready":
      return shellLabel || "Connected";
    case "exited":
      return "Exited";
    case "error":
      return errorMessage ? `Error: ${errorMessage}` : "Error";
    default:
      return "Idle";
  }
}

function formatShellLabel(shell: string): string {
  const trimmed = shell.trim();
  if (!trimmed) {
    return "Local Shell";
  }
  const parts = trimmed.split(/[\\/]/);
  const name = parts[parts.length - 1] || trimmed;
  return `Local: ${name}`;
}

function refitTerminal(
  term: Terminal | null,
  fitAddon: FitAddon | null,
): boolean {
  if (!term || !fitAddon) {
    return false;
  }
  try {
    fitAddon.fit();
  } catch {
    return false;
  }
  return true;
}

function isElementReadyForFit(element: HTMLElement | null): boolean {
  if (!element || !element.isConnected) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width >= 40 && rect.height >= 40;
}

function buildSshCommand(
  config: XtermAutoSshConfig,
): { ok: true; command: string } | { ok: false; error: string } {
  const host = normalizeSshHostInput(config.host);
  if (!host.ok) {
    return { ok: false, error: host.error };
  }
  const username = config.username.trim();
  if (!username) {
    return { ok: false, error: "SSH username is required." };
  }

  const args = ["ssh"];
  if (config.port > 0 && config.port !== 22) {
    args.push("-p", String(config.port));
  }
  if (config.macs?.trim()) {
    args.push("-o", `MACs=${config.macs.trim()}`);
  }
  if (config.ciphers?.trim()) {
    args.push("-o", `Ciphers=${config.ciphers.trim()}`);
  }
  args.push("-l", username, host.host);
  return { ok: true, command: args.map(quoteShellArg).join(" ") };
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function formatAutoSshTarget(config: XtermAutoSshConfig): string {
  const host = config.host.trim();
  const username = config.username.trim();
  const target = username ? `${username}@${host}` : host;
  return config.port > 0 && config.port !== 22
    ? `${target}:${config.port}`
    : target;
}

function trimPromptBuffer(value: string): string {
  return stripAnsiControlSequences(value).slice(-3000);
}

function isHostKeyPrompt(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("are you sure you want to continue connecting") &&
    /\(yes\/no(?:\/\[fingerprint\])?\)\??\s*$/.test(normalized)
  );
}

function isPasswordPrompt(value: string): boolean {
  const normalized = value.toLowerCase();
  return /(?:^|[\r\n\s'"])password\s*:\s*$/.test(normalized);
}

function isSshFailure(value: string): boolean {
  const normalized = value.toLowerCase();
  return /permission denied|connection refused|could not resolve hostname|no route to host|operation timed out|connection timed out|connection closed by|connection reset by|corrupted mac|message authentication code incorrect/.test(
    normalized,
  );
}

function isMacIntegrityFailure(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("corrupted mac") ||
    normalized.includes("message authentication code incorrect")
  );
}

function isSshClosed(value: string): boolean {
  return /(?:^|\n)connection to .* closed\.?\s*(?:\n|$)/i.test(value);
}

function isLocalPrompt(value: string): boolean {
  const lines = value.split(/\r?\n/);
  const line = lines[lines.length - 1]?.trimEnd() ?? "";
  return (
    /^PS\s+[A-Za-z]:[\\/][^\r\n>]*>\s*$/.test(line) ||
    /^[A-Za-z]:[\\/][^\r\n>]*>\s*$/.test(line) ||
    /^[^@\s]+@[A-Za-z0-9._-]+\s+[A-Za-z]:[\\/][^\r\n$#>]*[>$#]\s*$/.test(
      line,
    )
  );
}

function parseActiveHost(value: string): XtermActiveHost | null {
  const lines = value.split(/\r?\n/);
  const line = lines[lines.length - 1]?.trimEnd() ?? "";
  const promptMatch =
    /(?:^|[\s([])([A-Za-z0-9._-]+)@([A-Za-z0-9._-]+)(?:(?::|\s+)([^\]$#%>\r\n]*))?\]?[#$%>]\s*$/.exec(
      line,
    );
  if (!promptMatch) {
    return null;
  }
  const username = promptMatch[1]?.trim() ?? "";
  const host = promptMatch[2]?.trim() ?? "";
  if (!username || !host) {
    return null;
  }
  const cwd = promptMatch[3]?.trim();
  return { username, host, cwd: cwd || undefined };
}

function stripAnsiControlSequences(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()][A-Za-z0-9]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}
