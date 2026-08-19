import type { Capability, TrustLevel } from "../core/types.ts";
import type { MetricsRow } from "../storage/types.ts";
import { successRate } from "./metrics.ts";
import type { OutcomeSummary } from "./outcomes.ts";
import { computeRisk } from "../security/risk.ts";

/**
 * Dynamic capability reputation (PRD §23). Everything is derived from
 * deterministic aggregates plus the bounded outcome history; reputation can
 * influence ranking but never bypasses security policy or hard constraints.
 */
export interface Reputation {
  capabilityId: string;
  usage: number;
  reliability: number;
  successRate: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  verificationRate: number | null;
  freshness: number;
  userRating: number | null;
  securityScore: number;
  trust: TrustLevel;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Freshness decays from 1 (seen today) toward 0 over 90 days of silence. */
const FRESHNESS_HALF_LIFE_MS = 30 * DAY_MS;

export function freshness(lastSeen: string | null, now = Date.now()): number {
  if (!lastSeen) return 0;
  const age = Math.max(0, now - Date.parse(lastSeen));
  return Math.max(0, Math.min(1, Math.pow(0.5, age / FRESHNESS_HALF_LIFE_MS)));
}

export interface ReputationInput {
  metrics: MetricsRow | null;
  summary: OutcomeSummary | null;
  capability?: Capability;
}

/**
 * Builds a reputation snapshot for one capability.
 *
 * - reliability: observed success rate, falling back to declared
 *   metadata.successRate / metadata.reliability, then to the trust floor.
 * - securityScore: 1 - risk.score/100 (the risk engine's deterministic score).
 */
export function buildReputation(input: ReputationInput): Reputation {
  const { metrics, summary, capability } = input;
  const declaredRate = capability?.metadata?.successRate;
  const declaredReliability = capability?.metadata?.reliability;

  let reliability: number;
  const source: "observed" | "declared" | "trust" =
    metrics && metrics.tasks > 0 ? "observed" : declaredRate !== undefined ? "declared" : declaredReliability !== undefined ? "declared" : "trust";
  if (source === "observed") reliability = successRate(metrics!);
  else if (declaredRate !== undefined) reliability = declaredRate / 100;
  else if (declaredReliability !== undefined) reliability = declaredReliability;
  else reliability = capability?.trust === "verified" ? 0.9 : capability?.trust === "trusted" ? 0.8 : capability?.trust === "community" ? 0.6 : 0.3;

  const riskScore = capability ? computeRisk(capability).score : 0;

  return {
    capabilityId: input.metrics?.capabilityId ?? summary?.capabilityId ?? capability?.id ?? "",
    usage: metrics?.tasks ?? summary?.usage ?? 0,
    reliability,
    successRate: summary?.successRate ?? (metrics && metrics.tasks > 0 ? successRate(metrics) : null) ?? 0,
    avgLatencyMs: summary?.avgLatencyMs ?? null,
    p95LatencyMs: summary?.p95LatencyMs ?? null,
    verificationRate: summary?.verificationRate ?? null,
    freshness: freshness(summary?.lastSeen ?? metrics?.lastUpdated ?? null),
    userRating: summary?.avgRating ?? null,
    securityScore: Math.max(0, Math.min(1, 1 - riskScore / 100)),
    trust: capability?.trust ?? "unknown",
  };
}

/** Reputation plus the summary it was computed from (for tooltips/explanations). */
export interface ReputationReport extends Reputation {
  summary: OutcomeSummary | null;
}

/** Builds reports for every capability that has observations. */
export function buildReports(
  metricsRows: MetricsRow[],
  summaries: Map<string, OutcomeSummary>,
  byId: Map<string, Capability>,
): ReputationReport[] {
  const seen = new Set<string>();
  const reports: ReputationReport[] = [];
  for (const metrics of metricsRows) {
    if (metrics.tasks === 0) continue;
    seen.add(metrics.capabilityId);
    const summary = summaries.get(metrics.capabilityId) ?? null;
    reports.push({ ...buildReputation({ metrics, summary, capability: byId.get(metrics.capabilityId) }), summary });
  }
  for (const [id, summary] of summaries) {
    if (seen.has(id)) continue;
    reports.push({ ...buildReputation({ metrics: null, summary, capability: byId.get(id) }), summary });
  }
  reports.sort((a, b) => b.reliability - a.reliability || b.usage - a.usage || a.capabilityId.localeCompare(b.capabilityId));
  return reports;
}