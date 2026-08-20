import type { Capability } from "../core/types.ts";
import { textTokens } from "../quality/analyzer.ts";

/**
 * Neighbor analysis and distinctiveness (PRD §4.4, §6.4).
 *
 * Capabilities that cover the same area (near-neighbors) compete for the same
 * tasks. `similarityBetween` is a deterministic field-weighted overlay score
 * (0 = unrelated, 1 = duplicate); `distinctiveness` is 1 − best neighbor
 * similarity, so a capability that is the only one in its area stays at 1.
 */

export interface NeighborResult {
  id: string;
  similarity: number;
  fields: string[];
  shared: string[];
}

export interface NeighborAnalysis {
  /** 1 − max neighbor similarity; 1 when the pool has no closer alternative. */
  distinctiveness: number;
  best: NeighborResult | null;
  neighbors: NeighborResult[];
}

function tokenOverlap(a: Set<string>, b: Set<string>): { jaccard: number; shared: string[] } {
  if (a.size === 0 || b.size === 0) return { jaccard: 0, shared: [] };
  let shared = 0;
  const both: string[] = [];
  for (const token of a) {
    if (b.has(token)) {
      shared++;
      both.push(token);
    }
  }
  return { jaccard: shared / Math.max(1, a.size + b.size - shared), shared: both.slice(0, 6) };
}

/** Field-weighted overlay between two capabilities; symmetric and deterministic. */
export function similarityBetween(a: Capability, b: Capability): NeighborResult {
  const contributions: Array<{ weight: number; score: number; field: string; shared: string[] }> = [];

  if (a.id === b.id) return { id: b.id, similarity: 1, fields: ["id"], shared: [b.id] };
  if (a.name === b.name) return { id: b.id, similarity: 1, fields: ["name"], shared: [b.name] };

  const nameA = textTokens(a.name);
  const nameB = textTokens(b.name);
  const name = tokenOverlap(nameA, nameB);
  if (name.jaccard > 0) contributions.push({ weight: 0.35, score: name.jaccard, field: "name", shared: name.shared });

  const idA = new Set(a.id.toLowerCase().split(/[-.]/).filter((t) => t.length > 0));
  const idB = new Set(b.id.toLowerCase().split(/[-.]/).filter((t) => t.length > 0));
  if (idA.size > 0 && idB.size > 0) {
    const contained = [...idA].every((t) => idB.has(t)) || [...idB].every((t) => idA.has(t));
    if (contained) {
      contributions.push({ weight: 1, score: 1, field: "id", shared: [a.id, b.id] });
    } else {
      const id = tokenOverlap(idA, idB);
      if (id.jaccard > 0) contributions.push({ weight: 0.9, score: id.jaccard, field: "id", shared: id.shared });
    }
  }

  const kwA = new Set((a.triggers?.keywords ?? []).map((k) => k.toLowerCase()));
  const kwB = new Set((b.triggers?.keywords ?? []).map((k) => k.toLowerCase()));
  if (kwA.size > 0 && kwB.size > 0) {
    const kw = tokenOverlap(kwA, kwB);
    if (kw.jaccard > 0) contributions.push({ weight: 0.4, score: kw.jaccard, field: "triggers", shared: kw.shared });
  }

  const techA = new Set((a.triggers?.technologies ?? []).map((t) => t.toLowerCase()));
  const techB = new Set((b.triggers?.technologies ?? []).map((t) => t.toLowerCase()));
  if (techA.size > 0 && techB.size > 0) {
    const tech = tokenOverlap(techA, techB);
    if (tech.jaccard > 0) contributions.push({ weight: 0.3, score: tech.jaccard, field: "technologies", shared: tech.shared });
  }

  const intentA = new Set((a.triggers?.intents ?? []).map((i) => i.toLowerCase()));
  const intentB = new Set((b.triggers?.intents ?? []).map((i) => i.toLowerCase()));
  if (intentA.size > 0 && intentB.size > 0) {
    const intent = tokenOverlap(intentA, intentB);
    if (intent.jaccard > 0) contributions.push({ weight: 0.35, score: intent.jaccard, field: "intents", shared: intent.shared });
  }

  const descA = textTokens(a.description);
  const descB = textTokens(b.description);
  if (descA.size > 0 && descB.size > 0) {
    const desc = tokenOverlap(descA, descB);
    if (desc.jaccard > 0.1) contributions.push({ weight: 0.2, score: desc.jaccard, field: "description", shared: desc.shared });
  }

  // Overlay = max over weighted field contributions; fields that overlap on
  // several dimensions raise the score by a fixed partnership bonus.
  const best = contributions.reduce((m, c) => (c.weight * c.score > m.weight * m.score ? c : m), { weight: 0, score: 0, field: "", shared: [] as string[] });
  if (best.weight === 0) return { id: b.id, similarity: 0, fields: [], shared: [] };
  let similarity = best.weight * best.score;
  if (contributions.length > 1) similarity = Math.min(1, similarity + 0.12 * (contributions.length - 1));

  const fields = contributions.map((c) => c.field);
  const shared = [...new Set(contributions.flatMap((c) => c.shared))].slice(0, 6);
  return { id: b.id, similarity: Math.round(similarity * 1000) / 1000, fields, shared };
}

export function findNeighbors(capabilities: Capability[], targetId: string, args: { minSimilarity?: number } = {}): NeighborResult[] {
  const min = args.minSimilarity ?? 0.08;
  const target = capabilities.find((c) => c.id === targetId);
  if (!target) return [];
  return capabilities
    .filter((c) => c.id !== targetId)
    .map((c) => similarityBetween(target, c))
    .filter((n) => n.similarity >= min)
    .sort((x, y) => y.similarity - x.similarity || x.id.localeCompare(y.id));
}

/** Registry-wide distinctiveness per capability (PRD §4.4 area coverage). */
export function analyzePool(capabilities: Capability[]): Map<string, NeighborAnalysis> {
  const result = new Map<string, NeighborAnalysis>();
  const pool = capabilities.filter((c) => c.id !== undefined);
  for (const c of pool) {
    const neighbors = findNeighbors(capabilities, c.id);
    const best = neighbors[0] ?? null;
    result.set(c.id, {
      distinctiveness: Math.round((1 - (best?.similarity ?? 0)) * 1000) / 1000,
      best,
      neighbors,
    });
  }
  return result;
}

/** Distinctiveness of a single capability against the pool (1 = none of its kind). */
export function distinctivenessOf(capabilities: Capability[], targetId: string): number {
  const analysis = analyzePool(capabilities).get(targetId);
  return analysis?.distinctiveness ?? 1;
}