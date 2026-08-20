import type { Capability, CapabilityMetadata } from "../core/types.ts";
import type { OutcomeSummary } from "../learning/outcomes.ts";

/**
 * Quality analyzer (PRD §8). Produces a deterministic 0–100 quality score per
 * capability from observable metadata and outcome history. A declared
 * `metadata.quality` is authoritative when present; otherwise the score is
 * derived from manifest completeness, declared reliability and fresh outcomes.
 */

export interface QualityDimensions {
  /** Manifest completeness 0–100 (description, triggers, permissions, risk, metadata). */
  completeness: number;
  /** Authoritative declared quality when present. */
  declared: number | null;
  /** Declared reliability scaled to 0–100. */
  reliability: number;
  /** Outcome-derived quality 0–100 (fresh metrics), null when no history. */
  history: number | null;
}

export interface QualityReport {
  id: string;
  quality: number;
  dimensions: QualityDimensions;
  verdict: "excellent" | "good" | "adequate" | "weak" | "minimal";
  source: "declared" | "mixed" | "derived";
  notes: string[];
}

export const QUALITY_VERDICTS: QualityReport["verdict"][] = ["excellent", "good", "adequate", "weak", "minimal"];

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "with", "as", "by", "at", "from", "is", "are", "be",
  "it", "that", "this", "your", "you", "we", "can", "will", "must", "should", "has", "have", "using", "use", "used",
  "helps", "help", "handles", "handle", "via", "based", "simple", "quickly", "easy", "provides", "provide", "performs",
  "perform", "allows", "allow", "supports", "support", "tasks", "task", "work", "works", "working", "scripts", "tool",
]);

/** Normalized lowercased tokens for free text, stopwords removed. */
export function textTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#._-]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

/** 0–100: how much of the manifest surface is actually declared. */
export function completenessOf(capability: Capability, metadata: CapabilityMetadata | undefined): number {
  let score = 0;
  const notes: string[] = [];
  if (capability.description.length >= 80) {
    score += 15;
  } else if (capability.description.length >= 30) {
    score += 8;
  } else {
    notes.push("short description");
  }
  if (capability.triggers) {
    const t = capability.triggers;
    if ((t.keywords?.length ?? 0) + (t.intents?.length ?? 0) + (t.technologies?.length ?? 0) + (t.filePatterns?.length ?? 0) + (t.gitPatterns?.length ?? 0) > 0) {
      score += 20;
    } else {
      notes.push("empty triggers block");
    }
  }
  if (capability.permissions && typeof capability.permissions === "object" && !Array.isArray(capability.permissions) && Object.keys(capability.permissions).length > 0) {
    score += 10;
  } else {
    notes.push("no permissions declared");
  }
  if (capability.risk?.declared || capability.risk?.score !== undefined) {
    score += 10;
  } else {
    notes.push("no risk level declared");
  }
  if (capability.dependencies && capability.dependencies.length > 0) score += 5;
  if (capability.fallbacks && capability.fallbacks.length > 0) score += 5;
  if (capability.conflicts && capability.conflicts.length > 0) score += 5;
  if (metadata) {
    if (metadata.tags && metadata.tags.length > 0) score += 5;
    if (metadata.license) score += 5;
    if (metadata.author && metadata.author !== "unknown") score += 5;
    if (metadata.repository && metadata.repository !== "unknown") score += 5;
    if (metadata.cost !== undefined) score += 5;
    if (metadata.latencyMs !== undefined || metadata.latency !== undefined) score += 5;
  }
  // No floor: an empty manifest is honestly worth zero surface quality.
  return Math.min(100, score);
}

/** Historical quality from fresh outcome summaries (PRD §22/§8). */
export function historyQuality(summary: OutcomeSummary | undefined): number | null {
  if (!summary || summary.usage === 0) return null;
  const raw = summary.successRate * 100;
  const coverage = Math.min(100, (summary.usage / 100) * 40);
  return Math.round(Math.min(100, raw * 0.75 + coverage * 0.25));
}

export function analyzeCapabilityQuality(capability: Capability, args: { history?: OutcomeSummary } = {}): QualityReport {
  const metadata = capability.metadata;
  const notes: string[] = [];
  const completeness = completenessOf(capability, metadata);

  const declared = typeof metadata?.quality === "number" ? Math.max(0, Math.min(100, metadata.quality)) : null;
  const reliability = typeof metadata?.reliability === "number" ? Math.max(0, Math.min(1, metadata.reliability)) : null;
  const history = historyQuality(args.history);

  const declaredReliabilityScore = reliability === null ? null : Math.round(reliability * 80);
  const sources: (number | null)[] = [];

  let quality: number;
  let source: QualityReport["source"];

  if (declared !== null) {
    quality = declared;
    source = "declared";
    notes.push(`declared quality ${declared}/100`);
  } else {
    let derived = completeness + (declaredReliabilityScore ?? 0) * 0.25;
    if (history !== null) {
      derived = derived * 0.6 + history * 0.4;
      source = "mixed";
      notes.push(`history: ${history}/100 from ${args.history?.usage ?? 0} executions`);
    } else {
      source = "derived";
      notes.push("no outcome history; derived from manifest surface");
    }
    quality = Math.round(Math.min(100, derived));
    if (declaredReliabilityScore !== null) notes.push(`declared reliability ${reliability}/1.0`);
  }
  if (history !== null) sources.push(history);
  if (declared !== null) sources.push(declared);

  const verdict: QualityReport["verdict"] = quality >= 85 ? "excellent" : quality >= 65 ? "good" : quality >= 45 ? "adequate" : quality >= 25 ? "weak" : "minimal";

  return {
    id: capability.id,
    quality,
    dimensions: {
      completeness,
      declared,
      reliability: declaredReliabilityScore ?? 0,
      history,
    },
    verdict,
    source,
    notes: notes.slice(0, 5),
  };
}

/**
 * Registry-wide analysis (PRD §4.4): ranks all capabilities by quality and
 * flags those whose quality is only propped up by one dimension.
 */
export function analyzeRegistry(capabilities: Capability[], histories: Map<string, OutcomeSummary> = new Map()): {
  reports: QualityReport[];
  ranking: QualityReport[];
} {
  const reports = capabilities.map((c) => analyzeCapabilityQuality(c, { history: histories.get(c.id) }));
  const ranking = [...reports].sort((a, b) => b.quality - a.quality || a.id.localeCompare(b.id));
  return { reports, ranking };
}