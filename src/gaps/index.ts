import type { Storage } from "../storage/types.ts";
import type { GapAnalysis } from "./types.ts";
import { analyzeGaps } from "./analyze.ts";

export interface HistoryGapOptions {
  /** Max routing history rows to inspect (default 500). */
  historyLimit?: number;
  minFrequency?: number;
  maxGaps?: number;
}

/** History rows whose task never activated a capability are gap candidates. */
export function isGapCandidate(selected: string, activations: string): boolean {
  return (selected ?? "").trim() === "" && (activations ?? "").trim() === "";
}

/**
 * Analyze historical weak routings against the corpus: tasks with no selected
 * or activated capability contribute their terms to the gap ranking.
 */
export async function analyzeHistoryGaps(storage: Storage, options: HistoryGapOptions = {}): Promise<GapAnalysis> {
  const history = await storage.getHistory({ limit: options.historyLimit ?? 500 });
  const queries = history.filter((row) => isGapCandidate(row.selected, row.activations)).map((row) => row.task);
  const corpus = await storage.allCorpusRecords();
  return analyzeGaps({ queries, corpus, minFrequency: options.minFrequency, maxGaps: options.maxGaps });
}