/** Match classes (PRD §12): never force a route. */
export type MatchClass = "NO_MATCH" | "WEAK_MATCH" | "GOOD_MATCH" | "EXACT_MATCH";

export const MATCH_CLASSES: readonly MatchClass[] = ["NO_MATCH", "WEAK_MATCH", "GOOD_MATCH", "EXACT_MATCH"];

/** Numeric calibrated confidence (PRD §14). */
export interface Confidence {
  /** 0..1 probability-style estimate. */
  value: number;
  label: "low" | "medium" | "high";
  /** Version of the calibration mapping used. */
  calibrationVersion: string;
}

/** Configurable decision thresholds (PRD §12): noMatch <= weak <= good <= exact. */
export interface ClassificationThresholds {
  noMatch: number;
  weak: number;
  good: number;
  exact: number;
}

export const DEFAULT_CLASSIFICATION_THRESHOLDS: ClassificationThresholds = {
  noMatch: 25,
  weak: 50,
  good: 75,
  exact: 90,
};

export interface ClassificationResult {
  class: MatchClass;
  /** Best candidate activation score (0–100). */
  score: number;
  confidence: Confidence;
  reasons: string[];
}

export interface CalibrationSample {
  /** Observed success rate 0..1 for a capability (or bucket). */
  successRate: number;
  /** Number of observations backing the rate. */
  usage: number;
}

export interface CalibrationReport {
  ece: number;
  brier: number;
  n: number;
}