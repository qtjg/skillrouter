import type { CapabilityCorpusRecord } from "../corpus/types.ts";
import type { OutcomeSummary } from "../learning/outcomes.ts";
import type { RetrievalHit } from "../retrieval/types.ts";
import { createRerankerProvider, LexicalReranker } from "./lexical.ts";
import type { RerankContext } from "./types.ts";

export { LexicalReranker };

export interface RerankInput {
  query: string;
  hits: RetrievalHit[];
  records: CapabilityCorpusRecord[];
  summaries: Map<string, OutcomeSummary>;
}

/**
 * Applies the named reranker to fused retrieval hits, annotating each hit with
 * rerankScore/rerankReason and re-assigning ranks. Order is deterministic.
 */
export async function applyRerank(providerName: string, input: RerankInput): Promise<RetrievalHit[]> {
  const provider = createRerankerProvider(providerName);
  const byCapability = new Map(input.records.map((r) => [r.capabilityId, r]));
  const context = input.hits.map((hit) => ({
    hit,
    ctx: {
      corpusRecord: byCapability.get(hit.capabilityId) ?? null,
      reliability: input.summaries.get(hit.capabilityId) ?? null,
    } satisfies RerankContext,
  }));

  const reranked = await provider.rerank({ query: input.query, hits: input.hits, context });
  return reranked.map((r) => ({ ...r.hit, score: r.hit.score || r.score, rerankScore: r.score, rerankReason: r.reason }));
}