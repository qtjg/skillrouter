import type { Capability } from "../core/types.ts";
import type { Storage } from "../storage/types.ts";
import { NotFoundError } from "../utils/errors.ts";
import { fuzzyIdMatch } from "../registry/search.ts";

export interface ResolvedSource {
  sourceKey: string;
  fetcherName: string;
  meta: Record<string, string> | null;
}

/**
 * Resolves a human source reference ("github:acme/repo", "https://…",
 * "local:./path") into a canonical source key + fetcher. Used by the
 * `source` command and security tooling.
 */
export async function resolveSourceRef(ref: string, cwd: string): Promise<ResolvedSource> {
  const trimmed = ref.trim();
  if (trimmed.startsWith("github:") || trimmed.startsWith("git:")) {
    const rest = trimmed.replace(/^(github|git):/, "");
    return { sourceKey: `github:${rest}`, fetcherName: "git", meta: { owner: rest.split("/")[0] ?? "", repo: rest.split("/")[1] ?? "" } };
  }
  if (/^https?:\/\//.test(trimmed)) {
    return { sourceKey: trimmed, fetcherName: "url", meta: null };
  }
  if (trimmed.startsWith("local:") || trimmed.startsWith("file:")) {
    const path = trimmed.replace(/^(local|file):/, "");
    return { sourceKey: `local:${path}`, fetcherName: "local", meta: { path: path.startsWith("/") || path.startsWith(".") ? path : `${cwd}/${path}` } };
  }
  // bare path
  if (trimmed.includes("/") && !trimmed.includes(" ")) {
    return { sourceKey: `local:${trimmed}`, fetcherName: "local", meta: { path: trimmed.startsWith("/") || trimmed.startsWith(".") ? trimmed : `${cwd}/${trimmed}` } };
  }
  return { sourceKey: trimmed, fetcherName: "unknown", meta: null };
}

export async function resolveCapability(storage: Storage, ref: string): Promise<Capability> {
  const all = await storage.allCapabilities();
  const exact = all.find((c) => c.id === ref);
  if (exact) return exact;
  const fuzzy = fuzzyIdMatch(ref, all);
  if (fuzzy) return fuzzy;
  throw new NotFoundError(`Capability "${ref}" not found in the registry.`);
}

export async function capabilityOrNull(storage: Storage, ref: string): Promise<Capability | null> {
  const all = await storage.allCapabilities();
  return fuzzyIdMatch(ref, all);
}

export function describeCompatibility(capability: Capability): string {
  const entries = Object.entries(capability.compatibility ?? {});
  if (entries.length === 0) return "universal";
  return entries.map(([agent, level]) => `${agent}:${level}`).join(", ");
}