import type { RetrievalHit, RetrievalSourceType, SectionMatch } from "./types.ts";

const RRF_CONSTANT = 60;

export interface RankedSource {
  capabilityId: string;
  rank: number; // 0-based
  source: RetrievalSourceType;
  sectionId?: string;
  sectionTitle?: string;
}

/**
 * Reciprocal Rank Fusion: merges per-source ranked lists, scoring each hit as
 * Σ 1/(k + rank). Ties are broken deterministically (capabilityId) so results
 * are stable. Wins go the higher rank even when raw scores differ between
 * modalities.
 */
export function rrfFuse(lists: RankedSource[][], topK = 10): RetrievalHit[] {
  const scores = new Map<string, number>();
  const meta = new Map<string, { sectionId: string | null; sectionTitle: string | null; sources: RetrievalSourceType[]; sectionMatches: SectionMatch[] }>();

  for (const list of lists) {
    for (const item of list) {
      const key = item.capabilityId;
      scores.set(key, (scores.get(key) ?? 0) + 1 / (RRF_CONSTANT + item.rank + 1));
      const m = meta.get(key) ?? { sectionId: null, sectionTitle: null, sources: [] as RetrievalSourceType[], sectionMatches: [] as SectionMatch[] };
      if (!m.sources.includes(item.source)) m.sources.push(item.source);
      if (m.sectionId === null && item.sectionId) {
        m.sectionId = item.sectionId;
        m.sectionTitle = item.sectionTitle ?? null;
      }
      if (item.sectionId && item.sectionTitle) {
        m.sectionMatches.push({ id: item.sectionId, title: item.sectionTitle, score: 1 / (RRF_CONSTANT + item.rank + 1) });
      }
      meta.set(key, m);
    }
  }

  const hits = [...scores.entries()].map(([capabilityId, score]) => {
    const m = meta.get(capabilityId)!;
    return {
      capabilityId,
      sectionId: m.sectionId,
      sectionKind: null,
      matchedSections: m.sectionMatches.slice(0, 3),
      score,
      rank: 0,
      sources: m.sources,
    } as RetrievalHit;
  });

  hits.sort((a, b) => b.score - a.score || (a.capabilityId < b.capabilityId ? -1 : 1));
  hits.slice(0, topK).forEach((h, i) => {
    h.rank = i;
  });
  return hits.slice(0, topK);
}