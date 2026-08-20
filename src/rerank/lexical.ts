import { tokenize } from "../utils/text.ts";
import type { CapabilityCorpusRecord } from "../corpus/types.ts";
import type { RerankerProvider, RerankRequest, RerankedHit, RerankContext } from "./types.ts";

interface LexicalOptions {
  /** Bonus applied per matched section kind. */
  kindBonus: Record<string, number>;
  keywordBonus: number;
  reliabilityHighBonus: number;
  reliabilityLowPenalty: number;
}

const DEFAULT_OPTIONS: LexicalOptions = {
  kindBonus: { overview: 0.08, instructions: 0.05, manifest: 0.03, readme: 0.02, docs: 0, examples: -0.02, other: 0 },
  keywordBonus: 0.05,
  reliabilityHighBonus: 0.05,
  reliabilityLowPenalty: 0.1,
};

const KIND_WEIGHTS: Record<string, number> = {
  overview: 1.2,
  instructions: 1.1,
  manifest: 0.9,
  readme: 1.0,
  docs: 1.0,
  examples: 0.7,
  other: 0.8,
};

/**
 * Deterministic lexical reranker: re-scores retrieval hits using corpus-aware
 * signals — full-body term coverage (not just the best section), section-kind
 * weighting, declared keywords and (when present) adaptive reliability. No LLM
 * calls; identical inputs always produce identical rankings.
 */
export class LexicalReranker implements RerankerProvider {
  readonly name = "lexical";

  private readonly options: LexicalOptions;

  constructor(options: Partial<LexicalOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async rerank(request: RerankRequest): Promise<RerankedHit[]> {
    const queryTerms = new Set(tokenize(request.query));
    const byId = new Map((request.context ?? []).map((c) => [c.hit.capabilityId, c.ctx]));

    const scored = request.hits.map((hit) => {
      const ctx = byId.get(hit.capabilityId) ?? null;
      const record = ctx?.corpusRecord ?? null;
      return this.scoreHit(hit, queryTerms, record, ctx, request.hits.length);
    });

    scored.sort((a, b) => b.score - a.score || a.hit.rank - b.hit.rank || (a.hit.capabilityId < b.hit.capabilityId ? -1 : 1));
    return scored.map((s, i) => ({ ...s, hit: { ...s.hit, rank: i } }));
  }

  private scoreHit(
    hit: RerankedHit["hit"],
    queryTerms: Set<string>,
    record: CapabilityCorpusRecord | null,
    ctx: RerankContext | null,
    total: number,
  ): RerankedHit {
    if (queryTerms.size === 0) return { hit, score: 1 / total, reason: "empty query" };

    const reasons: string[] = [];
    let score = 0;

    // 1. term coverage over the full body (not only matched sections).
    const bodyTerms = new Set(record ? tokenize(`${record.body} ${record.keywords.join(" ")}`) : []);
    let covered = 0;
    for (const term of queryTerms) {
      if (bodyTerms.has(term)) covered += 1;
    }
    const coverage = covered / queryTerms.size;
    score += coverage * 0.6;
    if (coverage >= 0.999) reasons.push(`full query coverage`);
    else if (covered > 0) reasons.push(`${covered}/${queryTerms.size} query terms`);

    // 2. section-kind weighting of the hit's best section.
    const kind = hit.sectionKind ?? "other";
    const kindContribution = (this.options.kindBonus[kind] ?? 0) + (KIND_WEIGHTS[kind] ?? 1);
    score += Math.min(kindContribution, 1.3) * 0.2;
    if (kind === "instructions" || kind === "overview") reasons.push(`${kind} match`);

    // 3. declared keywords.
    if (record && [...queryTerms].some((t) => record.keywords.includes(t))) {
      score += this.options.keywordBonus;
      reasons.push("keyword match");
    }

    // 4. adaptive reliability (Phase G) nudge.
    const reliability = ctx?.reliability?.successRate ?? null;
    if (reliability !== null) {
      if (reliability >= 0.9) {
        score += this.options.reliabilityHighBonus;
        reasons.push("high reliability");
      } else if (reliability < 0.3) {
        score -= this.options.reliabilityLowPenalty;
        reasons.push("low reliability");
      }
    }

    score = Math.max(0, Math.min(1, score));
    return { hit, score, reason: reasons.length > 0 ? reasons.join("; ") : "no lexical signals" };
  }
}

export function createRerankerProvider(name: string): RerankerProvider {
  if (name === "lexical") return new LexicalReranker();
  throw new Error(`Unknown reranker provider: ${name}`);
}