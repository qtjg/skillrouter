import type { CapabilityScore, Signal } from "../router/types.ts";
import type { Weights } from "../router/factors.ts";

/**
 * Machine-readable 0–1 score breakdown derived from the actual scoring signals
 * (PRD §Phase F). Each dimension is an independently normalized signal group —
 * they describe *why* a score landed where it did, not additive components.
 *
 * Group membership maps signals to PRD dimensions:
 * - capability: keyword / technology / taskSimilarity / project / git / file /
 *   dependency / compatibility / trust / quality / preference / neighbor
 * - context: context (language/framework/runtime match)
 * - intent: taskSimilarity signals tagged with the intent category
 * - historical: historical
 * - strategy: cost / latency / contextCost (penalty magnitude under the strategy)
 * - exploration: exploration (added in Phase G)
 * - riskPenalty: permissionCost magnitude
 */
export interface ScoreBreakdown {
  total: number;
  capability: number;
  context: number;
  intent: number;
  historical: number;
  strategy: number;
  exploration: number;
  riskPenalty: number;
}

const GROUP_CAPS: Record<string, number> = {
  capability: 120,
  context: 30,
  intent: 16,
  historical: 10,
  strategy: 30,
  exploration: 10,
  riskPenalty: 30,
};

const GROUP_TYPES: Record<string, string[]> = {
  capability: ["keyword", "technology", "taskSimilarity", "project", "git", "file", "dependency", "compatibility", "trust", "quality", "preference", "neighbor"],
  context: ["context"],
  intent: ["intent"],
  historical: ["historical"],
  strategy: ["cost", "latency", "contextCost"],
  exploration: ["exploration"],
  riskPenalty: ["permissionCost", "negativeSignal"],
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Builds the normalized breakdown from a scored candidate. */
export function scoreBreakdown(score: CapabilityScore, weights: Weights): ScoreBreakdown {
  const signalWeight = (types: string[]): number => {
    let sum = 0;
    for (const signal of score.signals) {
      if (types.includes(signal.type)) sum += signal.weight;
    }
    return sum;
  };

  const grouped = new Map<string, number>();
  for (const [dimension, types] of Object.entries(GROUP_TYPES)) {
    grouped.set(dimension, signalWeight(types));
  }

  const total = clamp01(score.score / 100);

  const dimension = (name: string): number => {
    const value = grouped.get(name) ?? 0;
    const cap = GROUP_CAPS[name]!;
    return Math.round(clamp01(value / cap) * 1000) / 1000;
  };

  return {
    total,
    capability: dimension("capability"),
    context: dimension("context"),
    intent: dimension("intent"),
    historical: dimension("historical"),
    strategy: dimension("strategy"),
    exploration: dimension("exploration"),
    riskPenalty: dimension("riskPenalty"),
  };
}

/** Maps a signal to its PRD dimension for the intent grouping. */
export function signalDimensions(signals: Signal[]): Record<string, number> {
  const dims: Record<string, number> = {};
  for (const signal of signals) {
    if (signal.type === "taskSimilarity" && /intent/.test(signal.text)) {
      dims.intent = (dims.intent ?? 0) + signal.weight;
    }
  }
  return dims;
}