import { randomUUID } from "node:crypto";
import { Client } from "ssh2";
import type { ClientChannel, ConnectConfig } from "ssh2";
import type {
  SshConnectRequest,
  SshConnectResult,
  SshDisconnectResult,
  SshExecResult,
} from "../shared/dashboardTypes";

type SshSession = {
  id: string;
  serverId: string;
  client: Client;
  shell?: ClientChannel;
  shellReady?: Promise<string>;
  pending?: boolean;
  shellPending?: PendingShellCommand;
  cwd?: string;
};

type PendingShellCommand = {
  command: string;
  output: string;
  timer: NodeJS.Timeout;
  idleTimer?: NodeJS.Timeout;
  resolve: (result: SshExecResult) => void;
};

export class SshService {
  private readonly sessions = new Map<string, SshSession>();

  connect(request: SshConnectRequest): Promise<SshConnectResult> {
    const endpoint = parseSshAddress(request.address);
    if (!endpoint) {
      return Promise.resolve({
        ok: false,
        sessionId: null,
        error: "SSH address must use host:port format.",
      });
    }

    const client = new Client();
    const config: ConnectConfig = {
      host: endpoint.host,
      port: endpoint.port,
      username: request.username,
      password: request.password,
      readyTimeout: 15000,
      keepaliveInterval: 15000,
    };

    return new Promise((resolve) => {
      let settled = false;

      const finish = (result: SshConnectResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      client.once("ready", () => {
        const sessionId = randomUUID();
        const session: SshSession = {
          id: sessionId,
          serverId: request.serverId,
          client,
        };
        this.sessions.set(sessionId, session);
        client.once("close", () => {
          this.sessions.delete(sessionId);
        });
        finish({ ok: true, sessionId });
      });

      client.on("error", (error) => {
        if (!settled) {
          finish({
            ok: false,
            sessionId: null,
            error: formatError(error),
          });
        }
      });

      try {
        client.connect(config);
      } catch (error) {
        finish({
          ok: false,
          sessionId: null,
          error: formatError(error),
        });
      }
    });
  }

  disconnect(sessionId: string): SshDisconnectResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: "SSH session is not active." };
    }

    this.sessions.delete(sessionId);
    session.shell?.end();
    session.client.end();
    return { ok: true };
  }

  exec(sessionId: string, command: string): Promise<SshExecResult> {
    const session = this.sessions.get(sessionId);
    const trimmed = command.trim();
    if (!session) {
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: null,
        error: "SSH session is not active.",
      });
    }
    if (!trimmed) {
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: null,
        cwd: session.cwd,
        error: "Command is empty.",
      });
    }
    if (session.pending) {
      return Promise.resolve({
        stdout: "",
        stderr: "",
        exitCode: null,
        cwd: session.cwd,
        error: "Another SSH command is already running.",
      });
    }

    return this.execInShell(session, trimmed);
  }

  disconnectAll(): void {
    for (const session of this.sessions.values()) {
      session.shell?.end();
      session.client.end();
    }
    this.sessions.clear();
  }

  private execInShell(
    session: SshSession,
    command: string,
  ): Promise<SshExecResult> {
    return this.ensureShell(session)
      .then(
        () =>
          new Promise<SshExecResult>((resolve) => {
            const pending: PendingShellCommand = {
              command,
              output: "",
              timer: setTimeout(() => {
                if (session.shellPending !== pending) {
                  return;
                }
                if (pending.idleTimer) {
                  clearTimeout(pending.idleTimer);
                }
                session.pending = false;
                session.shellPending = undefined;
                resolve({
                  stdout: cleanShellOutput(pending.output),
                  stderr: "",
                  exitCode: null,
                  cwd: session.cwd,
                  error: "SSH command timed out.",
                });
              }, 60000),
              resolve,
            };

            session.pending = true;
            session.shellPending = pending;
            session.shell?.write(`${command}\n`);
          }),
      )
      .catch((error) => ({
        stdout: "",
        stderr: "",
        exitCode: null,
        cwd: session.cwd,
        error: formatError(error),
      }));
  }

  private ensureShell(session: SshSession): Promise<string> {
    if (session.shell) {
      return Promise.resolve(session.cwd ?? "");
    }
    if (session.shellReady) {
      return session.shellReady;
    }

    session.shellReady = new Promise<string>((resolve, reject) => {
      session.client.shell(
        { term: "xterm-256color", rows: 30, cols: 120 },
        (error, stream) => {
          if (error) {
            reject(error);
            return;
          }

          session.shell = stream;
          stream.on("data", (chunk: Buffer | string) => {
            this.handleShellData(session, toText(chunk));
          });
          stream.stderr.on("data", (chunk: Buffer | string) => {
            this.handleShellData(session, toText(chunk));
          });
          stream.once("error", (streamError: Error) => {
            this.failShell(session, streamError);
          });
          stream.once("close", () => {
            this.failShell(session, new Error("SSH shell channel closed."));
          });

          setTimeout(() => resolve(session.cwd ?? ""), 250);
        },
      );
    }).catch((error) => {
      session.shellReady = undefined;
      throw error;
    });

    return session.shellReady;
  }

  private handleShellData(session: SshSession, text: string): void {
    if (session.shellPending) {
      this.handleCommandData(session, text);
    }
  }

  private handleCommandData(session: SshSession, text: string): void {
    const pending = session.shellPending;
    if (!pending) {
      return;
    }

    pending.output += normalizeLineEndings(text);
    if (looksLikePrompt(pending.output)) {
      this.finishShellCommand(session);
      return;
    }

    if (pending.idleTimer) {
      clearTimeout(pending.idleTimer);
    }
    pending.idleTimer = setTimeout(() => {
      if (session.shellPending === pending) {
        this.finishShellCommand(session);
      }
    }, 800);
  }

  private finishShellCommand(session: SshSession): void {
    const pending = session.shellPending;
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    if (pending.idleTimer) {
      clearTimeout(pending.idleTimer);
    }
    session.pending = false;
    session.shellPending = undefined;
    pending.resolve({
      stdout: cleanInteractiveShellOutput(pending.output, pending.command),
      stderr: "",
      exitCode: null,
      cwd: session.cwd,
    });
  }

  private failShell(session: SshSession, error: Error): void {
    if (session.shellPending) {
      clearTimeout(session.shellPending.timer);
      if (session.shellPending.idleTimer) {
        clearTimeout(session.shellPending.idleTimer);
      }
      session.shellPending.resolve({
        stdout: cleanInteractiveShellOutput(
          session.shellPending.output,
          session.shellPending.command,
        ),
        stderr: "",
        exitCode: null,
        cwd: session.cwd,
        error: formatError(error),
      });
      session.shellPending = undefined;
    }
    session.pending = false;
    session.shell = undefined;
    session.shellReady = undefined;
    this.sessions.delete(session.id);
  }
}

function parseSshAddress(address: string): { host: string; port: number } | null {
  const trimmed = address.trim();
  if (!trimmed) {
    return null;
  }

  const lastColonIndex = trimmed.lastIndexOf(":");
  if (lastColonIndex === -1) {
    return { host: trimmed, port: 22 };
  }

  const host = trimmed.slice(0, lastColonIndex).trim();
  const portText = trimmed.slice(lastColonIndex + 1).trim();
  const port = Number.parseInt(portText, 10);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
    return null;
  }

  return { host, port };
}

function cleanShellOutput(output: string): string {
  return output.replace(/^\n+/, "").replace(/\n+$/, "");
}

function cleanInteractiveShellOutput(output: string, command: string): string {
  const commandPattern = escapeRegExp(command.trim());
  const lines = normalizeLineEndings(output)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return false;
      }
      if (trimmed === command.trim()) {
        return false;
      }
      if (new RegExp(`[#$%>]\\s*${commandPattern}$`).test(trimmed)) {
        return false;
      }
      return !/[#$%>]\s*$/.test(trimmed);
    });

  return cleanShellOutput(lines.join("\n"));
}

function looksLikePrompt(output: string): boolean {
  return /(?:^|\n)[^\n]{1,160}[#$%>]\s*$/.test(output);
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function toText(chunk: Buffer | string): string {
  return Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
