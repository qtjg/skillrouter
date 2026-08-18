export type Decision = "allow" | "ask" | "deny";

export type PermissionKind = "filesystem.read" | "filesystem.write" | "network" | "shell" | "environment" | "credentials" | "hooks" | "processes" | "mcp";

export interface PermissionRequest {
  kind: PermissionKind;
  target?: string;
  capability: string;
  riskLevel: string;
}

export interface PolicyContext {
  configPolicy: Record<string, unknown>;
  requireConsent: boolean;
  interactive: boolean;
  blocked: string[];
}

interface RuleSet {
  allow: string[];
  deny: string[];
  defaultAction?: Decision;
}

function asRuleSet(raw: unknown): RuleSet {
  if (!raw || typeof raw !== "object") return { allow: [], deny: [] };
  const r = raw as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const def = r["default"] ?? r["defaultAction"];
  return {
    allow: list(r["allow"]),
    deny: list(r["deny"]),
    defaultAction: def === "allow" || def === "ask" || def === "deny" ? def : undefined,
  };
}

function matchesAny(target: string | undefined, list: string[]): boolean {
  if (target === undefined) return false;
  return list.some((rule) => {
    if (rule === "*") return true;
    if (rule.startsWith("*.")) {
      return target === rule.slice(2) || target.endsWith("." + rule.slice(2));
    }
    return rule === target || target.endsWith("/" + rule);
  });
}

export function resolvePolicy(request: PermissionRequest, ctx: PolicyContext): Decision {
  if (ctx.blocked.includes(request.capability)) return "deny";

  const raw = ctx.configPolicy;
  const rules: Record<PermissionKind, RuleSet> = {
    "filesystem.read": asRuleSet(raw["filesystem"] ? (raw["filesystem"] as Record<string, unknown>)["read"] : undefined),
    "filesystem.write": asRuleSet(raw["filesystem"] ? (raw["filesystem"] as Record<string, unknown>)["write"] : undefined),
    network: asRuleSet(raw["network"]),
    shell: asRuleSet(raw["shell"]),
    environment: asRuleSet(raw["environment"]),
    credentials: asRuleSet(raw["credentials"]),
    hooks: asRuleSet(raw["hooks"]),
    processes: asRuleSet(raw["processes"]),
    mcp: asRuleSet(raw["mcp"]),
  };

  const rule = rules[request.kind];
  if (matchesAny(request.target, rule.deny)) return "deny";
  if (matchesAny(request.target, rule.allow)) return "allow";

  const riskAuto = request.riskLevel === "low" || request.riskLevel === "medium";

  if (request.kind === "credentials") return riskAuto ? "ask" : "ask";
  if (request.kind === "shell" || request.kind === "processes") return riskAuto ? "allow" : "ask";
  if (request.kind === "network" && request.target === "*") return "ask";
  if (request.riskLevel === "high" || request.riskLevel === "critical") return ctx.requireConsent ? "ask" : "allow";

  if (rule.defaultAction) return rule.defaultAction;
  return "allow";
}

export function describeDecision(decision: Decision, request: PermissionRequest): string {
  switch (decision) {
    case "allow":
      return `Allowed: ${request.capability} may ${request.kind}${request.target ? ` (${request.target})` : ""}`;
    case "deny":
      return `Denied: ${request.capability} may not ${request.kind}${request.target ? ` (${request.target})` : ""}`;
    case "ask":
      return `Consent required: ${request.capability} wants ${request.kind}${request.target ? ` (${request.target})` : ""}`;
  }
}