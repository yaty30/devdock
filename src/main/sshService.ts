import { randomUUID } from "node:crypto";
import { join as joinLocalPath, posix } from "node:path";
import { Client } from "ssh2";
import type {
  ClientChannel,
  ConnectConfig,
  FileEntryWithStats,
  SFTPWrapper,
} from "ssh2";
import type {
  DirectoryActionResult,
  DirectoryListResult,
  FilePreviewResult,
  SshConnectRequest,
  SshConnectResult,
  SshDisconnectResult,
  SshExecResult,
  SshWriteResult,
} from "../shared/dashboardTypes";

export type SshShellDataSink = (sessionId: string, data: string) => void;

type SshSession = {
  id: string;
  serverId: string;
  client: Client;
  sftp?: SFTPWrapper;
  shell?: ClientChannel;
  shellReady?: Promise<string>;
  pending?: boolean;
  shellPending?: PendingShellCommand;
  cwd?: string;
  homeCwd?: string;
};

type PendingShellCommand = {
  command: string;
  output: string;
  timer: NodeJS.Timeout;
  idleTimer?: NodeJS.Timeout;
  resolve: (result: SshExecResult) => void;
};

const FILE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const FILE_PREVIEW_SAMPLE_BYTES = 4096;

export class SshService {
  private readonly sessions = new Map<string, SshSession>();
  private shellDataSink: SshShellDataSink | null = null;

  setShellDataSink(sink: SshShellDataSink | null): void {
    this.shellDataSink = sink;
  }

  write(sessionId: string, data: string): Promise<SshWriteResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Promise.resolve({ ok: false, error: "SSH session is not active." });
    }
    return this.ensureShell(session)
      .then(() => {
        try {
          session.shell?.write(data);
          return { ok: true } as SshWriteResult;
        } catch (error) {
          return { ok: false, error: formatError(error) } as SshWriteResult;
        }
      })
      .catch((error) => ({ ok: false, error: formatError(error) } as SshWriteResult));
  }

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
    const hmac = parseAlgorithmList(request.macs);
    const cipher = parseAlgorithmList(request.ciphers);
    if (hmac.length > 0 || cipher.length > 0) {
      const algorithms: NonNullable<ConnectConfig["algorithms"]> = {};
      if (hmac.length > 0) {
        algorithms.hmac = hmac as NonNullable<typeof algorithms.hmac>;
      }
      if (cipher.length > 0) {
        algorithms.cipher = cipher as NonNullable<typeof algorithms.cipher>;
      }
      config.algorithms = algorithms;
    }

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
        void getRemoteWorkingDirectory(client)
          .then((cwd) => {
            session.cwd = cwd || undefined;
            session.homeCwd = session.cwd;
            finish({ ok: true, sessionId, cwd: session.cwd });
          })
          .catch(() => {
            finish({ ok: true, sessionId });
          })
          .finally(() => {
            // Eagerly open the interactive shell so the renderer can stream output and send raw input.
            void this.ensureShell(session).catch(() => undefined);
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

    return this.execInShell(session, trimmed);
  }

  async listDirectory(
    sessionId: string,
    requestedPath?: string | null,
  ): Promise<DirectoryListResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        ok: false,
        path: requestedPath?.trim() || "",
        items: [],
        error: "SSH session is not active.",
      };
    }

    const targetPath = requestedPath?.trim() || session.cwd || ".";
    try {
      const sftp = await this.ensureSftp(session);
      const list = await readRemoteDirectory(sftp, targetPath);
      return {
        ok: true,
        path: targetPath,
        items: sortDirectoryItems(
          list
            .filter((entry) =>
              entry.attrs.isDirectory() || entry.attrs.isFile(),
            )
            .map((entry) => ({
              name: entry.filename,
              path: joinRemotePath(targetPath, entry.filename),
              type: entry.attrs.isDirectory() ? "folder" : "file",
              size: entry.attrs.isDirectory() ? null : entry.attrs.size,
              modifiedMs: entry.attrs.mtime ? entry.attrs.mtime * 1000 : null,
            })),
        ),
      };
    } catch (error) {
      return {
        ok: false,
        path: targetPath,
        items: [],
        error: error instanceof Error ? error.message : "Unable to list directory.",
      };
    }
  }

  async createDirectory(
    sessionId: string,
    parentPath: string,
    name: string,
  ): Promise<DirectoryActionResult> {
    const safeName = sanitizeRemoteActionName(name);
    if (!safeName) {
      return { ok: false, error: "Folder name is required." };
    }
    return this.withSftp(sessionId, (sftp) =>
      sftpAction((resolve) =>
        sftp.mkdir(joinRemotePath(parentPath, safeName), resolve),
      ),
    );
  }

  async renamePath(
    sessionId: string,
    path: string,
    newName: string,
  ): Promise<DirectoryActionResult> {
    const safeName = sanitizeRemoteActionName(newName);
    if (!safeName) {
      return { ok: false, error: "New name is required." };
    }
    return this.withSftp(sessionId, (sftp) =>
      sftpAction((resolve) =>
        sftp.rename(path, joinRemotePath(posix.dirname(path), safeName), resolve),
      ),
    );
  }

  async deletePath(
    sessionId: string,
    path: string,
    type: "file" | "folder",
  ): Promise<DirectoryActionResult> {
    return this.withSftp(sessionId, (sftp) =>
      sftpAction((resolve) => {
        if (type === "folder") {
          sftp.rmdir(path, resolve);
        } else {
          sftp.unlink(path, resolve);
        }
      }),
    );
  }

  async uploadFile(
    sessionId: string,
    localPath: string,
    remoteDirectory: string,
  ): Promise<DirectoryActionResult> {
    return this.withSftp(sessionId, (sftp) =>
      sftpAction((resolve) =>
        sftp.fastPut(
          localPath,
          joinRemotePath(remoteDirectory, getLocalPathBaseName(localPath)),
          resolve,
        ),
      ),
    );
  }

  async downloadFile(
    sessionId: string,
    remotePath: string,
    localDirectory: string,
  ): Promise<DirectoryActionResult> {
    return this.withSftp(sessionId, (sftp) =>
      sftpAction((resolve) =>
        sftp.fastGet(
          remotePath,
          joinLocalPath(localDirectory, posix.basename(remotePath)),
          resolve,
        ),
      ),
    );
  }

  async previewFile(
    sessionId: string,
    remotePath: string,
  ): Promise<FilePreviewResult> {
    const fileName = posix.basename(remotePath);
    const initialMetadata = getPreviewMetadata(fileName);

    return this.withSftpPreview(sessionId, async (sftp) => {
      const buffer = await readRemoteFile(sftp, remotePath);
      if (buffer.byteLength > FILE_PREVIEW_MAX_BYTES) {
        return {
          ok: false,
          kind: initialMetadata.kind,
          fileName,
          mimeType: initialMetadata.mimeType,
          error: "Preview is limited to files 5 MB or smaller.",
        };
      }
      const metadata = resolvePreviewMetadata(fileName, initialMetadata, buffer);
      if (metadata.kind === "unsupported") {
        return { ok: true, fileName, ...metadata };
      }
      return formatPreviewBuffer(fileName, metadata, buffer);
    });
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

  private ensureSftp(session: SshSession): Promise<SFTPWrapper> {
    if (session.sftp) {
      return Promise.resolve(session.sftp);
    }

    return new Promise<SFTPWrapper>((resolve, reject) => {
      session.client.sftp((error, sftp) => {
        if (error) {
          reject(error);
          return;
        }
        session.sftp = sftp;
        resolve(sftp);
      });
    });
  }

  private async withSftp(
    sessionId: string,
    action: (sftp: SFTPWrapper) => Promise<DirectoryActionResult>,
  ): Promise<DirectoryActionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: "SSH session is not active." };
    }

    try {
      return await action(await this.ensureSftp(session));
    } catch (error) {
      return formatDirectoryActionError(error, "SSH file operation failed.");
    }
  }

  private async withSftpPreview(
    sessionId: string,
    action: (sftp: SFTPWrapper) => Promise<FilePreviewResult>,
  ): Promise<FilePreviewResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        ok: false,
        kind: "unsupported",
        fileName: "",
        mimeType: "application/octet-stream",
        error: "SSH session is not active.",
      };
    }

    try {
      return await action(await this.ensureSftp(session));
    } catch (error) {
      return {
        ok: false,
        kind: "unsupported",
        fileName: "",
        mimeType: "application/octet-stream",
        error: error instanceof Error ? error.message : "Unable to preview file.",
      };
    }
  }

  private handleShellData(session: SshSession, text: string): void {
    if (this.shellDataSink) {
      try {
        this.shellDataSink(session.id, text);
      } catch {
        // ignore sink errors
      }
    }
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
    const stdout = cleanInteractiveShellOutput(pending.output, pending.command);
    updateShellCwdFromCommand(session, pending.command, stdout);
    pending.resolve({
      stdout,
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

function parseAlgorithmList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
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

function getRemoteWorkingDirectory(client: Client): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec("pwd", (error, stream) => {
      if (error) {
        reject(error);
        return;
      }

      let output = "";
      stream.on("data", (chunk: Buffer | string) => {
        output += toText(chunk);
      });
      stream.stderr.on("data", () => undefined);
      stream.once("error", reject);
      stream.once("close", () => {
        const cwd = normalizeLineEndings(output)
          .split("\n")
          .map((line) => line.trim())
          .find(Boolean);
        resolve(cwd ?? "");
      });
    });
  });
}

function readRemoteDirectory(
  sftp: SFTPWrapper,
  path: string,
): Promise<FileEntryWithStats[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (error, list) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(list);
    });
  });
}

function readRemoteFile(sftp: SFTPWrapper, path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(path, (error, buffer) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(buffer);
    });
  });
}

function sftpAction(
  run: (resolve: (error?: Error | null) => void) => void,
): Promise<DirectoryActionResult> {
  return new Promise((resolve) => {
    run((error?: Error | null) => {
      if (error) {
        resolve(formatDirectoryActionError(error, "SSH file operation failed."));
        return;
      }
      resolve({ ok: true });
    });
  });
}

function joinRemotePath(parentPath: string, name: string): string {
  const base = parentPath.trim() || "/";
  return posix.join(base, name);
}

function sanitizeRemoteActionName(name: string): string {
  const trimmed = name.trim();
  return trimmed === "." || trimmed === ".." || trimmed.includes("/")
    ? ""
    : trimmed;
}

function getLocalPathBaseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "upload";
}

function formatDirectoryActionError(
  error: unknown,
  fallback: string,
): { ok: false; error: string } {
  return {
    ok: false,
    error: error instanceof Error ? error.message : fallback,
  };
}

function getPreviewMetadata(
  fileName: string,
): { kind: FilePreviewResult["kind"]; mimeType: string } {
  const extension = posix.extname(fileName).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(extension)) {
    return { kind: "image", mimeType: getImageMimeType(extension) };
  }
  if (extension === ".pdf") {
    return { kind: "pdf", mimeType: "application/pdf" };
  }
  if (extension === ".json") {
    return { kind: "json", mimeType: "application/json" };
  }
  if ([".xml", ".xsd", ".xsl"].includes(extension)) {
    return { kind: "xml", mimeType: "application/xml" };
  }
  if ([".txt", ".log", ".md", ".csv", ".ini", ".env", ".yaml", ".yml"].includes(extension)) {
    return { kind: "text", mimeType: "text/plain" };
  }
  const mimeType = getKnownMimeType(extension);
  if (isPreviewableTextMimeType(mimeType)) {
    return { kind: "text", mimeType };
  }
  return { kind: "unsupported", mimeType };
}

function resolvePreviewMetadata(
  fileName: string,
  metadata: { kind: FilePreviewResult["kind"]; mimeType: string },
  buffer: Buffer,
): { kind: FilePreviewResult["kind"]; mimeType: string } {
  if (metadata.kind !== "unsupported" || isKnownPreviewExtension(fileName)) {
    return metadata;
  }
  if (isPreviewableTextMimeType(metadata.mimeType) || looksLikeText(buffer)) {
    return {
      kind: "text",
      mimeType: metadata.mimeType === "application/octet-stream" ? "text/plain" : metadata.mimeType,
    };
  }
  return metadata;
}

function isKnownPreviewExtension(fileName: string): boolean {
  return [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
    ".pdf",
    ".json",
    ".xml",
    ".xsd",
    ".xsl",
    ".txt",
    ".log",
    ".md",
    ".csv",
    ".ini",
    ".env",
    ".yaml",
    ".yml",
  ].includes(posix.extname(fileName).toLowerCase());
}

function getKnownMimeType(extension: string): string {
  switch (extension) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return "application/javascript";
    case ".ts":
    case ".tsx":
      return "application/typescript";
    case ".css":
      return "text/css";
    case ".html":
    case ".htm":
      return "text/html";
    case ".sql":
      return "application/sql";
    case ".toml":
      return "application/toml";
    case ".properties":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

function isPreviewableTextMimeType(mimeType: string): boolean {
  return mimeType.startsWith("text/") || [
    "application/json",
    "application/xml",
    "application/javascript",
    "application/typescript",
    "application/x-yaml",
    "application/yaml",
    "application/toml",
    "application/sql",
    "application/x-sh",
    "application/x-shellscript",
  ].includes(mimeType);
}

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, FILE_PREVIEW_SAMPLE_BYTES);
  if (sample.length === 0) {
    return true;
  }
  if (sample.includes(0)) {
    return looksLikeUtf16Text(sample);
  }
  const decoded = sample.toString("utf8");
  if (decoded.includes("\uFFFD")) {
    return false;
  }
  return !containsBinaryControlCharacters(decoded);
}

function looksLikeUtf16Text(sample: Buffer): boolean {
  if (sample.length < 4) {
    return false;
  }
  const evenNulls = countNullBytes(sample, 0);
  const oddNulls = countNullBytes(sample, 1);
  const pairs = Math.floor(sample.length / 2);
  if (evenNulls / pairs < 0.3 && oddNulls / pairs < 0.3) {
    return false;
  }
  const decoded = evenNulls > oddNulls
    ? swapUtf16ByteOrder(sample).toString("utf16le")
    : sample.toString("utf16le");
  return !decoded.includes("\uFFFD") && !containsBinaryControlCharacters(decoded);
}

function countNullBytes(sample: Buffer, offset: number): number {
  let count = 0;
  for (let index = offset; index < sample.length; index += 2) {
    if (sample[index] === 0) {
      count += 1;
    }
  }
  return count;
}

function swapUtf16ByteOrder(sample: Buffer): Buffer {
  const swapped = Buffer.from(sample);
  for (let index = 0; index + 1 < swapped.length; index += 2) {
    const first = swapped[index];
    swapped[index] = swapped[index + 1];
    swapped[index + 1] = first;
  }
  return swapped;
}

function containsBinaryControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13 && code !== 12) {
      return true;
    }
  }
  return false;
}

function getImageMimeType(extension: string): string {
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

function formatPreviewBuffer(
  fileName: string,
  metadata: { kind: FilePreviewResult["kind"]; mimeType: string },
  buffer: Buffer,
): FilePreviewResult {
  if (metadata.kind === "image" || metadata.kind === "pdf") {
    return {
      ok: true,
      kind: metadata.kind,
      fileName,
      mimeType: metadata.mimeType,
      content: buffer.toString("base64"),
      encoding: "base64",
    };
  }

  return {
    ok: true,
    kind: metadata.kind,
    fileName,
    mimeType: metadata.mimeType,
    content: buffer.toString("utf8"),
    encoding: "utf8",
  };
}

function sortDirectoryItems<
  T extends { name: string; type: "file" | "folder" },
>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "folder" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function updateShellCwdFromCommand(
  session: SshSession,
  command: string,
  stdout: string,
): void {
  if (stdout.trim()) {
    return;
  }

  const target = parseCdTarget(command);
  if (target === null) {
    return;
  }

  if (!target || target === "~") {
    session.cwd = session.homeCwd ?? session.cwd;
    return;
  }

  if (target.startsWith("/")) {
    session.cwd = posix.normalize(target);
    return;
  }

  const base = session.cwd || session.homeCwd || "/";
  session.cwd = posix.normalize(posix.join(base, target));
}

function parseCdTarget(command: string): string | null {
  const match = /^cd(?:\s+(.+))?$/.exec(command.trim());
  if (!match) {
    return null;
  }

  const rawTarget = match[1]?.trim() ?? "";
  if (
    (rawTarget.startsWith("\"") && rawTarget.endsWith("\"")) ||
    (rawTarget.startsWith("'") && rawTarget.endsWith("'"))
  ) {
    return rawTarget.slice(1, -1);
  }

  return rawTarget;
}

function cleanInteractiveShellOutput(output: string, command: string): string {
  const commandPattern = escapeRegExp(command.trim());
  const lines = normalizeLineEndings(output)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = stripTerminalControlSequences(line).trim();
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

function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()][A-Za-z0-9]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
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
