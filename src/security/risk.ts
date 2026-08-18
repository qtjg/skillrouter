import type { Capability, PermissionSet, RiskLevel } from "../core/types.ts";
import { RISK_LEVELS } from "../core/types.ts";

export interface RiskComputation {
  score: number;
  level: RiskLevel;
  breakdown: Array<{ permission: string; points: number; detail: string }>;
  reasons: string[];
}

const DOMAIN_LEVEL: Record<RiskLevel, number> = { low: 0, medium: 30, high: 55, critical: 80 };

export function computeRisk(capability: Capability): RiskComputation {
  const breakdown: RiskComputation["breakdown"] = [];
  const reasons: string[] = [];
  const p: PermissionSet | undefined = capability.permissions;

  let score = 0;
  const add = (permission: string, points: number, detail: string) => {
    if (points === 0) return;
    score += points;
    breakdown.push({ permission, points, detail });
  };

  if (p?.filesystem) {
    if (p.filesystem.read) {
      add("filesystem.read", 10, "Can read project files");
      reasons.push("Reads project files");
    }
    if (p.filesystem.write) {
      add("filesystem.write", 20, "Can modify project files");
      reasons.push("Can modify files");
    }
    if ((p.filesystem.paths ?? []).length > 0) {
      add("filesystem.paths", 5, `Scoped to ${(p.filesystem.paths ?? []).length} path(s)`);
    }
  }

  if (p?.network) {
    const allowed = p.network.allowed ?? [];
    if (allowed.length > 0 && !allowed.includes("*")) {
      add("network.scoped", 10, `Network access to ${allowed.length} domain(s)`);
      reasons.push("Network access (scoped)");
    }
    if (allowed.includes("*")) {
      add("network.wildcard", 35, "Unrestricted network access");
      reasons.push("Unrestricted network access");
    }
  }

  if (p?.shell?.enabled) {
    add("shell", 30, "Can execute shell commands");
    reasons.push("Shell execution enabled");
    if ((p.shell.allow ?? []).length > 0) add("shell.allowlist", -15, "Shell commands restricted to an allowlist");
    if ((p.shell.deny ?? []).length > 0) add("shell.denylist", 5, "Shell commands restricted by denylist");
  }

  if (p?.environment?.read) {
    add("environment.read", 10, "Can read environment variables");
    reasons.push("Reads environment variables");
    const sensitive = (p.environment.variables ?? []).filter((v) => /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE/i.test(v));
    if (sensitive.length > 0) {
      add("environment.sensitive", 10, `Requests sensitive variables: ${sensitive.join(", ")}`);
      reasons.push("Requests sensitive environment variables");
    }
  }

  if (p?.credentials) {
    if (p.credentials.access === "explicit") {
      add("credentials.explicit", 15, "Requires explicit credential access");
      reasons.push("Requires credential access");
    }
    if (p.credentials.access === "requested") {
      add("credentials.requested", 20, "Requests credential access at runtime");
      reasons.push("Requests credential access at runtime");
    }
  }

  if (p?.hooks?.enabled) {
    add("hooks", 20, "Registers execution hooks");
    reasons.push("Hooks enabled");
  }

  if (p?.mcp?.servers && p.mcp.servers.length > 0) {
    add("mcp.servers", 10, `Connects to ${p.mcp.servers.length} MCP server(s)`);
    reasons.push("MCP server connections");
  }

  if (p?.processes?.enabled) {
    add("processes", 25, "Can spawn processes");
    reasons.push("Process execution enabled");
  }

  const declaredFloor = capability.risk?.declared ? DOMAIN_LEVEL[capability.risk.declared] : 0;
  let finalScore = Math.max(score, declaredFloor);
  if (finalScore > 100) finalScore = 100;

  let level: RiskLevel = "low";
  for (const l of RISK_LEVELS) {
    if (finalScore >= DOMAIN_LEVEL[l]) level = l;
  }

  if (declaredFloor > score) {
    reasons.push(`Manifest declared risk level "${capability.risk?.declared}" (score floor ${declaredFloor})`);
  }

  return { score: finalScore, level, breakdown, reasons };
}

export function riskLevelBadge(level: RiskLevel): string {
  switch (level) {
    case "low":
      return "LOW";
    case "medium":
      return "MEDIUM";
    case "high":
      return "HIGH";
    case "critical":
      return "CRITICAL";
  }
}

export const RISK_FLOOR: Record<RiskLevel, number> = DOMAIN_LEVEL;