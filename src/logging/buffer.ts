import { join } from "node:path";
import { readTextSafe } from "../utils/fs.ts";
import type { LogLevel } from "./logger.ts";

const LEVEL_MARK: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
};

export async function readLogLines(dataDir: string, limit: number): Promise<string[]> {
  const lines = (await readTextSafe(join(dataDir, "logs", "skillrouter.log"))) ?? "";
  const all = lines.split("\n").filter(Boolean);
  return all.slice(-limit);
}

export async function readLogs(dataDir: string, options: { limit?: number; level?: LogLevel } = {}): Promise<Array<{ level: LogLevel; ts: string; message: string }>> {
  const lines = await readLogLines(dataDir, options.limit ?? 100);
  const out: Array<{ level: LogLevel; ts: string; message: string }> = [];
  for (const raw of lines) {
    const match = raw.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+\[(\w+)\]\s+(.*)$/);
    if (!match) continue;
    const [, ts, level, message] = match;
    const parsed = level as LogLevel;
    if (options.level && parsed !== options.level) continue;
    out.push({ level: parsed, ts: ts ?? "", message: message ?? "" });
  }
  return out;
}

export { LEVEL_MARK };

export async function writeLog(dataDir: string, level: LogLevel, message: string): Promise<void> {
  const { appendFile } = await import("node:fs/promises");
  try {
    await appendFile(join(dataDir, "logs", "skillrouter.log"), `[${LEVEL_MARK[level]}] ${message}\n`, "utf8");
  } catch {
    // best-effort
  }
}