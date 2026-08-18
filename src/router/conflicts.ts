import type { CapabilityScore } from "./types.ts";

/**
 * Resolve declared conflicts between ranked capabilities.
 * When two capabilities conflict, the higher-scoring one wins and the
 * lower one is excluded (with an explanation). Ties keep the one with
 * the lower risk score.
 */
export function resolveConflicts(scores: CapabilityScore[]): CapabilityScore[] {
  const sorted = [...scores].sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id));
  const excluded = new Set<string>();
  const result: CapabilityScore[] = [];
  const conflictMap = new Map<string, string>();

  for (const score of sorted) {
    if (excluded.has(score.capability.id)) continue;
    if (score.capability.conflicts && score.capability.conflicts.length > 0) {
      for (const conflictId of score.capability.conflicts) {
        const opponent = sorted.find((s) => s.capability.id === conflictId && !excluded.has(conflictId) && s.capability.id !== score.capability.id);
        if (opponent) {
          if (opponent.score > score.score || (opponent.score === score.score && score.riskLevel > opponent.riskLevel)) {
            // The conflicting partner is stronger: drop the current capability.
            excluded.add(score.capability.id);
            conflictMap.set(score.capability.id, opponent.capability.id);
          } else {
            // Keep current score; exclude opponent instead.
            excluded.add(opponent.capability.id);
            conflictMap.set(opponent.capability.id, score.capability.id);
          }
        }
      }
    }
    result.push(score);
  }

  for (const score of result) {
    if (excluded.has(score.capability.id)) continue;
    const conflicting = conflictMap.get(score.capability.id);
    if (conflicting) {
      score.conflictWith = conflicting;
    }
  }

  return result.filter((s) => !excluded.has(s.capability.id));
}

export function findConflicts(scores: CapabilityScore[]): Array<{ a: string; b: string }> {
  const pairs: Array<{ a: string; b: string }> = [];
  for (const score of scores) {
    for (const conflictId of score.capability.conflicts ?? []) {
      const other = scores.find((s) => s.capability.id === conflictId);
      if (other && conflictId !== score.capability.id) {
        pairs.push({ a: score.capability.id, b: conflictId });
        break;
      }
    }
  }
  return pairs;
}