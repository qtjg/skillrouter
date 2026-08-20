import type { Storage } from "../storage/types.ts";
import { globalBus } from "../core/events.ts";
import { logger } from "../logging/logger.ts";
import { buildCorpusRecord } from "./record.ts";
import { extractSections, resolveBodyDir } from "./extract.ts";

export interface CorpusIndexOptions {
  /** Skip capabilities whose stored content hash already matches (incremental). */
  changedOnly?: boolean;
  /** Only index these capability ids. */
  capabilityIds?: string[];
}

export interface CorpusIndexResult {
  indexed: number;
  skipped: number;
  failed: number;
  removed: number;
  errors: Array<{ id: string; message: string }>;
}

/**
 * Indexes the capability corpus: for every stored capability, resolves its
 * content root, extracts the full body, normalizes/redacts it, fingerprints it
 * and persists the canonical record. Stale corpus rows for capabilities that no
 * longer exist are removed. The deterministic router pipeline is untouched.
 */
export async function indexCorpus(storage: Storage, repoRoot: string, cwd: string, options: CorpusIndexOptions = {}): Promise<CorpusIndexResult> {
  const { changedOnly = false, capabilityIds } = options;
  const result: CorpusIndexResult = { indexed: 0, skipped: 0, failed: 0, removed: 0, errors: [] };
  const capabilities = await storage.allCapabilities();
  const targets = capabilityIds && capabilityIds.length > 0 ? capabilities.filter((c) => capabilityIds.includes(c.id)) : capabilities;

  for (const capability of targets) {
    try {
      const location = await resolveBodyDir(capability, { repoRoot, cwd, storage });
      if (!location) {
        result.skipped += 1;
        continue;
      }
      const extracted = await extractSections(location.dir);
      const record = buildCorpusRecord(capability, extracted.sections, new Date().toISOString());

      const stored = await storage.getCorpusRecord(capability.id);
      if (changedOnly && stored?.contentHash === record.contentHash) {
        result.skipped += 1;
        continue;
      }

      await storage.upsertCorpusRecord(record);
      result.indexed += 1;
      globalBus.emit({ event: "corpus.indexed", id: capability.id, changed: stored?.contentHash !== record.contentHash });
    } catch (err) {
      result.failed += 1;
      result.errors.push({ id: capability.id, message: err instanceof Error ? err.message : String(err) });
      logger.warn(`Corpus indexing failed for ${capability.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const liveIds = new Set(capabilities.map((c) => c.id));
  for (const stored of await storage.allCorpusRecords()) {
    if (!liveIds.has(stored.capabilityId)) {
      await storage.removeCorpusRecord(stored.capabilityId);
      result.removed += 1;
    }
  }

  return result;
}