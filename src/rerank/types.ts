import type { CapabilityCorpusRecord } from "../corpus/types.ts";
import type { OutcomeSummary } from "../learning/outcomes.ts";
import type { RetrievalHit } from "../retrieval/types.ts";

export interface RerankContext {
  /** Canonical corpus record of the hit capability, when indexed. */
  corpusRecord: CapabilityCorpusRecord | null;
  /** Adaptive reliability summary (Phase G), when available. */
  reliability: OutcomeSummary | null;
}

export interface RerankRequest {
  query: string;
  hits: RetrievalHit[];
  context?: Array<{ hit: RetrievalHit; ctx: RerankContext }>;
}

export interface RerankedHit {
  hit: RetrievalHit;
  /** Reranker confidence in [0, 1]. */
  score: number;
  /** Human-readable rationale. */
  reason: string;
}

/** Pluggable reranker (PRD v2.0 D3). */
export interface RerankerProvider {
  readonly name: string;
  rerank(request: RerankRequest): Promise<RerankedHit[]>;
}