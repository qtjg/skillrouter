import type { SkillOutcomeRow, Storage } from "../storage/types.ts";
import { globalBus } from "../core/events.ts";
import { randomId } from "../router/planner.ts";
import { ReliabilityEngine } from "./metrics.ts";

/**
 * Per-execution outcomes (PRD §22). Unlike the bounded aggregate counters in
 * `metrics.ts`, outcomes keep raw latency/verification/rating observations so
 * the reputation layer can compute averages, percentiles and verification
 * rates. History stays bounded: `maxOutcomes` rows per capability.
 */
export interface RecordOutcomeInput {
  capabilityId: string;
  task?: string;
  success: boolean;
  latencyMs?: number | null;
  verification?: "pass" | "fail" | null;
  rating?: number | null;
  executionId?: string;
  context?: string | null;
}

export interface OutcomeSummary {
  capabilityId: string;
  usage: number;
  successRate: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  verificationRate: number | null;
  avgRating: number | null;
  lastSeen: string | null;
}

function clampRating(value: number): number {
  return Math.max(-2, Math.min(2, Math.round(value)));
}

/** Deterministic summary of a capability's outcomes. */
export function summarizeOutcomes(rows: SkillOutcomeRow[]): OutcomeSummary | null {
  if (rows.length === 0) return null;
  const latencies = rows
    .flatMap((r) => (r.latencyMs !== null && r.latencyMs !== undefined ? [r.latencyMs] : []))
    .sort((a, b) => a - b);
  const verified = rows.filter((r) => r.verification === "pass").length;
  const verifiable = rows.filter((r) => r.verification !== null).length;
  const rated = rows.flatMap((r) => (r.rating !== null && r.rating !== undefined ? [r.rating] : []));
  const p95 = percentile95(latencies);
  let lastSeen = "";
  for (const row of rows) {
    if (row.ts > lastSeen) lastSeen = row.ts;
  }

  return {
    capabilityId: rows[0]!.capabilityId,
    usage: rows.length,
    successRate: rows.filter((r) => r.success).length / rows.length,
    avgLatencyMs: latencies.length > 0 ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10 : null,
    p95LatencyMs: p95 === null ? null : Math.round(p95 * 10) / 10,
    verificationRate: verifiable > 0 ? verified / verifiable : null,
    avgRating: rated.length > 0 ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 100) / 100 : null,
    lastSeen,
  };
}

/** 95th percentile of sorted latencies; null when empty. */
export function percentile95(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[Math.max(0, index)]!;
}

/**
 * OutcomeStore — the feedback-recording side of the learning loop. Each
 * outcome updates the aggregate metrics (via ReliabilityEngine, keeping one
 * bounded source of success-rate truth) and appends the raw outcome row.
 */
export class OutcomeStore {
  private readonly storage: Storage;
  private readonly maxOutcomes: number;

  constructor(storage: Storage, maxOutcomes = 1000) {
    this.storage = storage;
    this.maxOutcomes = Math.max(1, Math.min(10000, Math.floor(maxOutcomes)));
  }

  async record(input: RecordOutcomeInput): Promise<SkillOutcomeRow> {
    if (!input.capabilityId) throw new Error("record(): capabilityId is required");
    const now = new Date().toISOString();
    const outcome: SkillOutcomeRow = {
      executionId: input.executionId ?? `x-${randomId().slice(2)}`,
      capabilityId: input.capabilityId,
      task: input.task ?? "",
      success: input.success,
      latencyMs: input.latencyMs ?? null,
      verification: input.verification ?? null,
      rating: input.rating === null || input.rating === undefined ? null : clampRating(input.rating),
      ts: now,
      context: input.context ?? null,
    };

    const metricsEngine = new ReliabilityEngine(this.storage);
    const next = await metricsEngine.record(outcome.capabilityId, outcome.success, outcome.task || undefined);
    await this.storage.addSkillOutcome(outcome);
    await this.storage.pruneSkillOutcomes(outcome.capabilityId, this.maxOutcomes);

    globalBus.emit({
      event: "feedback.received",
      executionId: outcome.executionId,
      capabilityId: outcome.capabilityId,
      success: outcome.success,
      latencyMs: outcome.latencyMs,
      verification: outcome.verification,
      rating: outcome.rating,
      observations: next.tasks,
    });
    return outcome;
  }

  /** Summaries for every capability with recorded outcomes. */
  async summaries(perCapabilityLimit?: number): Promise<Map<string, OutcomeSummary>> {
    const rows = await this.storage.recentSkillOutcomes(perCapabilityLimit ?? this.maxOutcomes);
    const byCapability = new Map<string, SkillOutcomeRow[]>();
    for (const row of rows) {
      const list = byCapability.get(row.capabilityId) ?? [];
      list.push(row);
      byCapability.set(row.capabilityId, list);
    }
    const out = new Map<string, OutcomeSummary>();
    for (const [id, list] of byCapability) {
      const summary = summarizeOutcomes(list);
      if (summary) out.set(id, summary);
    }
    return out;
  }

  async summaryOf(capabilityId: string): Promise<OutcomeSummary | null> {
    const rows = await this.storage.recentSkillOutcomes(this.maxOutcomes);
    const own = rows.filter((r) => r.capabilityId === capabilityId);
    return summarizeOutcomes(own);
  }
}