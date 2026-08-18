import type { Storage } from "../storage/types.ts";

export interface PermissionOverride {
  capabilityId: string;
  permissions: string[];
}

const PERMS_KEY = "permissions.overrides";

/** Human-readable permission descriptors, e.g. "fs:write", "net:http", "shell:exec". */
export function describeCapabilityPermissions(permissions: import("../core/types.ts").PermissionSet | undefined): string[] {
  if (!permissions) return [];
  const out: string[] = [];
  if (permissions.filesystem?.read) out.push("fs:read");
  if (permissions.filesystem?.write) out.push("fs:write");
  if (permissions.filesystem?.paths?.length) out.push(...permissions.filesystem.paths.map((p) => `fs:path:${p}`));
  if (permissions.network?.allowed?.length) out.push(...permissions.network.allowed.map((p) => `net:${p}`));
  if (permissions.shell?.enabled) out.push("shell:exec");
  if (permissions.processes?.enabled) out.push("process:spawn");
  if (permissions.credentials && permissions.credentials.access !== "none") out.push("env-secrets");
  if (permissions.mcp?.servers?.length) out.push(...permissions.mcp.servers.map((s) => `mcp:${s}`));
  return out;
}

export async function updatePermissions(storage: Storage, capabilityId: string, permissions: string[]): Promise<void> {
  const existing = await storage.getPreference(PERMS_KEY);
  const table: Record<string, string[]> = existing ? JSON.parse(existing) : {};
  table[capabilityId] = permissions;
  await storage.setPreference(PERMS_KEY, JSON.stringify(table));
}

export async function permissionOverrides(storage: Storage): Promise<Map<string, string[]>> {
  const raw = await storage.getPreference(PERMS_KEY);
  const out = new Map<string, string[]>();
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    for (const [key, value] of Object.entries(parsed)) out.set(key, value);
  } catch {
    // corrupt preference; ignore
  }
  return out;
}

const TRUST_KEY = "sources.trusted";

export async function trustedSources(storage: Storage): Promise<string[]> {
  const raw = await storage.getPreference(TRUST_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function addTrustedSource(storage: Storage, source: string): Promise<void> {
  const current = await trustedSources(storage);
  if (!current.includes(source)) {
    current.push(source);
    await storage.setPreference(TRUST_KEY, JSON.stringify(current));
  }
}

export async function removeTrustedSource(storage: Storage, source: string): Promise<void> {
  const current = (await trustedSources(storage)).filter((s) => s !== source);
  await storage.setPreference(TRUST_KEY, JSON.stringify(current));
}

export async function isSourceTrusted(storage: Storage, source: string): Promise<boolean> {
  return (await trustedSources(storage)).includes(source);
}