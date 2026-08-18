import { join } from "node:path";
import { parse, stringify } from "yaml";
import { readTextSafe, writeTextAtomic, pathExists } from "../utils/fs.ts";
import { SkillRouterError } from "../utils/errors.ts";
import { sha256Dir } from "../utils/hash.ts";
import { walkFiles } from "../utils/glob.ts";

export interface LockfileEntry {
  version: string;
  hash: string | null;
  source: {
    type: string;
    location: string;
    url?: string;
    commit?: string;
  } | null;
}

export interface Lockfile {
  path: string;
  version: number;
  capabilities: Map<string, LockfileEntry>;
}

export function lockfilePath(projectRoot: string): string {
  return join(projectRoot, "skillrouter.lock");
}

export async function readLockfile(projectRoot: string): Promise<Lockfile | null> {
  const path = lockfilePath(projectRoot);
  if (!(await pathExists(path))) return null;
  const content = await readTextSafe(path);
  if (content === null) return null;
  try {
    const raw = parse(content) as Record<string, unknown>;
    if (typeof raw["capabilities"] !== "object" || raw["capabilities"] === null) {
      throw new SkillRouterError("E_LOCKFILE", `Invalid lockfile ${path}: missing "capabilities" mapping`);
    }
    const capabilities = new Map<string, LockfileEntry>();
    for (const [id, entry] of Object.entries(raw["capabilities"] as Record<string, unknown>)) {
      const e = entry as Record<string, unknown>;
      capabilities.set(id, {
        version: String(e["version"] ?? "0.0.0"),
        hash: typeof e["hash"] === "string" ? (e["hash"] as string) : null,
        source: e["source"] && typeof e["source"] === "object" ? ((e["source"] as Record<string, unknown>)["type"] ? (e["source"] as LockfileEntry["source"]) : null) : null,
      });
    }
    return { path, version: typeof raw["version"] === "number" ? raw["version"] : 1, capabilities };
  } catch (err) {
    if (err instanceof SkillRouterError) throw err;
    throw new SkillRouterError("E_LOCKFILE", `Invalid lockfile ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function writeLockfile(lockfile: Lockfile): Promise<void> {
  const capabilities: Record<string, unknown> = {};
  for (const [id, entry] of [...lockfile.capabilities.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const out: Record<string, unknown> = { version: entry.version };
    if (entry.hash) out["hash"] = entry.hash;
    if (entry.source) out["source"] = entry.source;
    capabilities[id] = out;
  }
  const doc = {
    version: lockfile.version,
    capabilities,
  };
  await writeTextAtomic(lockfile.path, stringify(doc, { indent: 2 }) + "\n");
}

export function upsertLockEntry(lockfile: Lockfile, id: string, entry: LockfileEntry): void {
  lockfile.capabilities.set(id, entry);
}

export function removeLockEntry(lockfile: Lockfile, id: string): boolean {
  return lockfile.capabilities.delete(id);
}

export async function verifyEntry(dir: string, entry: LockfileEntry): Promise<{ ok: boolean; actual: string | null; expected: string | null }> {
  const actual = await sha256Dir(dir, walkFiles);
  return { ok: entry.hash === null || actual === entry.hash, actual, expected: entry.hash };
}