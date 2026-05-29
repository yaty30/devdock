export type SshHostValidationResult =
  | {
      ok: true;
      host: string;
      warnings: string[];
    }
  | {
      ok: false;
      host: string;
      error: string;
      warnings: string[];
    };

export type SshEndpointValidationResult =
  | {
      ok: true;
      host: string;
      port: number;
      username?: string;
      warnings: string[];
    }
  | {
      ok: false;
      host: string;
      port: number;
      username?: string;
      error: string;
      warnings: string[];
    };

export const SSH_DEFAULT_PORT = 22;
export const SSH_MIN_PORT = 1;
export const SSH_MAX_PORT = 65535;

const HIDDEN_TEXT_CHARS =
  /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;

export function cleanSshTextInput(value: unknown): string {
  return String(value ?? "")
    .replace(HIDDEN_TEXT_CHARS, "")
    .trim();
}

export function normalizeSshPortNumber(
  value: unknown,
  fallback = SSH_DEFAULT_PORT,
): number {
  const numeric =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (
    !Number.isFinite(numeric) ||
    numeric < SSH_MIN_PORT ||
    numeric > SSH_MAX_PORT
  ) {
    return fallback;
  }
  return numeric;
}

export function isValidSshPortNumber(value: unknown): boolean {
  const normalized = normalizeSshPortNumber(value, Number.NaN);
  if (!Number.isFinite(normalized)) {
    return false;
  }
  if (typeof value === "number") {
    return Math.round(value) === normalized;
  }
  return typeof value === "string" && value.trim() === String(normalized);
}

export function parseSshEndpointInput(
  address: string,
  defaultPort = SSH_DEFAULT_PORT,
): SshEndpointValidationResult {
  const warnings: string[] = [];
  let value = stripWrappingQuotes(cleanSshTextInput(address));
  if (!value) {
    return {
      ok: false,
      host: "",
      port: defaultPort,
      error: "SSH host is required.",
      warnings,
    };
  }

  if (/^ssh:\/\//i.test(value)) {
    const parsed = parseSshUrl(value, defaultPort);
    if (parsed) {
      return parsed;
    }
  }

  let username: string | undefined;
  const atIndex = value.lastIndexOf("@");
  if (atIndex >= 0) {
    username = cleanSshTextInput(value.slice(0, atIndex)) || undefined;
    value = cleanSshTextInput(value.slice(atIndex + 1));
    if (username) {
      warnings.push("Moved username out of SSH host input.");
    }
  }

  const parsedEndpoint = splitHostAndPort(value, defaultPort);
  if (!parsedEndpoint.ok) {
    return { ...parsedEndpoint, username, warnings };
  }

  const hostResult = normalizeSshHostInput(parsedEndpoint.host);
  return hostResult.ok
    ? {
        ok: true,
        host: hostResult.host,
        port: parsedEndpoint.port,
        username,
        warnings: [...warnings, ...hostResult.warnings],
      }
    : {
        ok: false,
        host: hostResult.host,
        port: parsedEndpoint.port,
        username,
        error: hostResult.error,
        warnings: [...warnings, ...hostResult.warnings],
      };
}

export function normalizeSshHostInput(host: string): SshHostValidationResult {
  const warnings: string[] = [];
  let value = stripWrappingQuotes(cleanSshTextInput(host));
  if (!value) {
    return { ok: false, host: "", error: "SSH host is required.", warnings };
  }

  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1).trim();
  }

  if (/^[\\/]+/.test(value)) {
    return {
      ok: false,
      host: value,
      error:
        'SSH host must not start with a slash or backslash. Use "server-name", not "\\\\server-name".',
      warnings,
    };
  }

  if (/[\\/]/.test(value)) {
    return {
      ok: false,
      host: value,
      error:
        "SSH host must be a hostname or IP address, not a Windows or filesystem path.",
      warnings,
    };
  }

  if (/\s/.test(value)) {
    return {
      ok: false,
      host: value,
      error: "SSH host must not contain whitespace.",
      warnings,
    };
  }

  if (value.includes("@")) {
    return {
      ok: false,
      host: value,
      error:
        "SSH host must not include a username. Put the username in the username field.",
      warnings,
    };
  }

  const normalized = value;
  if (
    isValidIpv4Address(normalized) ||
    isValidIpv6Address(normalized) ||
    isValidDnsHostname(normalized)
  ) {
    return { ok: true, host: normalized, warnings };
  }

  return {
    ok: false,
    host: normalized,
    error:
      "SSH host must be an IP address, short hostname, or fully qualified domain name.",
    warnings,
  };
}

export function formatSshEndpoint(host: string, port: number): string {
  const normalizedHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${normalizedHost}:${normalizeSshPortNumber(port)}`;
}

export function isIpAddressHost(host: string): boolean {
  return isValidIpv4Address(host) || isValidIpv6Address(host);
}

function parseSshUrl(
  value: string,
  defaultPort: number,
): SshEndpointValidationResult | null {
  try {
    const url = new URL(value);
    const hostResult = normalizeSshHostInput(url.hostname);
    const port = url.port
      ? normalizeSshPortNumber(url.port, Number.NaN)
      : defaultPort;
    if (!Number.isFinite(port)) {
      return {
        ok: false,
        host: url.hostname,
        port: defaultPort,
        username: url.username || undefined,
        error: "SSH port must be a number from 1 to 65535.",
        warnings: [],
      };
    }
    return hostResult.ok
      ? {
          ok: true,
          host: hostResult.host,
          port,
          username: url.username || undefined,
          warnings: hostResult.warnings,
        }
      : {
          ok: false,
          host: hostResult.host,
          port,
          username: url.username || undefined,
          error: hostResult.error,
          warnings: hostResult.warnings,
        };
  } catch {
    return null;
  }
}

function splitHostAndPort(
  value: string,
  defaultPort: number,
):
  | { ok: true; host: string; port: number }
  | { ok: false; host: string; port: number; error: string } {
  if (value.startsWith("[")) {
    const closingBracketIndex = value.indexOf("]");
    if (closingBracketIndex <= 1) {
      return {
        ok: false,
        host: value,
        port: defaultPort,
        error: "Bracketed SSH host is incomplete.",
      };
    }
    const host = value.slice(1, closingBracketIndex).trim();
    const suffix = value.slice(closingBracketIndex + 1).trim();
    if (!suffix) {
      return { ok: true, host, port: defaultPort };
    }
    if (!suffix.startsWith(":")) {
      return {
        ok: false,
        host,
        port: defaultPort,
        error: "SSH port must follow the host as [host]:port.",
      };
    }
    const port = parsePortText(suffix.slice(1));
    return Number.isFinite(port)
      ? { ok: true, host, port }
      : {
          ok: false,
          host,
          port: defaultPort,
          error: "SSH port must be a number from 1 to 65535.",
        };
  }

  const colonCount = (value.match(/:/g) ?? []).length;
  if (colonCount === 0 || colonCount > 1) {
    return { ok: true, host: value, port: defaultPort };
  }

  const colonIndex = value.lastIndexOf(":");
  const host = value.slice(0, colonIndex).trim();
  const portText = value.slice(colonIndex + 1).trim();
  if (!host || !portText) {
    return {
      ok: false,
      host,
      port: defaultPort,
      error: "SSH address must use host or host:port format.",
    };
  }
  const port = parsePortText(portText);
  return Number.isFinite(port)
    ? { ok: true, host, port }
    : {
        ok: false,
        host,
        port: defaultPort,
        error: "SSH port must be a number from 1 to 65535.",
      };
}

function parsePortText(value: string): number {
  if (!/^\d+$/.test(value)) {
    return Number.NaN;
  }
  return normalizeSshPortNumber(Number.parseInt(value, 10), Number.NaN);
}

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? value.slice(1, -1).trim()
    : value;
}

function isValidIpv4Address(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d+$/.test(part)) {
        return false;
      }
      const number = Number.parseInt(part, 10);
      return (
        number >= 0 &&
        number <= 255 &&
        String(number) === part.replace(/^0+(?=\d)/, "")
      );
    })
  );
}

function isValidIpv6Address(value: string): boolean {
  return (
    value.includes(":") && /^[0-9a-fA-F:.]+$/.test(value) && value.length >= 2
  );
}

function isValidDnsHostname(value: string): boolean {
  const normalized = value.endsWith(".") ? value.slice(0, -1) : value;
  if (!normalized || normalized.length > 253) {
    return false;
  }
  return normalized
    .split(".")
    .every((label) =>
      /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/.test(label),
    );
}
