import type { MetricsRow, Storage } from "../storage/types.ts";
import { globalBus } from "../core/events.ts";

/** Ceiling on retained observations per capability (PRD §22: bounded updates). */
export const MAX_OBSERVATIONS = 1000;

/**
 * Pure update function: increments success/failure counts and, once the
 * observation window exceeds MAX_OBSERVATIONS, halves every counter. Halving
 * preserves the observed success rate while giving recent observations
 * exponentially more influence than old ones, so a handful of executions can
 * never single-handedly distort ranking.
 */
export function updateMetrics(current: MetricsRow | null, ok: boolean, now = new Date().toISOString()): MetricsRow {
  let tasks = (current?.tasks ?? 0) + 1;
  let successes = current?.successes ?? 0;
  let failures = current?.failures ?? 0;
  if (ok) successes += 1;
  else failures += 1;
  if (tasks > MAX_OBSERVATIONS) {
    tasks = Math.ceil(tasks / 2);
    successes = Math.ceil(successes / 2);
    failures = Math.ceil(failures / 2);
  }
  return {
    capabilityId: current?.capabilityId ?? "",
    tasks,
    successes,
    failures,
    lastUpdated: now,
  };
}

/** Observed success rate in [0, 1]; 0 when there are no observations. */
export function successRate(metrics: MetricsRow): number {
  return metrics.tasks === 0 ? 0 : metrics.successes / metrics.tasks;
}

/** Fresh reliability: the rate plus how representative it is. */
export interface ReliabilityEstimate {
  rate: number;
  tasks: number;
  confidence: "low" | "medium" | "high";
}

export function estimate(metrics: MetricsRow | null): ReliabilityEstimate | null {
  if (!metrics || metrics.tasks === 0) return null;
  const rate = successRate(metrics);
  const confidence: ReliabilityEstimate["confidence"] = metrics.tasks < 10 ? "low" : metrics.tasks < 50 ? "medium" : "high";
  return { rate, tasks: metrics.tasks, confidence };
}

/**
 * ReliabilityEngine — the recording side of the learning loop. It owns the
 * bounded update policy, keeps the audit trail honest by emitting a typed
 * event per observation, and offers read paths for the router (fresh rate)
 * and the CLI (snapshots).
 */
export class ReliabilityEngine {
  private readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async record(capabilityId: string, ok: boolean, context?: string): Promise<MetricsRow> {
    if (!capabilityId) throw new Error("record(): capabilityId is required");
    const current = await this.storage.getMetrics(capabilityId);
    const next = updateMetrics(current, ok);
    next.capabilityId = capabilityId;
    await this.storage.setMetrics(next);
    globalBus.emit({
      event: "metrics.updated",
      capabilityId,
      successRate: Math.round(successRate(next) * 1000) / 1000,
      ok: ok ? "success" : "failure",
      context: context ?? null,
    });
    return next;
  }

  /** Fresh success rate (0..1) or null when there are no observations. */
  async freshRateOf(capabilityId: string): Promise<number | null> {
    const row = await this.storage.getMetrics(capabilityId);
    if (!row || row.tasks === 0) return null;
    return successRate(row);
  }

  async snapshot(): Promise<MetricsRow[]> {
    return await this.storage.allMetrics();
  }
}