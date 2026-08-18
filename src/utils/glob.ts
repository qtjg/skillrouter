import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export interface GlobOptions {
  ignore?: string[];
  followSymlinks?: boolean;
  maxDepth?: number;
}

const DEFAULT_IGNORES = ["node_modules", ".git", ".skillrouter", "dist", "build", "coverage", ".next", ".svelte-kit", ".venv", "venv", "__pycache__", ".cache"];

function compileGlob(pattern: string): RegExp {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (pattern[i] === "/") {
          i += 1;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if (c === "{") {
      const end = pattern.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
        i += 1;
      } else {
        const options = pattern.slice(i + 1, end).split(",").map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        re += `(?:${options.join("|")})`;
        i = end + 1;
      }
    } else {
      re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

function isIgnored(rel: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(rel) || p.test(rel.split("/")[0]!));
}

export async function walkFiles(dir: string, options: GlobOptions = {}): Promise<string[]> {
  const ignorePatterns = (options.ignore ?? []).concat(DEFAULT_IGNORES).map(compileGlob);
  const maxDepth = options.maxDepth ?? 12;
  const out: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(current, entry.name);
      const rel = relative(dir, abs);
      if (entry.isDirectory()) {
        if (isIgnored(rel, ignorePatterns)) continue;
        await walk(abs, depth + 1);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }

  await walk(dir, 0);
  return out;
}

export async function walkDirs(dir: string, maxDepth = 12): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        out.push(abs);
        await walk(abs, depth + 1);
      }
    }
  }
  await walk(dir, 0);
  return out;
}

export function matchesGlob(filePath: string, patterns: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return patterns.some((pattern) => {
    if (pattern.includes("**")) {
      return compileGlob(pattern).test(normalized);
    }
    const glob = compileGlob(pattern);
    return glob.test(normalized) || glob.test(normalized.split("/").pop() ?? "");
  });
}
