import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { join as joinLocalPath, posix } from "node:path";
import { Client } from "ssh2";
import type {
  ClientChannel,
  ConnectConfig,
  FileEntryWithStats,
  SFTPWrapper,
} from "ssh2";
import type { Duplex } from "node:stream";
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
import {
  formatSshEndpoint,
  isIpAddressHost,
  parseSshEndpointInput,
  type SshEndpointValidationResult,
} from "../shared/sshHost";

export type SshShellDataSink = (sessionId: string, data: string) => void;

type SshSession = {
  id: string;
  serverId: string;
  client: Client;
  jumpClient?: Client;
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

type SshEndpoint = {
  host: string;
  port: number;
};

type SshCredentials = {
  username: string;
  password: string;
  macs?: string;
  ciphers?: string;
};

const FILE_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const FILE_PREVIEW_SAMPLE_BYTES = 4096;
const SFTP_READY_TIMEOUT_MS = 15000;
const SFTP_DIRECTORY_TIMEOUT_MS = 15000;
const SFTP_CWD_TIMEOUT_MS = 8000;

export class SshService {
  private readonly sessions = new Map<string, SshSession>();
  private shellDataSink: SshShellDataSink | null = null;

  setShellDataSink(sink: SshShellDataSink | null): void {
    this.shellDataSink = sink;
  }

  write(sessionId: string, data: string): Promise<SshWriteResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Promise.resolve({
        ok: false,
        error: "SSH session is not active.",
      });
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
      .catch(
        (error) => ({ ok: false, error: formatError(error) }) as SshWriteResult,
      );
  }

  async connect(request: SshConnectRequest): Promise<SshConnectResult> {
    const endpointResult = parseSshAddress(request.address);
    if (!endpointResult.ok) {
      logSshConnectValidation("target", request.address, endpointResult);
      return Promise.resolve({
        ok: false,
        sessionId: null,
        error: endpointResult.error,
      });
    }
    logSshConnectValidation("target", request.address, endpointResult);

    const endpoint = toSshEndpoint(endpointResult);
    const credentials = normalizeSshCredentials(
      request,
      endpointResult.username,
    );
    if (!credentials.username) {
      return Promise.resolve({
        ok: false,
        sessionId: null,
        error: "SSH username is required.",
      });
    }

    if (request.jump) {
      return this.connectThroughJump(request, endpoint, credentials);
    }

    const client = new Client();
    const resolvedEndpoint = await resolveOpenSshEndpoint(endpoint).catch(
      (error) => null,
    );
    if (!resolvedEndpoint) {
      return {
        ok: false,
        sessionId: null,
        error: "OpenSSH resolved an invalid SSH host.",
      };
    }
    const dnsResult = await testDnsResolution("target", resolvedEndpoint);
    if (!dnsResult.ok) {
      return {
        ok: false,
        sessionId: null,
        error: dnsResult.error,
      };
    }
    const config = buildConnectConfig(resolvedEndpoint, credentials);

    return this.establishSession(request, client, config);
  }

  private async connectThroughJump(
    request: SshConnectRequest,
    endpoint: SshEndpoint,
    credentials: SshCredentials,
  ): Promise<SshConnectResult> {
    const jump = request.jump;
    const jumpEndpointResult = jump ? parseSshAddress(jump.address) : null;
    if (!jump || !jumpEndpointResult?.ok) {
      if (jump) {
        logSshConnectValidation("jump", jump.address, jumpEndpointResult);
      }
      return Promise.resolve({
        ok: false,
        sessionId: null,
        error:
          jumpEndpointResult && !jumpEndpointResult.ok
            ? jumpEndpointResult.error
            : "SSH jump address is required.",
      });
    }
    logSshConnectValidation("jump", jump.address, jumpEndpointResult);

    const jumpEndpoint = toSshEndpoint(jumpEndpointResult);
    const jumpCredentials = normalizeSshCredentials(
      jump,
      jumpEndpointResult.username,
    );
    if (!jumpCredentials.username) {
      return Promise.resolve({
        ok: false,
        sessionId: null,
        error: "SSH jump username is required.",
      });
    }

    const jumpClient = new Client();
    const resolvedJumpEndpoint = await resolveOpenSshEndpoint(
      jumpEndpoint,
    ).catch(() => null);
    if (!resolvedJumpEndpoint) {
      return {
        ok: false,
        sessionId: null,
        error: "OpenSSH resolved an invalid SSH jump host.",
      };
    }
    const jumpDnsResult = await testDnsResolution("jump", resolvedJumpEndpoint);
    if (!jumpDnsResult.ok) {
      return {
        ok: false,
        sessionId: null,
        error: jumpDnsResult.error,
      };
    }
    const jumpConfig = buildConnectConfig(
      resolvedJumpEndpoint,
      jumpCredentials,
    );
    logSshDnsSkipped("target-via-jump", endpoint);

    return new Promise((resolve) => {
      let settled = false;
      let jumpReady = false;

      const finish = (result: SshConnectResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      jumpClient.once("ready", () => {
        jumpReady = true;
        jumpClient.forwardOut(
          "127.0.0.1",
          0,
          endpoint.host,
          endpoint.port,
          (error, stream) => {
            if (error) {
              jumpClient.end();
              finish({ ok: false, sessionId: null, error: formatError(error) });
              return;
            }

            const targetClient = new Client();
            const targetConfig = buildConnectConfig(
              endpoint,
              credentials,
              stream,
            );
            void this.establishSession(
              request,
              targetClient,
              targetConfig,
              jumpClient,
            ).then(finish);
          },
        );
      });

      jumpClient.on("error", (error) => {
        if (!settled && !jumpReady) {
          finish({ ok: false, sessionId: null, error: formatError(error) });
        }
      });

      try {
        jumpClient.connect(jumpConfig);
      } catch (error) {
        finish({ ok: false, sessionId: null, error: formatError(error) });
      }
    });
  }

  private establishSession(
    request: SshConnectRequest,
    client: Client,
    config: ConnectConfig,
    jumpClient?: Client,
  ): Promise<SshConnectResult> {
    return new Promise((resolve) => {
      let settled = false;
      let ready = false;

      const finish = (result: SshConnectResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      client.once("ready", () => {
        ready = true;
        const sessionId = randomUUID();
        const session: SshSession = {
          id: sessionId,
          serverId: request.serverId,
          client,
          jumpClient,
        };
        this.sessions.set(sessionId, session);
        client.once("close", () => {
          this.sessions.delete(sessionId);
          jumpClient?.end();
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
        if (!settled && !ready) {
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
    session.jumpClient?.end();
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
            .filter(
              (entry) => entry.attrs.isDirectory() || entry.attrs.isFile(),
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
        error:
          error instanceof Error ? error.message : "Unable to list directory.",
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
        sftp.rename(
          path,
          joinRemotePath(posix.dirname(path), safeName),
          resolve,
        ),
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
      const metadata = resolvePreviewMetadata(
        fileName,
        initialMetadata,
        buffer,
      );
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
      session.jumpClient?.end();
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
            // Use CR (\r) as the Enter key. Real terminals send CR for Enter; the
            // remote PTY line discipline then translates it. Sending LF alone
            // breaks shells like Windows cmd.exe (when nested through ssh) that
            // do not treat \n as a line submission, causing subsequent commands
            // to be concatenated (e.g. "dir" + "pwd" -> "dirpwd").
            session.shell?.write(`${command}\r`);
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
      let settled = false;
      const finish = (error: unknown, sftp?: SFTPWrapper): void => {
        if (settled) {
          sftp?.end();
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error);
          return;
        }
        if (!sftp) {
          reject(new Error("SFTP session was not created."));
          return;
        }
        session.sftp = sftp;
        resolve(sftp);
      };
      const timer = setTimeout(() => {
        finish(
          createTimeoutError("Opening SFTP session", SFTP_READY_TIMEOUT_MS),
        );
      }, SFTP_READY_TIMEOUT_MS);

      session.client.sftp((error, sftp) => {
        finish(error, sftp);
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
        error:
          error instanceof Error ? error.message : "Unable to preview file.",
      };
    }
  }

  private handleShellData(session: SshSession, text: string): void {
    if (session.shellPending) {
      this.handleCommandData(session, text);
      return;
    }

    if (this.shellDataSink) {
      try {
        this.shellDataSink(session.id, text);
      } catch {
        // ignore sink errors
      }
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

function buildConnectConfig(
  endpoint: SshEndpoint,
  credentials: SshCredentials,
  sock?: Duplex,
): ConnectConfig {
  const config: ConnectConfig = {
    host: endpoint.host,
    port: endpoint.port,
    username: credentials.username,
    password: credentials.password,
    readyTimeout: 15000,
    keepaliveInterval: 15000,
  };
  if (sock) {
    config.sock = sock;
  }

  const hmac = parseAlgorithmList(credentials.macs);
  const cipher = parseAlgorithmList(credentials.ciphers);
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

  return config;
}

function parseSshAddress(address: string): SshEndpointValidationResult {
  return parseSshEndpointInput(address);
}

function toSshEndpoint(
  result: Extract<SshEndpointValidationResult, { ok: true }>,
): SshEndpoint {
  return { host: result.host, port: result.port };
}

function normalizeSshCredentials(
  credentials: SshCredentials,
  endpointUsername?: string,
): SshCredentials {
  return {
    username: credentials.username.trim() || endpointUsername?.trim() || "",
    password: credentials.password,
    macs: credentials.macs,
    ciphers: credentials.ciphers,
  };
}

async function resolveOpenSshEndpoint(
  endpoint: SshEndpoint,
): Promise<SshEndpoint> {
  const output = await getOpenSshConfig(endpoint).catch(() => null);
  if (!output) {
    logSshResolvedEndpoint(endpoint, endpoint, false);
    return endpoint;
  }

  const config = parseOpenSshConfig(output);
  const resolved = {
    host: config.host || endpoint.host,
    port: config.port ?? endpoint.port,
  };
  const validation = parseSshEndpointInput(
    formatSshEndpoint(resolved.host, resolved.port),
  );
  if (!validation.ok) {
    throw new Error(`OpenSSH resolved an invalid host: ${validation.error}`);
  }
  const normalized = toSshEndpoint(validation);
  logSshResolvedEndpoint(endpoint, normalized, true);
  return normalized;
}

type DnsResolutionResult =
  | { ok: true; host: string; addresses: string[]; skipped?: boolean }
  | { ok: false; host: string; error: string };

async function testDnsResolution(
  label: string,
  endpoint: SshEndpoint,
): Promise<DnsResolutionResult> {
  if (isIpAddressHost(endpoint.host)) {
    const result: DnsResolutionResult = {
      ok: true,
      host: endpoint.host,
      addresses: [endpoint.host],
      skipped: true,
    };
    logSshDnsResult(label, endpoint, result);
    return result;
  }

  try {
    const records = await lookup(endpoint.host, { all: true });
    const result = {
      ok: true,
      host: endpoint.host,
      addresses: records.map(
        (record) => `${record.address}/IPv${record.family}`,
      ),
    } as const;
    logSshDnsResult(label, endpoint, result);
    return result;
  } catch (error) {
    const message = formatError(error);
    const result = {
      ok: false,
      host: endpoint.host,
      error: `DNS lookup failed for SSH ${label} host "${endpoint.host}" inside the app: ${message}`,
    } as const;
    logSshDnsResult(label, endpoint, result);
    return result;
  }
}

function logSshConnectValidation(
  label: string,
  rawAddress: string,
  result: SshEndpointValidationResult | null,
): void {
  if (!result) {
    console.warn("[ssh:connect:host]", {
      label,
      rawAddress,
      ok: false,
      error: "Missing SSH address.",
    });
    return;
  }
  const payload = {
    label,
    rawAddress,
    ok: result.ok,
    normalizedHost: result.host,
    port: result.port,
    embeddedUsername: result.username ?? null,
    warnings: result.warnings,
    error: result.ok ? null : result.error,
  };
  if (result.ok) {
    console.info("[ssh:connect:host]", payload);
  } else {
    console.warn("[ssh:connect:host]", payload);
  }
}

function logSshResolvedEndpoint(
  input: SshEndpoint,
  resolved: SshEndpoint,
  usedOpenSshConfig: boolean,
): void {
  console.info("[ssh:connect:resolved-host]", {
    inputHost: input.host,
    inputPort: input.port,
    hostPassedToSsh2: resolved.host,
    portPassedToSsh2: resolved.port,
    usedOpenSshConfig,
  });
}

function logSshDnsResult(
  label: string,
  endpoint: SshEndpoint,
  result: DnsResolutionResult,
): void {
  const payload = {
    label,
    host: endpoint.host,
    port: endpoint.port,
    ok: result.ok,
    addresses: result.ok ? result.addresses : [],
    skipped: result.ok ? Boolean(result.skipped) : false,
    error: result.ok ? null : result.error,
  };
  if (result.ok) {
    console.info("[ssh:connect:dns]", payload);
  } else {
    console.warn("[ssh:connect:dns]", payload);
  }
}

function logSshDnsSkipped(label: string, endpoint: SshEndpoint): void {
  console.info("[ssh:connect:dns]", {
    label,
    host: endpoint.host,
    port: endpoint.port,
    ok: true,
    skipped: true,
    reason:
      "Target host is resolved by the jump server, not by the app process.",
  });
}

function getOpenSshConfig(endpoint: SshEndpoint): Promise<string> {
  const args = ["-G"];
  if (endpoint.port !== 22) {
    args.push("-p", String(endpoint.port));
  }
  args.push(endpoint.host);

  return new Promise((resolve, reject) => {
    execFile(
      "ssh",
      args,
      {
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 256 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function parseOpenSshConfig(output: string): { host?: string; port?: number } {
  let host: string | undefined;
  let port: number | undefined;

  for (const line of output.split(/\r?\n/)) {
    const match = /^(hostname|port)\s+(.+)$/i.exec(line.trim());
    if (!match) {
      continue;
    }
    const key = match[1]?.toLowerCase();
    const value = match[2]?.trim() ?? "";
    if (key === "hostname" && value) {
      host = value;
    } else if (key === "port") {
      const parsedPort = Number.parseInt(value, 10);
      if (
        Number.isInteger(parsedPort) &&
        parsedPort > 0 &&
        parsedPort <= 65535
      ) {
        port = parsedPort;
      }
    }
  }

  return { host, port };
}

function cleanShellOutput(output: string): string {
  return output.replace(/^\n+/, "").replace(/\n+$/, "");
}

function getRemoteWorkingDirectory(client: Client): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, sftp?: SFTPWrapper, path?: string): void => {
      if (settled) {
        sftp?.end();
        return;
      }
      settled = true;
      clearTimeout(timer);
      sftp?.end();
      if (error) {
        reject(error);
        return;
      }
      resolve(path || "");
    };
    const timer = setTimeout(() => {
      finish(
        createTimeoutError(
          "Resolving remote working directory",
          SFTP_CWD_TIMEOUT_MS,
        ),
      );
    }, SFTP_CWD_TIMEOUT_MS);

    client.sftp((error, sftp) => {
      if (error) {
        finish(error);
        return;
      }
      if (settled) {
        sftp.end();
        return;
      }

      sftp.realpath(".", (realpathError, absolutePath) => {
        finish(realpathError, sftp, absolutePath);
      });
    });
  });
}

function readRemoteDirectory(
  sftp: SFTPWrapper,
  path: string,
): Promise<FileEntryWithStats[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (
      error: unknown,
      list?: FileEntryWithStats[],
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve(list ?? []);
    };
    const timer = setTimeout(() => {
      finish(
        createTimeoutError(
          "Listing remote directory",
          SFTP_DIRECTORY_TIMEOUT_MS,
        ),
      );
    }, SFTP_DIRECTORY_TIMEOUT_MS);

    sftp.readdir(path, (error, list) => {
      finish(error, list);
    });
  });
}

function createTimeoutError(operation: string, timeoutMs: number): Error {
  return new Error(
    `${operation} timed out after ${Math.round(timeoutMs / 1000)}s.`,
  );
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
        resolve(
          formatDirectoryActionError(error, "SSH file operation failed."),
        );
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
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? "upload"
  );
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

function getPreviewMetadata(fileName: string): {
  kind: FilePreviewResult["kind"];
  mimeType: string;
} {
  const extension = posix.extname(fileName).toLowerCase();
  if (
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(
      extension,
    )
  ) {
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
  if (
    [".txt", ".log", ".md", ".csv", ".ini", ".env", ".yaml", ".yml"].includes(
      extension,
    )
  ) {
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
      mimeType:
        metadata.mimeType === "application/octet-stream"
          ? "text/plain"
          : metadata.mimeType,
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
  return (
    mimeType.startsWith("text/") ||
    [
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
    ].includes(mimeType)
  );
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
  const decoded =
    evenNulls > oddNulls
      ? swapUtf16ByteOrder(sample).toString("utf16le")
      : sample.toString("utf16le");
  return (
    !decoded.includes("\uFFFD") && !containsBinaryControlCharacters(decoded)
  );
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

  const base = session.cwd || session.homeCwd || "/";
  if (isWindowsRemotePath(target) || isWindowsRemotePath(base)) {
    session.cwd = resolveWindowsRemotePath(base, target);
    return;
  }

  if (target.startsWith("/")) {
    session.cwd = posix.normalize(target);
    return;
  }

  session.cwd = posix.normalize(posix.join(base, target));
}

function isWindowsRemotePath(path: string): boolean {
  return /^[A-Za-z]:/.test(path.trim()) || path.includes("\\");
}

function resolveWindowsRemotePath(
  basePath: string,
  targetPath: string,
): string {
  const target = targetPath.trim();
  if (/^[A-Za-z]:/.test(target)) {
    return normalizeWindowsRemotePath(target);
  }

  const base = normalizeWindowsRemotePath(basePath || "C:\\");
  const drive = /^([A-Za-z]:)/.exec(base)?.[1] ?? "C:";
  if (/^[\\/]/.test(target)) {
    return normalizeWindowsRemotePath(`${drive}${target}`);
  }

  return normalizeWindowsRemotePath(
    `${base.replace(/[\\/]+$/, "")}\\${target}`,
  );
}

function normalizeWindowsRemotePath(path: string): string {
  const normalizedSlashes = path.trim().replace(/\/+/g, "\\");
  const match = /^([A-Za-z]:)(.*)$/.exec(normalizedSlashes);
  if (!match) {
    return normalizedSlashes;
  }

  const drive = match[1];
  const tail = match[2].replace(/^[\\/]+/, "");
  const parts = tail.split(/[\\/]+/);
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }

  return stack.length > 0 ? `${drive}\\${stack.join("\\")}` : `${drive}\\`;
}

function parseCdTarget(command: string): string | null {
  const match = /^cd(?:\s+(.+))?$/.exec(command.trim());
  if (!match) {
    return null;
  }

  const rawTarget = match[1]?.trim() ?? "";
  if (
    (rawTarget.startsWith('"') && rawTarget.endsWith('"')) ||
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
