import type { CalibrationReport, CalibrationSample, ClassificationResult, ClassificationThresholds, Confidence, MatchClass } from "./types.ts";
import { DEFAULT_CLASSIFICATION_THRESHOLDS } from "./types.ts";

export const CALIBRATION_VERSION = "1.0.0";

const LABEL_HIGH = 0.75;
const LABEL_MEDIUM = 0.5;
/** Blending weights when observed reliability is available (usage >= MIN_OBSERVATIONS). */
const BLEND_NAIVE = 0.4;
const BLEND_OBSERVED = 0.6;
const MIN_OBSERVATIONS = 10;

export function normalizeThresholds(thresholds: Partial<ClassificationThresholds> | undefined): ClassificationThresholds {
  const base = { ...DEFAULT_CLASSIFICATION_THRESHOLDS, ...(thresholds ?? {}) };
  const order = [base.noMatch, base.weak, base.good, base.exact]
    .map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0))
    .sort((a, b) => a - b);
  return { noMatch: order[0]!, weak: order[1]!, good: order[2]!, exact: order[3]! };
}

/** Deterministic class mapping over the top activation score (PRD §12). */
export function classify(score: number, thresholds: Partial<ClassificationThresholds> | undefined = undefined): MatchClass {
  const t = normalizeThresholds(thresholds);
  const s = Math.min(100, Math.max(0, score));
  if (s < t.noMatch) return "NO_MATCH";
  if (s < t.weak) return "WEAK_MATCH";
  if (s < t.good) return "GOOD_MATCH";
  return "EXACT_MATCH";
}

/** Blends the naive score probability with observed reliability (PRD §14). */
export function calibrate(score: number, samples: CalibrationSample[]): number {
  const naive = Math.min(1, Math.max(0, score / 100));
  let totalUsage = 0;
  let weighted = 0;
  for (const sample of samples) {
    totalUsage += sample.usage;
    weighted += sample.usage * Math.min(1, Math.max(0, sample.successRate));
  }
  if (totalUsage < MIN_OBSERVATIONS || totalUsage === 0) return Math.round(naive * 1000) / 1000;
  const observed = weighted / totalUsage;
  return Math.round((BLEND_NAIVE * naive + BLEND_OBSERVED * observed) * 1000) / 1000;
}

export function confidenceLabel(value: number): Confidence["label"] {
  if (value >= LABEL_HIGH) return "high";
  if (value >= LABEL_MEDIUM) return "medium";
  return "low";
}

export function buildConfidence(score: number, samples: CalibrationSample[]): Confidence {
  const value = calibrate(score, samples);
  return { value: Math.round(value * 1000) / 1000, label: confidenceLabel(value), calibrationVersion: CALIBRATION_VERSION };
}

export function classifyResult(score: number, samples: CalibrationSample[], thresholds: Partial<ClassificationThresholds> | undefined = undefined): ClassificationResult {
  const t = normalizeThresholds(thresholds);
  const cls = classify(score, t);
  const confidence = buildConfidence(score, samples);
  const reasons: string[] = [];
  if (samples.reduce((a, s) => a + s.usage, 0) > 0) reasons.push("calibrated against observed outcomes");
  if (cls === "NO_MATCH") reasons.push("below no-match threshold; no activation recommended");
  else if (cls === "WEAK_MATCH") reasons.push("weak evidence; consider clarification");
  else if (cls === "EXACT_MATCH") reasons.push("above exact-match threshold");
  else reasons.push("above good-match threshold");
  return { class: cls, score: Math.min(100, Math.max(0, score)), confidence, reasons };
}

/**
 * Expected Calibration Error + Brier score over (score, success) pairs
 * (PRD §14): buckets predictions by 10-point score band and measures how far
 * bucket accuracy deviates from the mean predicted probability.
 */
export function measureCalibration(predictions: Array<{ score: number; success: boolean }>): CalibrationReport {
  const n = predictions.length;
  const buckets = new Map<number, { pred: number; hits: number; n: number }>();
  for (const p of predictions) {
    const bucket = Math.min(9, Math.max(0, Math.floor(Math.min(100, Math.max(0, p.score)) / 10)));
    const entry = buckets.get(bucket) ?? { pred: 0, hits: 0, n: 0 };
    entry.pred += p.score / 100;
    entry.hits += p.success ? 1 : 0;
    entry.n += 1;
    buckets.set(bucket, entry);
  }
  let ece = 0;
  for (const [bucket, entry] of buckets) {
    void bucket;
    const acc = entry.hits / entry.n;
    const conf = entry.pred / entry.n;
    ece += (entry.n / n) * Math.abs(acc - conf);
  }
  let brier = 0;
  for (const p of predictions) {
    const prob = p.score / 100;
    brier += (prob - (p.success ? 1 : 0)) ** 2;
  }
  brier = n > 0 ? brier / n : 0;
  return { ece: Math.round(ece * 10000) / 10000, brier: Math.round(brier * 10000) / 10000, n };
}