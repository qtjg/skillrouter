import type { Capability } from "../core/types.ts";

/**
 * Hard constraints eliminate candidates before scoring; soft preferences only
 * affect scores (PRD §Phase E).
 */
export interface RouteConstraints {
  /** `forbidden` rejects any candidate with network access; `allowed` enforces nothing. */
  network?: "allowed" | "forbidden";
  /** Maximum declared cost rating (metadata.cost, 1–5). */
  maxCost?: number;
  /** Maximum declared latency rating (metadata.latency, 1–5). */
  maxLatency?: number;
  /** Maximum declared latency in milliseconds (metadata.latencyMs). */
  maxLatencyMs?: number;
  /** Allowed permission boundary; candidates requiring anything outside are rejected. */
  permissions?: string[];
  /** Capability ids that must be present in the final set (planned in later phases). */
  requiredCapabilities?: string[];
  requiredFramework?: string[];
  requiredLanguage?: string[];
}

export const PERMISSION_KINDS = [
  "filesystem.read",
  "filesystem.write",
  "network.read",
  "network.write",
  "process.execute",
  "shell.execute",
  "git.read",
  "git.write",
  "environment.read",
  "credentials",
  "hooks",
  "mcp",
] as const;

export type PermissionKind = (typeof PERMISSION_KINDS)[number];

/** Canonical permission kinds a capability requires, derived from its permission set. */
export function permissionKinds(capability: Capability): PermissionKind[] {
  const p = capability.permissions ?? {};
  const kinds = new Set<PermissionKind>();
  if (p.filesystem?.read) kinds.add("filesystem.read");
  if (p.filesystem?.write) kinds.add("filesystem.write");
  const networkAllowed = p.network?.allowed?.length ?? 0;
  if (networkAllowed > 0) {
    kinds.add("network.read");
    kinds.add("network.write");
  }
  if (p.processes?.enabled) kinds.add("process.execute");
  if (p.shell?.enabled) kinds.add("shell.execute");
  if (p.environment?.read) kinds.add("environment.read");
  if (p.credentials?.access !== "none" && p.credentials !== undefined) kinds.add("credentials");
  if (p.hooks?.enabled) kinds.add("hooks");
  if (p.mcp?.servers && p.mcp.servers.length > 0) kinds.add("mcp");
  if (capability.metadata?.gitWrites) kinds.add("git.write");
  return [...kinds];
}

export interface ConstraintResult {
  allowed: boolean;
  /** Human-readable reasons; empty when allowed. */
  reasons: string[];
  /** Constraint names that eliminated the candidate. */
  eliminatedBy: string[];
}

/** Hard constraint evaluation: any violation rejects the candidate. */
export function evaluateConstraints(capability: Capability, constraints?: RouteConstraints): ConstraintResult {
  if (!constraints) return { allowed: true, reasons: [], eliminatedBy: [] };
  const reasons: string[] = [];
  const eliminatedBy: string[] = [];

  const metadata = capability.metadata ?? {};

  if (constraints.network === "forbidden" && permissionKinds(capability).some((k) => k === "network.read" || k === "network.write")) {
    reasons.push(`capability requires network access but network is forbidden`);
    eliminatedBy.push("network");
  }

  if (constraints.maxCost !== undefined && metadata.cost !== undefined && metadata.cost > constraints.maxCost) {
    reasons.push(`declared cost ${metadata.cost} exceeds maxCost ${constraints.maxCost}`);
    eliminatedBy.push("maxCost");
  }

  if (constraints.maxLatency !== undefined && metadata.latency !== undefined && metadata.latency > constraints.maxLatency) {
    reasons.push(`declared latency ${metadata.latency} exceeds maxLatency ${constraints.maxLatency}`);
    eliminatedBy.push("maxLatency");
  }

  if (constraints.maxLatencyMs !== undefined && metadata.latencyMs !== undefined && metadata.latencyMs > constraints.maxLatencyMs) {
    reasons.push(`declared latency ${metadata.latencyMs}ms exceeds maxLatencyMs ${constraints.maxLatencyMs}ms`);
    eliminatedBy.push("maxLatencyMs");
  }

  if (constraints.permissions && constraints.permissions.length > 0) {
    const boundary = new Set(constraints.permissions);
    const beyond = permissionKinds(capability).filter((k) => !boundary.has(k));
    if (beyond.length > 0) {
      reasons.push(`requires permission(s) outside the boundary: ${beyond.join(", ")}`);
      eliminatedBy.push("permissions");
    }
  }

  if (constraints.requiredLanguage && constraints.requiredLanguage.length > 0) {
    const projectLanguages = capability.requirements?.language ?? [];
    const missing = constraints.requiredLanguage.filter((l) => !projectLanguages.includes(l.toLowerCase()));
    if (missing.length > 0) {
      reasons.push(`does not support required language(s): ${missing.join(", ")}`);
      eliminatedBy.push("requiredLanguage");
    }
  }

  if (constraints.requiredFramework && constraints.requiredFramework.length > 0) {
    const frameworks = capability.requirements?.framework ?? [];
    const missing = constraints.requiredFramework.filter((f) => !frameworks.includes(f.toLowerCase()));
    if (missing.length > 0) {
      reasons.push(`does not support required framework(s): ${missing.join(", ")}`);
      eliminatedBy.push("requiredFramework");
    }
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    eliminatedBy,
  };
}

/** Soft preference delta (points, capability score space) for a candidate. */
export function softPreferenceDelta(capability: Capability, constraints?: RouteConstraints): number {
  if (!constraints) return 0;
  let delta = 0;
  const reqs = capability.requirements;
  const languages = reqs?.language ?? [];
  const frameworks = reqs?.framework ?? [];
  for (const lang of constraints.requiredLanguage ?? []) {
    if (languages.includes(lang.toLowerCase())) delta += 6;
  }
  for (const framework of constraints.requiredFramework ?? []) {
    if (frameworks.includes(framework.toLowerCase())) delta += 6;
  }
  return delta;
}

/** A capability's declared requirements (context-aware matching, PRD §Phase D). */
export interface CapabilityRequirements {
  language?: string[];
  framework?: string[];
  runtime?: string[];
  network?: boolean;
}