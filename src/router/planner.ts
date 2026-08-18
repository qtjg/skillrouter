import type { PlanAction, RouterDecision, CapabilityScore, RouteContext, TaskAnalysis } from "./types.ts";
import type { CapabilityState } from "../core/types.ts";
import { resolveConflicts } from "./conflicts.ts";

export interface PlannerOptions {
  threshold: number;
  maxActivations: number;
  always: string[];
  never: string[];
  prefer: string[];
  avoid: string[];
  dryRun: boolean;
  mode: string;
  contextBudget: number;
}

export interface PlannerInput {
  task: TaskAnalysis;
  scores: CapabilityScore[];
  installedStates: Map<string, { state: CapabilityState; installed: boolean }>;
  options: PlannerOptions;
}

function describePermissionRequirements(capability: CapabilityScore): string[] {
  const reqs: string[] = [];
  const p = capability.capability.permissions;
  if (p?.filesystem?.read) reqs.push("filesystem read");
  if (p?.filesystem?.write) reqs.push("filesystem write");
  if (p?.network?.allowed && p.network.allowed.length > 0) reqs.push(p.network.allowed.includes("*") ? "network (unrestricted)" : `network (${p.network.allowed.join(", ")})`);
  if (p?.shell?.enabled) reqs.push("shell execution");
  if (p?.environment?.read) reqs.push("environment access");
  if (p?.credentials && p.credentials.access !== "none") reqs.push("credentials access");
  if (p?.hooks?.enabled) reqs.push("hooks");
  if (p?.mcp?.servers && p.mcp.servers.length > 0) reqs.push("MCP servers");
  return reqs;
}

function confidenceFor(score: number): "high" | "medium" | "low" {
  if (score >= 70) return "high";
  if (score >= 50) return "medium";
  return "low";
}

export function buildPlan(input: PlannerInput): PlanAction[] {
  const sorted = [...input.scores].sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id));
  const actions: PlanAction[] = [];
  const selected: CapabilityScore[] = [];

  const excludedIds = new Set<string>(input.options.never);
  const forcedIds = new Set<string>(input.options.always);
  const avoided = new Set(input.options.avoid);

  for (const score of sorted) {
    if (excludedIds.has(score.capability.id)) continue;
    if (avoided.has(score.capability.id) && !forcedIds.has(score.capability.id)) continue;
    if (score.score < input.options.threshold && !forcedIds.has(score.capability.id)) continue;
    selected.push(score);
  }

  for (const score of sorted) {
    if (forcedIds.has(score.capability.id) && !selected.includes(score)) selected.push(score);
  }

  selected.sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id));
  const activated = selected.slice(0, Math.max(0, input.options.maxActivations));

  const compareList = input.options.prefer;
  if (compareList.length > 0) {
    activated.sort((a, b) => {
      const ap = compareList.includes(a.capability.id) ? 1 : 0;
      const bp = compareList.includes(b.capability.id) ? 1 : 0;
      return bp - ap;
    });
  }

  const activatedIds = new Set(activated.map((s) => s.capability.id));

  for (const score of sorted) {
    const id = score.capability.id;
    if (excludedIds.has(id)) continue;
    const installed = input.installedStates.get(id);
    const isActive = installed?.state === "ACTIVE" || installed?.state === "CANDIDATE";
    const willActivate = activatedIds.has(id);

    if (willActivate && isActive) {
      actions.push(actionFor(score, "keep", `remains active (score ${score.score}/100)`));
    } else if (willActivate && !isActive) {
      actions.push({ ...actionFor(score, "activate", `recommended (score ${score.score}/100)`), state: installed?.state ?? "DISCOVERED" });
    } else if (!willActivate && isActive) {
      actions.push({
        ...actionFor(score, "deactivate", `no longer relevant (score ${score.score}/100 below threshold ${input.options.threshold})`),
        state: "ENABLED",
      });
    } else if (!willActivate && avoided.has(id)) {
      actions.push({ ...actionFor(score, "keep-inactive", `explicitly avoided by configuration`), state: installed?.state ?? "DISCOVERED" });
    } else {
      actions.push({ ...actionFor(score, "keep-inactive", `not selected (score ${score.score}/100)`), state: installed?.state ?? "DISCOVERED" });
    }
  }

  return actions.sort((a, b) => {
    const order = { activate: 0, keep: 1, deactivate: 2, suspend: 3, "keep-inactive": 4 } as const;
    return order[a.action] - order[b.action] || b.score - a.score;
  });
}

function actionFor(score: CapabilityScore, action: PlanAction["action"], reason: string): PlanAction {
  return {
    capabilityId: score.capability.id,
    action,
    score: score.score,
    confidence: confidenceFor(score.score),
    reasons: score.signals,
    permissions: describePermissionRequirements(score),
    state: "DISCOVERED",
  };
}

export function createDecision(
  task: string,
  analysis: TaskAnalysis,
  ctx: RouteContext,
  scores: CapabilityScore[],
  plan: PlanAction[],
  options: PlannerOptions,
  extras: { semanticUsed: boolean; llmUsed: boolean },
): RouterDecision {
  let contextEstimate = 0;
  for (const action of plan) {
    if (action.action === "activate" || action.action === "keep") {
      const capability = scores.find((s) => s.capability.id === action.capabilityId)?.capability;
      contextEstimate += capability?.context?.estimatedTokens ?? 0;
    }
  }
  return {
    decisionId: randomId(),
    task,
    mode: options.mode,
    analysis,
    scores: scoresSort(scores),
    plan,
    latencyMs: 0,
    contextEstimate,
    contextBudget: options.contextBudget,
    semanticUsed: extras.semanticUsed,
    llmUsed: extras.llmUsed,
    createdAt: new Date().toISOString(),
  };
}

function scoresSort(scores: CapabilityScore[]): CapabilityScore[] {
  return [...scores].sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id));
}

export function resolveConflictsForPlan(scores: CapabilityScore[]): CapabilityScore[] {
  return resolveConflicts(scores);
}

export function randomId(): string {
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultPlannerOptions(partial: Partial<PlannerOptions> = {}): PlannerOptions {
  return {
    threshold: 40,
    maxActivations: 5,
    always: [],
    never: [],
    prefer: [],
    avoid: [],
    dryRun: false,
    mode: "assisted",
    contextBudget: 12000,
    ...partial,
  };
}