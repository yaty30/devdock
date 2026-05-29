import { randomUUID } from "node:crypto";
import os from "node:os";
import { spawn, type IPty } from "node-pty";

export type XtermDataSink = (sessionId: string, data: string) => void;
export type XtermExitSink = (
  sessionId: string,
  exit: { exitCode: number; signal?: number },
) => void;

export type XtermCreateRequest = {
  shell?: string | null;
  args?: string[] | null;
  cwd?: string | null;
  cols?: number | null;
  rows?: number | null;
  env?: Record<string, string> | null;
};

export type XtermCreateResult = {
  ok: boolean;
  sessionId: string | null;
  shell: string | null;
  error?: string;
};

export type XtermSimpleResult = {
  ok: boolean;
  error?: string;
};

type XtermSession = {
  id: string;
  pty: IPty;
  shell: string;
};

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;

export class XtermService {
  private readonly sessions = new Map<string, XtermSession>();
  private dataSink: XtermDataSink | null = null;
  private exitSink: XtermExitSink | null = null;

  setDataSink(sink: XtermDataSink | null): void {
    this.dataSink = sink;
  }

  setExitSink(sink: XtermExitSink | null): void {
    this.exitSink = sink;
  }

  createSession(request: XtermCreateRequest = {}): XtermCreateResult {
    try {
      const shell = resolveShell(request.shell ?? null);
      const args = Array.isArray(request.args) ? request.args : [];
      const cwd = request.cwd?.trim() || os.homedir();
      const cols = clampDimension(request.cols, DEFAULT_COLS);
      const rows = clampDimension(request.rows, DEFAULT_ROWS);
      const env = buildEnv(request.env ?? null);

      const pty = spawn(shell, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      });

      const id = randomUUID();
      const session: XtermSession = { id, pty, shell };
      this.sessions.set(id, session);

      pty.onData((data) => {
        this.dataSink?.(id, data);
      });
      pty.onExit(({ exitCode, signal }) => {
        this.sessions.delete(id);
        this.exitSink?.(id, { exitCode, signal });
      });

      return { ok: true, sessionId: id, shell };
    } catch (error) {
      return {
        ok: false,
        sessionId: null,
        shell: null,
        error: formatError(error),
      };
    }
  }

  write(sessionId: string, data: string): XtermSimpleResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: "Xterm session not found." };
    }
    try {
      session.pty.write(data);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  }

  resize(sessionId: string, cols: number, rows: number): XtermSimpleResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: "Xterm session not found." };
    }
    try {
      session.pty.resize(
        clampDimension(cols, DEFAULT_COLS),
        clampDimension(rows, DEFAULT_ROWS),
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
  }

  kill(sessionId: string): XtermSimpleResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: true };
    }
    try {
      session.pty.kill();
    } catch (error) {
      return { ok: false, error: formatError(error) };
    }
    this.sessions.delete(sessionId);
    return { ok: true };
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      try {
        session.pty.kill();
      } catch {
        // best effort
      }
    }
    this.sessions.clear();
  }
}

function resolveShell(requested: string | null): string {
  if (requested && requested.trim()) {
    return requested.trim();
  }
  if (process.platform === "win32") {
    return process.env.ComSpec || "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function clampDimension(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(1000, Math.max(1, Math.round(value)));
}

function buildEnv(
  overrides: Record<string, string> | null,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env.TERM) {
    env.TERM = "xterm-256color";
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === "string") {
        env[key] = value;
      }
    }
  }
  return env;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
