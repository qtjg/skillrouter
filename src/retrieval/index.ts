import type { Storage } from "../storage/types.ts";
import type { RetrievalConfig } from "../config/config.ts";
import type { CapabilityCorpusRecord } from "../corpus/types.ts";
import { globalBus } from "../core/events.ts";
import { sha256Hex, stableStringify } from "../corpus/fingerprint.ts";
import { Bm25Index } from "./sparse.ts";
import { denseSearch } from "./dense.ts";
import { rrfFuse, type RankedSource } from "./fusion.ts";
import { resolveEmbeddingProvider } from "./embeddings.ts";
import type { RetrievalHit, RetrievalRequest, RetrievalResult } from "./types.ts";
import { OutcomeStore } from "../learning/outcomes.ts";
import { applyRerank } from "../rerank/index.ts";

const SPARSE_POOL_MULTIPLIER = 3;

/** Deterministic id of a corpus snapshot; used to memoize the BM25 index. */
export function corpusSnapshotHash(records: CapabilityCorpusRecord[]): string {
  return sha256Hex(
    stableStringify(records.map((r) => ({ id: r.capabilityId, contentHash: r.contentHash, sections: r.sections.map((s) => s.id) }))),
  );
}

const sparseCache = new Map<string, Bm25Index>();

export function getSparseIndex(records: CapabilityCorpusRecord[]): Bm25Index {
  const hash = corpusSnapshotHash(records);
  const cached = sparseCache.get(hash);
  if (cached) return cached;
  if (sparseCache.size > 8) sparseCache.clear();
  const index = new Bm25Index(records);
  sparseCache.set(hash, index);
  return index;
}

export function clearSparseCache(): void {
  sparseCache.clear();
}

/**
 * Hybrid retrieval: BM25 sparse over corpus sections plus (when enabled and
 * embedded) cosine dense retrieval, fused with Reciprocal Rank Fusion.
 * Deterministic; never throws — degraded modalities simply drop out.
 */
export async function retrieve(
  storage: Storage,
  config: RetrievalConfig,
  request: RetrievalRequest,
  opts: { outcomeLimit?: number } = {},
): Promise<RetrievalResult> {
  const started = Date.now();
  const query = request.query.trim();
  const topK = request.topK ?? config.topK;
  const requested = request.sources ?? ["sparse", "dense"];
  const records = await storage.allCorpusRecords();
  const kindBySection = new Map<string, string>();
  for (const record of records) {
    for (const section of record.sections) kindBySection.set(section.id, section.kind);
  }

  const sparseRanked: RankedSource[] = [];
  const denseRanked: RankedSource[] = [];
  let providerName = "none";

  if (records.length === 0) {
    return { query, hits: [], sources: ["sparse", "dense"], provider: providerName, latencyMs: Date.now() - started, total: 0 };
  }

  if (requested.includes("sparse") && query.length > 0) {
    const pool = Math.max(topK, topK * SPARSE_POOL_MULTIPLIER);
    const sparseHits = getSparseIndex(records).search(query, pool);
    for (const hit of sparseHits) {
      sparseRanked.push({
        capabilityId: hit.capabilityId,
        rank: sparseRanked.length,
        source: "sparse",
        sectionId: hit.matchedSections[0]?.id ?? undefined,
        sectionTitle: hit.matchedSections[0]?.title ?? undefined,
      });
    }
  }

  if (requested.includes("dense") && config.embeddings.enabled) {
    const embeds = await storage.allEmbeddings();
    if (embeds.length > 0 && query.length > 0) {
      const { provider, fallback } = resolveEmbeddingProvider(config.embeddings);
      providerName = fallback ? "local (fallback)" : provider.name;
      const pool = Math.max(topK, topK * SPARSE_POOL_MULTIPLIER);
      const denseHits = await denseSearch(embeds, records, provider, query, pool);
      for (const hit of denseHits) {
        denseRanked.push({
          capabilityId: hit.capabilityId,
          rank: denseRanked.length,
          source: "dense",
          sectionId: hit.sectionId,
          sectionTitle: hit.sectionTitle,
        });
      }
    }
  }

  const fused = rrfFuse([sparseRanked, denseRanked].filter((l) => l.length > 0), topK);
  for (const hit of fused) {
    hit.sectionKind = (kindBySection.get(hit.sectionId ?? "") as RetrievalHit["sectionKind"]) ?? null;
  }

  let finalHits: RetrievalHit[] = fused;
  if (config.rerank?.enabled && fused.length > 1 && query.length > 0) {
    const summaries = await new OutcomeStore(storage, opts.outcomeLimit ?? 1000).summaries();
    finalHits = await applyRerank(config.rerank.provider, { query, hits: fused, records, summaries });
  }

  globalBus.emit({ event: "retrieval.queried", query, hits: finalHits.length });
  return { query, hits: finalHits, sources: requested, provider: providerName, latencyMs: Date.now() - started, total: finalHits.length };
}

export interface EmbedRefreshResult {
  enabled: boolean;
  embedded: number;
  skipped: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
}

/**
 * (Re)computes dense embeddings for every corpus section when enabled.
 * Sections whose stored embedding already matches the current provider and
 * corpus content hash are skipped — no redundant API calls. Stale embeddings
 * for removed sections/capabilities are dropped.
 */
export async function refreshEmbeddings(storage: Storage, config: RetrievalConfig): Promise<EmbedRefreshResult> {
  const result: EmbedRefreshResult = { enabled: config.embeddings.enabled, embedded: 0, skipped: 0, failed: 0, errors: [] };
  if (!config.embeddings.enabled) return result;

  const { provider } = resolveEmbeddingProvider(config.embeddings);
  const modelKey = `${provider.name}:${provider.dimension}`;
  const records = await storage.allCorpusRecords();
  const liveCapabilityIds = new Set<string>();

  for (const record of records) {
    liveCapabilityIds.add(record.capabilityId);
    const sections = record.sections.filter((s) => s.body.length > 0);
    if (sections.length === 0) continue;
    const existing = await storage.embeddingsByCapability(record.capabilityId);
    const bySection = new Map(existing.map((e) => [e.sectionId, e]));
    const valid = sections.every((s) => bySection.get(s.id)?.model === modelKey && bySection.get(s.id)?.recordHash === record.contentHash);
    if (valid) {
      result.skipped += sections.length;
      continue;
    }
    try {
      const vectors = await provider.embed(sections.map((s) => s.body));
      await storage.removeEmbeddingsByCapability(record.capabilityId);
      for (let i = 0; i < sections.length; i++) {
        await storage.upsertEmbedding({
          sectionId: sections[i]!.id,
          capabilityId: record.capabilityId,
          vector: vectors[i]!,
          dimension: provider.dimension,
          model: modelKey,
          recordHash: record.contentHash,
          createdAt: new Date().toISOString(),
        });
      }
      result.embedded += sections.length;
    } catch (err) {
      result.failed += 1;
      result.errors.push({ id: record.capabilityId, message: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const row of await storage.allEmbeddings()) {
    if (!liveCapabilityIds.has(row.capabilityId)) {
      await storage.removeEmbeddingsByCapability(row.capabilityId);
    }
  }

  return result;
}