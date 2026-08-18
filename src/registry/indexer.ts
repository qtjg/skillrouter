import { join, isAbsolute, basename } from "node:path";
import type { Capability } from "../core/types.ts";
import type { Storage } from "../storage/types.ts";
import type { SkillRouterConfig } from "../config/config.ts";
import { fetchSource, getSourceCacheDir, type ManagedSource } from "./sources.ts";
import { discoverCatalogTree, discoverSingleDir } from "./discovery.ts";
import { loadManifestFromContent } from "../manifest/index.ts";
import { readTextSafe, pathExists } from "../utils/fs.ts";
import { walkFiles } from "../utils/glob.ts";
import { sha256File } from "../utils/hash.ts";
import { logger } from "../logging/logger.ts";
import { globalBus } from "../core/events.ts";

const BUILTIN_CATALOG = "examples/catalog";

export interface IndexResult {
  indexed: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
}

export async function indexBuiltinCatalog(storage: Storage, repoRoot: string): Promise<IndexResult> {
  const catalogDir = join(repoRoot, BUILTIN_CATALOG);
  const discovered = await discoverCatalogTree(catalogDir).catch(() => []);
  let indexed = 0;
  const errors: InitializeRegistry_errors[] = [];
  for (const item of discovered) {
    try {
      const capability = item.capability;
      capability.source = { ...capability.source, type: "catalog", location: "builtin", catalog: BUILTIN_CATALOG };
      capability.trust = capability.trust ?? "community";
      await storage.upsertCapability(capability);
      indexed += 1;
    } catch (err) {
      errors.push({ id: item.capability.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { indexed, failed: errors.length, errors };
}

interface InitializeRegistry_errors {
  id: string;
  message: string;
}

/** Discover indexed capabilities, returns capability objects found. */
export async function indexProjectAndUserDirs(storage: Storage, cwd: string): Promise<IndexResult> {
  const errors: Array<{ id: string; message: string }> = [];
  let indexed = 0;
  const roots: string[] = [];

  const projectDir = await findProjectSkillDir(cwd);
  if (projectDir) roots.push(projectDir);

  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (home) {
    for (const candidate of [
      join(home, ".skillrouter", "capabilities"),
      join(home, ".config", "skillrouter", "capabilities"),
      join(home, ".config", "opencode", "skills"),
      join(home, ".claude", "skills"),
      join(home, ".gemini", "skills"),
    ]) {
      roots.push(candidate);
    }
  }

  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    const discovered = await discoverCatalogTree(root).catch(() => []);
    for (const item of discovered) {
      try {
        const capability: Capability = { ...item.capability, trust: item.capability.trust ?? "unknown" };
        capability.source = { ...capability.source, type: "local", location: root };
        await storage.upsertCapability(capability);
        indexed += 1;
      } catch (err) {
        errors.push({ id: item.capability.id, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return { indexed, failed: errors.length, errors };
}

export async function findProjectSkillDir(cwd: string): Promise<string | null> {
  for (const candidate of [join(cwd, ".skillrouter", "capabilities"), join(cwd, ".agents", "skills"), join(cwd, ".opencode", "skills"), join(cwd, ".claude", "skills")]) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export async function indexSources(storage: Storage, sources: SkillRouterConfig["sources"], cwd: string): Promise<IndexResult> {
  const errors: Array<{ id: string; message: string }> = [];
  let indexed = 0;
  for (const source of sources) {
    if (source.enabled === false) continue;
    let managed: ManagedSource;
    try {
      managed = await fetchSource(source);
    } catch (err) {
      errors.push({ id: source.name, message: `source ${source.name}: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    if (managed.state === "missing") {
      logger.warn(`Source "${source.name}" not found at ${managed.cacheDir}`);
      continue;
    }

    let discovered: Array<{ capability: Capability; rootDir: string; manifestFile: string }> = [];

    if (managed.type === "catalog") {
      const jsonFiles = (await walkFiles(managed.cacheDir, { maxDepth: 2 })).filter((f) => f.endsWith(".json"));
      for (const file of jsonFiles) {
        const content = await readTextSafe(file);
        if (!content) continue;
        try {
          const parsed = JSON.parse(content) as unknown;
          if (!Array.isArray(parsed)) continue;
          for (const item of parsed) {
            const capability = loadManifestFromContent(JSON.stringify(item), `${file}#${String((item as { id?: unknown }).id ?? "item")}`);
            discovered.push({ capability, rootDir: file, manifestFile: file });
          }
        } catch (err) {
          errors.push({ id: basename(file), message: `invalid catalog JSON: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    } else {
      discovered = await discoverCatalogTree(managed.cacheDir);
    }

    for (const item of discovered) {
      try {
        const capability: Capability = { ...item.capability, trust: item.capability.trust ?? "unknown" };
        capability.source = {
          type: managed.type === "git" ? "git" : "catalog",
          location: managed.cacheDir,
          url: source.url,
          catalog: managed.name,
          commit: managed.commit,
        };
        await storage.upsertCapability(capability);
        indexed += 1;
      } catch (err) {
        errors.push({ id: item.capability.id, message: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return { indexed, failed: errors.length, errors };
}

export async function resolveCapabilityRef(ref: string, cwd: string, sources: SkillRouterConfig["sources"]): Promise<{ capability: Capability; sourceDir: string } | null> {
  const isPath = ref.includes("/") || ref.startsWith(".") || ref.startsWith("~") || (isAbsolute(ref) && !ref.includes(":"));
  if (isPath && !isGitUrl(ref)) {
    if (!(await pathExists(ref))) return null;
    const dir = ref;
    const found = await discoverSingleDir(dir);
    if (!found) {
      const nested = await discoverCatalogTree(dir);
      if (nested.length > 0) return { capability: nested[0]!.capability, sourceDir: nested[0]!.rootDir };
      return null;
    }
    const fsHash = await sha256File(found.manifestFile);
    found.capability.source = { type: "local", location: dir, hash: fsHash };
    return { capability: found.capability, sourceDir: found.rootDir };
  }

  if (isGitUrl(ref)) {
    const cacheRoot = getSourceCacheDir();
    const name = gitUrlToName(ref);
    const target = join(cacheRoot, `git-${name}`);
    const managed = await fetchSource({ name, type: "git", url: ref });
    void target;
    const found = await discoverSingleDir(managed.cacheDir) ?? (await discoverCatalogTree(managed.cacheDir))[0] ?? null;
    if (!found) return null;
    found.capability.source = { type: "git", location: managed.cacheDir, url: ref, commit: managed.commit };
    return { capability: found.capability, sourceDir: managed.cacheDir };
  }

  return null;
}

function isGitUrl(ref: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/).*(\.git)?$/.test(ref) || ref.endsWith(".git");
}

function gitUrlToName(url: string): string {
  const base = basename(url.replace(/\.git$/, ""));
  return base.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase() || "source";
}

export async function ensureCapabilityIndexed(storage: Storage, capability: Capability): Promise<void> {
  await storage.upsertCapability(capability);
  globalBus.emit({ event: "capability.discovered", id: capability.id, source: capability.source?.location ?? "unknown" });
}

export async function refreshAll(storage: Storage, config: SkillRouterConfig, repoRoot: string, cwd: string): Promise<IndexResult> {
  const results: IndexResult[] = [];
  results.push(await indexBuiltinCatalog(storage, repoRoot));
  results.push(await indexProjectAndUserDirs(storage, cwd));
  results.push(await indexSources(storage, config.sources, cwd));
  return {
    indexed: results.reduce((a, r) => a + r.indexed, 0),
    failed: results.reduce((a, r) => a + r.failed, 0),
    errors: results.flatMap((r) => r.errors),
  };
}