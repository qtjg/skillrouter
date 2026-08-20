import type { CorpusSectionKind } from "../corpus/types.ts";

export type RetrievalSourceType = "sparse" | "dense";

export interface SectionMatch {
  id: string;
  title: string;
  score: number;
}

export interface RetrievalHit {
  capabilityId: string;
  /** Best matching section of this capability, when section-level info is available. */
  sectionId: string | null;
  sectionKind: CorpusSectionKind | null;
  matchedSections: SectionMatch[];
  score: number;
  /** 0-based rank after fusion/rerank. */
  rank: number;
  /** Sources that contributed to this hit. */
  sources: RetrievalSourceType[];
  /** Reranker confidence in [0,1], when reranking is enabled. */
  rerankScore?: number;
  /** Human-readable rerank rationale. */
  rerankReason?: string;
}

export interface RetrievalRequest {
  query: string;
  topK?: number;
  /** Restrict which retrieval modalities run; default both. */
  sources?: RetrievalSourceType[];
}

export interface RetrievalResult {
  query: string;
  hits: RetrievalHit[];
  sources: RetrievalSourceType[];
  /** Provider used for dense retrieval ("local" | "openai" | "none"). */
  provider: string;
  latencyMs: number;
  total: number;
}

/** Pluggable embedding provider (PRD v2.0 D2). */
export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  /** Embed a batch of texts; returned vectors must be unit-normalized. */
  embed(texts: string[]): Promise<number[][]>;
}