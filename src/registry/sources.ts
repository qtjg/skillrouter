import { join } from "node:path";
import { homedir } from "node:os";
import { configPaths } from "../config/config.ts";
import { ensureDir, pathExists } from "../utils/fs.ts";
import { run } from "../utils/proc.ts";
import { GitError } from "../utils/errors.ts";
import { SkillRouterError } from "../utils/errors.ts";

export interface ManagedSource {
  name: string;
  type: "git" | "catalog" | "directory";
  url?: string;
  path?: string;
  enabled: boolean;
  cacheDir: string;
  state: "fresh" | "updated" | "missing" | "error";
  commit?: string;
}

function sourcesDir(): string {
  const { stateDir } = configPaths(process.cwd());
  return join(stateDir, "sources");
}

export function getSourceCacheDir(): string {
  return sourcesDir();
}

export async function fetchSource(source: { name: string; type: "git" | "catalog" | "directory"; url?: string; path?: string }): Promise<ManagedSource> {
  const cacheRoot = sourcesDir();
  await ensureDir(cacheRoot);

  if (source.type === "git") {
    if (!source.url) throw new SkillRouterError("E_SOURCE", `Git source "${source.name}" has no url`);
    const target = join(cacheRoot, `git-${source.name.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
    if (!(await pathExists(join(target, ".git")))) {
      await ensureDir(target);
      const result = await run("git", ["clone", "--depth", "1", source.url, target]);
      if (!result.ok) throw new GitError(`Failed to clone ${source.url}: ${result.stderr.trim().slice(0, 500)}`);
      return { ...source, enabled: true, cacheDir: target, state: "fresh" };
    }
    const result = await run("git", ["-C", target, "pull", "--ff-only"], { timeoutMs: 60000 });
    if (!result.ok) throw new GitError(`Failed to update ${source.url}: ${result.stderr.trim().slice(0, 500)}`);
    const rev = await run("git", ["-C", target, "rev-parse", "--short", "HEAD"]);
    return { ...source, enabled: true, cacheDir: target, state: "updated", commit: rev.stdout.trim() };
  }

  if (source.type === "directory") {
    const rawPath = source.path ? resolveUser(source.path) : undefined;
    if (!rawPath) throw new SkillRouterError("E_SOURCE", `Directory source "${source.name}" has no path`);
    if (!(await pathExists(rawPath))) {
      return { ...source, enabled: true, cacheDir: rawPath, state: "missing" };
    }
    return { ...source, enabled: true, cacheDir: rawPath, state: "fresh" };
  }

  if (source.type === "catalog") {
    const rawPath = source.path ? resolveUser(source.path) : undefined;
    if (!rawPath) throw new SkillRouterError("E_SOURCE", `Catalog source "${source.name}" has no path or url`);
    if (!(await pathExists(rawPath))) {
      return { ...source, enabled: true, cacheDir: rawPath, state: "missing" };
    }
    return { ...source, enabled: true, cacheDir: rawPath, state: "fresh" };
  }

  throw new SkillRouterError("E_SOURCE", `Unknown source type "${source.type}" for "${source.name}"`);
}

function resolveUser(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}