/** Disambiguation question factory (PRD §13). Never includes raw content or secrets. */
export interface ClarificationOption {
  id: string;
  label: string;
}

export interface Clarification {
  question: string;
  options: ClarificationOption[];
  /** Capability ids this disambiguation resolves between. */
  resolves: string[];
}

export interface CandidateChoice {
  id: string;
  label: string;
  score: number;
}

export interface ClarificationOptions {
  /** Max score gap (percentage points) that still counts as "close". Default 6. */
  margin?: number;
  /** Max options to present. Default 3. */
  maxOptions?: number;
  /** Min score gap between the top option and the rest to skip clarification. Default 4. */
  minResolvableGap?: number;
}

/**
 * Builds a clarification when the top candidates are too close to separate
 * (= PRD §13 minimal disambiguation). Returns null when one candidate is
 * clearly ahead. Deterministic.
 */
export function buildClarification(candidates: CandidateChoice[], options: ClarificationOptions = {}): Clarification | null {
  const margin = options.margin ?? 6;
  const maxOptions = options.maxOptions ?? 3;
  const minResolvableGap = options.minResolvableGap ?? 4;

  if (candidates.length < 2) return null;
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const top = sorted[0]!;
  const second = sorted[1]!;
  if (top.score - second.score >= minResolvableGap) return null;

  const head: CandidateChoice[] = [];
  for (const c of sorted) {
    if (c.score < top.score - margin || head.length >= maxOptions) break;
    head.push(c);
  }
  if (head.length < 2) return null;

  const resolves = head.map((c) => c.id);
  const a = head[0]!;
  const b = head[1]!;
  const question = `Several capabilities match similarly (${a.label} ${a.score.toFixed(1)} vs ${b.label} ${b.score.toFixed(1)}${head.length > 2 ? `, ...` : ""}). Which one do you mean?`;
  const optionsOut = head.map((c) => ({ id: c.id, label: c.label }));
  return { question, options: optionsOut, resolves };
}