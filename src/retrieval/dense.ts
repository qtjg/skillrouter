import type { CapabilityCorpusRecord } from "../corpus/types.ts";
import type { EmbeddingRow } from "../storage/types.ts";
import { cosine, textToTokens } from "./embeddings.ts";
import type { EmbeddingProvider, SectionMatch } from "./types.ts";

export interface DenseQueryResult {
  capabilityId: string;
  sectionId: string;
  score: number;
  sectionTitle: string;
}

/**
 * Dense retrieval over persisted section embeddings: embeds the query with the
 * given provider and ranks stored vectors by cosine similarity, aggregated per
 * capability. Deterministic: ties resolved by capability/section id.
 */
export async function denseSearch(
  embeds: EmbeddingRow[],
  records: CapabilityCorpusRecord[],
  provider: EmbeddingProvider,
  query: string,
  topK = 10,
): Promise<DenseQueryResult[]> {
  const queryVector = (await provider.embed([query]))[0]!;
  const bySectionId = new Map(embeds.map((e) => [e.sectionId, e]));
  const titleBySection = new Map<string, string>();
  for (const record of records) {
    for (const section of record.sections) titleBySection.set(section.id, section.title);
  }

  const capacity = textToTokens(query).length === 0 ? 0 : 1;
  if (capacity === 0) return [];

  const scored = embeds
    .map((row) => {
      const score = cosine(row.vector, queryVector);
      return { row, score };
    })
    .sort((a, b) => b.score - a.score || (a.row.sectionId < b.row.sectionId ? -1 : 1));

  const capScores = new Map<string, number>();
  const capBest = new Map<string, { sectionId: string; sectionTitle: string }>();
  for (const { row, score } of scored) {
    if (score <= 0) continue;
    capScores.set(row.capabilityId, (capScores.get(row.capabilityId) ?? 0) + score);
    if (!capBest.has(row.capabilityId)) {
      capBest.set(row.capabilityId, {
        sectionId: row.sectionId,
        sectionTitle: titleBySection.get(row.sectionId) ?? bySectionId.get(row.sectionId)?.sectionId ?? row.sectionId,
      });
    }
  }

  const results = [...capScores.entries()].map(([capabilityId, score]) => {
    const best = capBest.get(capabilityId)!;
    return { capabilityId, sectionId: best.sectionId, score, sectionTitle: best.sectionTitle };
  });
  results.sort((a, b) => b.score - a.score || (a.capabilityId < b.capabilityId ? -1 : 1));
  return results.slice(0, topK);
}