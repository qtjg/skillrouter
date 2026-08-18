import { appendFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { configPaths } from "../config/config.ts";
import { ensureDir } from "../utils/fs.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogEntry {
  ts: string;
  level: LogLevel;
  message: string;
  context?: string;
  [key: string]: unknown;
}

const SECRET_PATTERNS: RegExp[] = [
  /(sk-[a-zA-Z0-9]{20,})/g,
  /(pk-[a-zA-Z0-9]{20,})/g,
  /(ghp_[a-zA-Z0-9]{36,})/g,
  /(AIza[0-9A-Za-z_-]{30,})/g,
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)/g,
  /((?:api[_-]?key|secret|token|password)\s*[=:]\s*["']?[^\s"']{8,})/gi,
];

const SECRET_KEYS = ["token", "secret", "password", "apikey", "api_key", "api-key", "privatekey", "credential", "jwt", "access_key"];

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    let text = value;
    for (const pattern of SECRET_PATTERNS) {
      text = text.replace(pattern, (match, group1) => {
        const secret = group1 ?? match;
        return match.replace(secret, `[REDACTED:${secret.slice(0, 4)}…]`);
      });
    }
    return text;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if (SECRET_KEYS.some((k) => lower.includes(k))) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redact(val);
      }
    }
    return out;
  }
  return value;
}

class Logger {
  private level: LogLevel = "info";
  private memoryBuffer: LogEntry[] = [];
  private readonly memoryLimit = 500;
  private file: string | null = null;
  private enabled = true;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  async init(cwd = process.cwd()): Promise<void> {
    const { stateDir } = configPaths(cwd);
    this.file = join(stateDir, "logs.jsonl");
    await ensureDir(stateDir);
  }

  setFile(file: string | null): void {
    this.file = file;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  silent(): void {
    this.enabled = false;
  }

  private entry(level: LogLevel, message: string, fields?: Record<string, unknown>): LogEntry {
    const entry: LogEntry = { ts: new Date().toISOString(), level, message, ...(fields ?? {}) };
    const safe = redact(entry) as LogEntry;
    this.memoryBuffer.push(safe);
    if (this.memoryBuffer.length > this.memoryLimit) this.memoryBuffer.shift();
    if (this.enabled && LEVEL_ORDER[level] >= LEVEL_ORDER[this.level] && this.file) {
      void appendFile(this.file, JSON.stringify(safe) + "\n", "utf8").catch(() => {});
    }
    return safe;
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.entry("debug", message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.entry("info", message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.entry("warn", message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.entry("error", message, fields);
  }

  getBuffer(): LogEntry[] {
    return [...this.memoryBuffer];
  }
}

export const logger = new Logger();

export async function readLogFile(cwd: string, options: { limit?: number; level?: LogLevel } = {}): Promise<LogEntry[]> {
  const { stateDir } = configPaths(cwd);
  const file = join(stateDir, "logs.jsonl");
  try {
    const s = await stat(file);
    if (s.size === 0) return [];
  } catch {
    return [];
  }
  const content = await readFile(file, "utf8");
  const min = LEVEL_ORDER[options.level ?? "debug"];
  const entries = content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as LogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is LogEntry => e !== null && LEVEL_ORDER[e.level] >= min);
  return options.limit ? entries.slice(-options.limit) : entries;
}