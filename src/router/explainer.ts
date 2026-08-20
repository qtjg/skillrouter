import type { RouterDecision, CapabilityScore, PlanAction } from "./types.ts";
import { describeAnalysis } from "./analyzer.ts";
import { riskLevelBadge } from "../security/risk.ts";

export interface ExplainOutput {
  task: string;
  analysis: string[];
  classification: import("../classification/types.ts").MatchClass;
  confidence: { value: number; label: string };
  activations: Array<{ id: string; score: number; confidence: string; signals: string[]; permissions: string[]; risk: string }>;
  rejections: Array<{ id: string; score: number; reasons: string[] }>;
  deactivations: Array<{ id: string; score: number; signals: string[] }>;
  kept: Array<{ id: string; score: number }>;
  context: { estimate: number; budget: number; percent: number };
  latencyMs: number;
  mode: string;
  semanticUsed: boolean;
  llmUsed: boolean;
}

export function explainDecision(decision: RouterDecision): ExplainOutput {
  const analysis = describeAnalysis(decision.analysis);
  const activations = decision.plan
    .filter((p) => p.action === "activate")
    .map((p) => explainAction(p, decision));
  const deactivations = decision.plan
    .filter((p) => p.action === "deactivate")
    .map((p) => ({ id: p.capabilityId, score: p.score, signals: p.reasons.map((r) => r.text).slice(0, 4) }));
  const kept = decision.plan.filter((p) => p.action === "keep").map((p) => ({ id: p.capabilityId, score: p.score }));

  // Rejected candidates with their dominant rejection reasons (PRD §12/§17).
  const notSelected = new Set(decision.plan.filter((p) => p.action === "keep-inactive" || p.action === "deactivate").map((p) => p.capabilityId));
  const rejections = decision.scores
    .filter((s) => notSelected.has(s.capability.id))
    .map((s) => ({
      id: s.capability.id,
      score: s.score,
      reasons: rejectionReasons(s),
    }))
    .filter((r) => r.reasons.length > 0)
    .slice(0, 5);

  return {
    task: decision.task,
    analysis,
    classification: decision.classification,
    confidence: decision.confidence,
    activations,
    rejections,
    deactivations,
    kept,
    context: {
      estimate: decision.contextEstimate,
      budget: decision.contextBudget,
      percent: decision.contextBudget > 0 ? Math.round((decision.contextEstimate / decision.contextBudget) * 100) : 0,
    },
    latencyMs: decision.latencyMs,
    mode: decision.mode,
    semanticUsed: decision.semanticUsed,
    llmUsed: decision.llmUsed,
  };
}

/** Picks the strongest explanation for a candidate being rejected (PRD §12). */
export function rejectionReasons(score: CapabilityScore): string[] {
  const reasons: string[] = [];
  const negative = score.signals.filter((s) => s.type === "negativeSignal");
  if (negative.length > 0) reasons.push(negative.map((s) => s.text.replace(/^explicit /, "")).join("; "));
  const neighbor = score.signals.find((s) => s.type === "neighbor");
  if (neighbor) reasons.push(neighbor.text);
  if (score.breakdown.trust < 0) reasons.push("untrusted publisher");
  if (score.breakdown.permissionCost < 0) reasons.push(`risk ${score.riskLevel} / high permissions`);
  if (score.breakdown.compatibility < 0) reasons.push(`unsupported for the target agent (${score.compatibility})`);
  if (score.score <= 0) reasons.push("no positive evidence");
  return reasons.slice(0, 3);
}

function explainAction(action: PlanAction, decision: RouterDecision): ExplainOutput["activations"][number] {
  const score = decision.scores.find((s) => s.capability.id === action.capabilityId);
  const signals = action.reasons.map((r) => r.text).slice(0, 7);
  if (score) {
    const conflictNote = score.conflictWith ? `(conflicts resolved against ${score.conflictWith})` : "";
    if (score.breakdown.trust < 0) signals.push(`unverified publisher${conflictNote}`);
  }
  return {
    id: action.capabilityId,
    score: action.score,
    confidence: action.confidence,
    signals,
    permissions: action.permissions,
    risk: score ? riskLevelBadge(score.riskLevel) : "unknown",
  };
}

export function findCapabilityScore(decision: RouterDecision, id: string): CapabilityScore | undefined {
  return decision.scores.find((s) => s.capability.id === id);
}

export function summarizeScores(decision: RouterDecision, top = 10): Array<{ id: string; score: number; risk: string; compat: string }> {
  return decision.scores.slice(0, top).map((s) => ({
    id: s.capability.id,
    score: s.score,
    risk: riskLevelBadge(s.riskLevel),
    compat: s.compatibility,
  }));
}