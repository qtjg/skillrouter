import type { CapabilityCorpusRecord } from "../corpus/types.ts";

export interface CapabilityGapTerm {
  /** Normalized term (lowercase, stem-free token). */
  term: string;
  /** Number of distinct queries containing the term. */
  frequency: number;
  /** Number of corpus sections whose body contains the term. */
  coverage: number;
  /** Deterministic gap score: frequency / (1 + coverage). */
  score: number;
}

export interface GapAnalysis {
  gaps: CapabilityGapTerm[];
  /** Number of queries analyzed. */
  totalQueries: number;
  /** Suggested acquisition query from the top gap terms. */
  suggestedQuery: string;
  /** Corpus coverage seen during analysis. */
  corpusSections: number;
}

export interface GapAnalysisOptions {
  /** Queries that produced weak or empty activations (gap candidates). */
  queries: string[];
  /** Corpus content used to measure existing coverage. */
  corpus: CapabilityCorpusRecord[];
  /** Only report terms appearing in at least this many queries (default 2). */
  minFrequency?: number;
  /** Max gap terms to return (default 20). */
  maxGaps?: number;
}