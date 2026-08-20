import type { CapabilityGapTerm, GapAnalysis, GapAnalysisOptions } from "./types.ts";
import { tokenize } from "../utils/text.ts";

const STOP = new Set([
  "the", "and", "for", "with", "into", "your", "this", "that", "from", "how", "what", "please", "help", "can", "you", "need", "want", "make", "get", "using", "use", "have",
]);

function termCoverage(corpus: GapAnalysisOptions["corpus"]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of corpus) {
    const seen = new Set<string>();
    for (const section of record.sections) {
      for (const token of tokenize(section.body)) {
        if (STOP.has(token) || seen.has(token)) continue;
        seen.add(token);
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * Deterministic gap analysis (PRD v2.0 D6): terms that keep appearing in
 * weakly-answered queries while corpus coverage stays low score highest.
 */
export function analyzeGaps(options: GapAnalysisOptions): GapAnalysis {
  const minFrequency = options.minFrequency ?? 2;
  const maxGaps = options.maxGaps ?? 20;
  const corpusSections = options.corpus.reduce((acc, r) => acc + r.sections.length, 0);

  const perQuery = new Set<string>();
  const frequency = new Map<string, number>();
  for (const query of options.queries) {
    for (const token of tokenize(query)) {
      if (STOP.has(token)) continue;
      if (perQuery.has(token)) continue;
      perQuery.add(token);
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
    perQuery.clear();
  }

  const coverage = termCoverage(options.corpus);

  const gaps: CapabilityGapTerm[] = [];
  for (const [term, freq] of frequency) {
    if (freq < minFrequency) continue;
    const cov = coverage.get(term) ?? 0;
    gaps.push({ term, frequency: freq, coverage: cov, score: freq / (1 + cov) });
  }
  gaps.sort((a, b) => b.score - a.score || b.frequency - a.frequency || a.term.localeCompare(b.term));

  const top = gaps.slice(0, maxGaps);
  const suggestedQuery = top
    .slice(0, 3)
    .map((g) => g.term)
    .join(" ");

  return { gaps: top, totalQueries: options.queries.length, suggestedQuery, corpusSections };
}