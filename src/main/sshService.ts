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
  setup?: ShellSetup;
  pending?: PendingShellCommand;
  cwd?: string;
};

type ShellSetup = {
  readyMarker: string;
  buffer: string;
  resolve: (cwd: string) => void;
  reject: (error: Error) => void;
};

type PendingShellCommand = {
  startMarker: string;
  endMarker: string;
  output: string;
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
        void this.ensureShell(session)
          .then((cwd) => finish({ ok: true, sessionId, cwd }))
          .catch((error) => {
            this.sessions.delete(sessionId);
            client.end();
            finish({
              ok: false,
              sessionId: null,
              error: formatError(error),
            });
          });
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

    return this.ensureShell(session)
      .then(
        () =>
          new Promise<SshExecResult>((resolve) => {
            const id = randomUUID().replace(/-/g, "");
            const pending: PendingShellCommand = {
              startMarker: `__IVS_START_${id}__`,
              endMarker: `__IVS_END_${id}__`,
              output: "",
              resolve,
            };
            session.pending = pending;
            session.shell?.write(
              `printf '\n${pending.startMarker}\n'\n${trimmed}\n__ivs_status=$?\nprintf '\n${pending.endMarker}:%s:%s\n' "$__ivs_status" "$PWD"\n`,
            );
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

  disconnectAll(): void {
    for (const session of this.sessions.values()) {
      session.shell?.end();
      session.client.end();
    }
    this.sessions.clear();
  }

  private ensureShell(session: SshSession): Promise<string> {
    if (session.shell) {
      return Promise.resolve(session.cwd ?? "");
    }
    if (session.shellReady) {
      return session.shellReady;
    }

    const readyMarker = `__IVS_READY_${randomUUID().replace(/-/g, "")}__`;
    const readyPromise = new Promise<string>((resolve, reject) => {
      session.client.shell(
        { term: "xterm-256color", rows: 30, cols: 120 },
        (error, stream) => {
          if (error) {
            reject(error);
            return;
          }

          session.shell = stream;
          session.setup = {
            readyMarker,
            buffer: "",
            resolve: (cwd) => {
              session.cwd = cwd;
              resolve(cwd);
            },
            reject,
          };

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
            this.failShell(
              session,
              new Error("SSH shell channel closed."),
              false,
            );
          });

          stream.write(
            `export PS1=''\nexport PROMPT_COMMAND=''\nstty -echo 2>/dev/null\nprintf '${readyMarker}:%s\n' "$PWD"\n`,
          );
        },
      );
    });

    session.shellReady = readyPromise.catch((error) => {
      session.shellReady = undefined;
      throw error;
    });
    return session.shellReady;
  }

  private handleShellData(session: SshSession, text: string): void {
    if (session.setup) {
      this.handleSetupData(session, text);
      return;
    }

    if (session.pending) {
      this.handleCommandData(session, text);
    }
  }

  private handleSetupData(session: SshSession, text: string): void {
    const setup = session.setup;
    if (!setup) {
      return;
    }

    setup.buffer += normalizeLineEndings(text);
    const markerIndex = setup.buffer.indexOf(`${setup.readyMarker}:`);
    if (markerIndex === -1) {
      return;
    }

    const lineEndIndex = setup.buffer.indexOf("\n", markerIndex);
    if (lineEndIndex === -1) {
      return;
    }

    const readyLine = setup.buffer.slice(markerIndex, lineEndIndex).trim();
    const cwd = readyLine.slice(setup.readyMarker.length + 1);
    session.setup = undefined;
    setup.resolve(cwd);
  }

  private handleCommandData(session: SshSession, text: string): void {
    const pending = session.pending;
    if (!pending) {
      return;
    }

    pending.output += normalizeLineEndings(text);
    const endIndex = pending.output.indexOf(`${pending.endMarker}:`);
    if (endIndex === -1) {
      return;
    }

    const lineEndIndex = pending.output.indexOf("\n", endIndex);
    if (lineEndIndex === -1) {
      return;
    }

    const endLine = pending.output.slice(endIndex, lineEndIndex).trim();
    const statusMatch = new RegExp(
      `^${escapeRegExp(pending.endMarker)}:(-?\\d+):(.*)$`,
    ).exec(endLine);
    const parsedExitCode = statusMatch
      ? Number.parseInt(statusMatch[1], 10)
      : Number.NaN;
    const cwd = statusMatch?.[2] ?? session.cwd;
    const rawOutput = pending.output.slice(0, endIndex);
    const startIndex = rawOutput.indexOf(pending.startMarker);
    const stdout = cleanShellOutput(
      startIndex === -1
        ? rawOutput
        : rawOutput.slice(startIndex + pending.startMarker.length),
    );

    session.pending = undefined;
    session.cwd = cwd;
    pending.resolve({
      stdout,
      stderr: "",
      exitCode: Number.isFinite(parsedExitCode) ? parsedExitCode : null,
      cwd,
    });
  }

  private failShell(
    session: SshSession,
    error: Error,
    clearSession = true,
  ): void {
    session.setup?.reject(error);
    session.setup = undefined;
    session.pending?.resolve({
      stdout: "",
      stderr: "",
      exitCode: null,
      cwd: session.cwd,
      error: formatError(error),
    });
    session.pending = undefined;
    session.shell = undefined;
    session.shellReady = undefined;
    if (clearSession) {
      this.sessions.delete(session.id);
    }
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
