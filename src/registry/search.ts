import type { Capability } from "../core/types.ts";
import { normalizePhrases, levenshtein } from "../utils/text.ts";
import { computeRisk } from "../security/risk.ts";

export interface SearchHit {
  capability: Capability;
  score: number; // 0..100
  signals: string[];
  id: string;
  name: string;
  version: string;
  type: string;
}

interface TermWeights {
  exactId: number;
  idPrefix: number;
  idFuzzy: number;
  keywordHit: number;
  technologyHit: number;
  intentHit: number;
  nameHit: number;
  descriptionHit: number;
  categoryHit: number;
}

const WEIGHTS: TermWeights = {
  exactId: 100,
  idPrefix: 75,
  idFuzzy: 45,
  keywordHit: 55,
  technologyHit: 50,
  intentHit: 60,
  nameHit: 40,
  descriptionHit: 18,
  categoryHit: 25,
};

function prepareCapability(capability: Capability): { terms: Set<string>; nameTerms: Set<string>; categories: string[] } {
  const terms = new Set<string>();
  const sources: string[] = [
    capability.id,
    capability.name,
    capability.description,
    ...(capability.capabilities ?? []),
    ...(capability.triggers?.keywords ?? []),
    ...(capability.triggers?.intents ?? []),
    ...(capability.triggers?.technologies ?? []),
    ...(capability.metadata?.tags ?? []),
  ];
  for (const source of sources) {
    for (const t of normalizePhrases(source)) terms.add(t);
  }
  const nameTerms = new Set<string>(normalizePhrases(capability.name));
  return { terms, nameTerms, categories: capability.metadata?.categories ?? [] };
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
  exactIdOnly?: boolean;
}

const MAX_CAPABILITIES = 5000;
const QUERY_TOKEN_LIMIT = 60;

export function rankCapabilities(query: string, capabilities: Capability[], options: SearchOptions = {}): SearchHit[] {
  const limit = options.limit ?? 20;
  const minScore = options.minScore ?? 1;
  const q = query.trim();
  if (!q) return [];
  const qLower = q.toLowerCase();
  const queryTerms = [...normalizePhrases(q)].slice(0, QUERY_TOKEN_LIMIT);
  const queryTokens = new Set(queryTerms);

  const results: SearchHit[] = [];
  let done = 0;
  for (const capability of capabilities) {
    done += 1;
    if (done > MAX_CAPABILITIES) break;
    const hit = scoreCapability(qLower, queryTerms, queryTokens, capability);
    if (hit.score >= minScore) results.push(hit);
  }
  results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return results.slice(0, limit);
}

export function scoreCapability(qLower: string, queryTerms: string[], queryTokens: Set<string>, capability: Capability): SearchHit {
  const signals: string[] = [];
  let score = 0;
  const add = (weight: number, signal: string) => {
    score += weight;
    signals.push(signal);
  };

  if (capability.id === qLower) add(WEIGHTS.exactId, `exact id match`);
  else if (capability.id.startsWith(qLower) && qLower.length >= 3) add(WEIGHTS.idPrefix, `id prefix match`);
  else if (qLower.length >= 4 && levenshtein(capability.id, qLower) <= Math.max(1, Math.floor(qLower.length / 3))) {
    add(WEIGHTS.idFuzzy, "id similarity");
  }

  const prepared = prepareCapability(capability);
  const hitTerms: string[] = [];
  for (const term of queryTerms) {
    if (prepared.terms.has(term)) hitTerms.push(term);
  }

  const isKeyword = (t: string) => (capability.triggers?.keywords ?? []).some((k) => normalizePhrases(k).has(t));
  const isTechnology = (t: string) => (capability.triggers?.technologies ?? []).some((k) => normalizePhrases(k).has(t));
  const isIntent = (t: string) => (capability.triggers?.intents ?? []).some((k) => normalizePhrases(k).has(t));

  for (const term of hitTerms) {
    if (prepared.nameTerms.has(term)) {
      add(WEIGHTS.nameHit, `"${term}" matches name`);
    } else if (isKeyword(term)) {
      add(WEIGHTS.keywordHit, `"${term}" matches keyword`);
    } else if (isTechnology(term)) {
      add(WEIGHTS.technologyHit, `"${term}" matches technology`);
    } else if (isIntent(term)) {
      add(WEIGHTS.intentHit, `"${term}" matches intent`);
    } else {
      add(WEIGHTS.descriptionHit, `"${term}" found in description`);
    }
  }

  for (const token of queryTokens) {
    if (prepared.categories.includes(token)) {
      add(WEIGHTS.categoryHit, `"${token}" matches category`);
      break;
    }
  }

  const risk = computeRisk(capability);
  const normalized = Math.min(100, Math.round(score / (score > 40 ? 1 : 1.2)));
  return {
    capability,
    score: normalized,
    signals,
    id: capability.id,
    name: capability.name,
    version: capability.version,
    type: capability.type,
  };
}

export function fuzzyIdMatch(query: string, capabilities: Capability[]): Capability | null {
  const q = query.trim().toLowerCase();
  const exact = capabilities.find((c) => c.id === q);
  if (exact) return exact;
  const prefix = capabilities.filter((c) => c.id.startsWith(q));
  if (prefix.length === 1) return prefix[0]!;
  const ranked = capabilities
    .map((c) => ({ c, d: levenshtein(c.id, q) }))
    .filter(({ d }) => d <= Math.max(1, Math.floor(q.length / 2)))
    .sort((a, b) => a.d - b.d);
  return ranked[0]?.c ?? null;
}