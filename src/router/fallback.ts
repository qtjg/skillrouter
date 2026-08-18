import type { Capability } from "../core/types.ts";
import type { CapabilityScore as RouterScore } from "./types.ts";

/**
 * Ordered, deduplicated fallback chain for a capability id.
 * Built from every capability's declared `fallbacks` metadata.
 */
export type FallbackChains = Map<string, string[]>;

export function resolveFallbackChains(capabilities: Capability[]): FallbackChains {
  const chains = new Map<string, string[]>();
  for (const capability of capabilities) {
    const raw = capability.fallbacks ?? [];
    const chain: string[] = [];
    for (const id of raw) {
      if (id === capability.id) continue;
      if (!chain.includes(id)) chain.push(id);
    }
    if (chain.length > 0) chains.set(capability.id, chain);
  }
  return chains;
}

export interface FallbackSelection {
  /** The capability id to fall back to. */
  id: string;
  /** How many chain steps were walked before the choice (0 = first declared fallback). */
  steps: number;
}

export interface FallbackOptions {
  /** Capability ids already attempted (loop prevention across chains). */
  attempted?: Set<string>;
  /** Hard cap on chain steps walked in a single selection (default 20). */
  maxSteps?: number;
  /**
   * Availability filter. Called with the candidate id and its score when
   * scores were provided (null otherwise); returning true skips it.
   * Used to exclude conflicting, blocked or below-threshold candidates.
   */
  unavailable?: (id: string, score: RouterScore | null) => boolean;
}

/**
 * Walk a capability's declared fallback chain in order and return the first
 * usable member. `scores` are the conflict-resolved candidate rankings when
 * available; without them selection is purely chain-ordered. Cycles are
 * impossible to loop on: `attempted` blocks revisits and `maxSteps` bounds
 * the walk (PRD §21 — prevent infinite retry loops).
 */
export function selectFallback(
  failedId: string,
  chains: FallbackChains,
  scores: RouterScore[],
  options: FallbackOptions = {},
): FallbackSelection | null {
  const chain = chains.get(failedId);
  if (!chain || chain.length === 0) return null;

  const attempted = options.attempted ?? new Set<string>();
  const maxSteps = options.maxSteps ?? Math.min(20, chain.length * 3);
  const byId = new Map(scores.map((s) => [s.capability.id, s]));

  let steps = 0;
  for (const id of chain) {
    steps += 1;
    if (steps > maxSteps) break;
    if (attempted.has(id) || id === failedId) continue;
    const score = byId.get(id) ?? null;
    if (scores.length > 0 && score === null) continue; // unknown / not a candidate
    if (options.unavailable && options.unavailable(id, score)) continue;
    return { id, steps: steps - 1 };
  }
  return null;
}

/** Fallback availability notes for a capability (for explanations). */
export function fallbackSummary(chains: FallbackChains, id: string): string[] {
  const chain = chains.get(id);
  if (!chain || chain.length === 0) return [];
  return chain.map((target) => `fallback: ${target}`).slice(0, 5);
}