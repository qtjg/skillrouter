import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReputation, buildReports, freshness } from "../../src/learning/reputation.ts";
import type { MetricsRow } from "../../src/storage/types.ts";
import type { OutcomeSummary } from "../../src/learning/outcomes.ts";
import type { Capability, TrustLevel } from "../../src/core/types.ts";

const NOW = new Date().toISOString();

function cap(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "cap:demo",
    name: "Demo",
    description: "demo capability",
    version: "1.0.0",
    type: "skill",
    compatibility: { opencode: "native" },
    permissions: { filesystem: { read: false, write: false }, network: { allowed: [] }, shell: { enabled: false } },
    risk: { declared: "low", score: 10 },
    metadata: { tags: [], categories: [] },
    trust: "verified",
    source: { type: "catalog", location: "builtin", catalog: "tests" },
    ...overrides,
  };
}

function metrics(overrides: Partial<MetricsRow> = {}): MetricsRow {
  return { capabilityId: "cap:demo", tasks: 20, successes: 19, failures: 1, lastUpdated: NOW, ...overrides };
}

function summary(overrides: Partial<OutcomeSummary> = {}): OutcomeSummary {
  return {
    capabilityId: "cap:demo",
    usage: 20,
    successRate: 0.95,
    avgLatencyMs: 800,
    p95LatencyMs: 1500,
    verificationRate: 0.9,
    avgRating: 1,
    lastSeen: NOW,
    ...overrides,
  };
}

test("freshness decays with a 30-day half life and is 0 without a timestamp", () => {
  assert.equal(freshness(null), 0);
  const now = Date.parse(NOW);
  assert.equal(freshness(NOW, now), 1);
  const monthLater = now + 30 * 24 * 60 * 60 * 1000;
  assert.ok(Math.abs(freshness(NOW, monthLater) - 0.5) < 0.001);
  assert.ok(freshness(NOW, now + 10 * 365 * 24 * 60 * 60 * 1000) < 1e-9);
});

test("buildReputation prefers observed reliability over declared successRate and trust floor", () => {
  const observed = buildReputation({ metrics: metrics(), summary: null, capability: cap() });
  assert.equal(observed.reliability, 19 / 20);
  assert.equal(observed.usage, 20);
  assert.equal(observed.successRate, 19 / 20, "success rate backfills from the aggregate metrics");

  const declared = buildReputation({ metrics: null, summary: null, capability: cap({ metadata: { tags: [], categories: [], successRate: 80 } }) });
  assert.equal(declared.reliability, 0.8);

  const trustFloor = buildReputation({ metrics: null, summary: null, capability: cap({ trust: "unknown" as TrustLevel }) });
  assert.equal(trustFloor.reliability, 0.3);
  const verifiedFloor = buildReputation({ metrics: null, summary: null, capability: cap({ trust: "verified" }) });
  assert.equal(verifiedFloor.reliability, 0.9);
});

test("buildReputation carries outcome aggregates and computes security score from risk", () => {
  const report = buildReputation({ metrics: metrics(), summary: summary(), capability: cap() });
  assert.equal(report.successRate, 0.95);
  assert.equal(report.avgLatencyMs, 800);
  assert.equal(report.p95LatencyMs, 1500);
  assert.equal(report.verificationRate, 0.9);
  assert.equal(report.userRating, 1);
  assert.ok(report.freshness > 0.99);
  assert.equal(report.trust, "verified");

  const dangerous = cap({ permissions: { filesystem: { read: true, write: true }, network: { allowed: ["*"] }, shell: { enabled: true } } });
  const risky = buildReputation({ metrics: metrics(), summary: summary(), capability: dangerous });
  assert.ok(risky.securityScore < 0.6, "high-risk permissions lower the security score");
});

test("buildReports includes capability-level metrics without summaries and sorts by reliability", () => {
  const rows: MetricsRow[] = [
    metrics({ capabilityId: "cap:a", tasks: 5, successes: 3 }),
    metrics({ capabilityId: "cap:b", tasks: 50, successes: 49 }),
  ];
  const summaries = new Map<string, OutcomeSummary>([["cap:b", summary({ capabilityId: "cap:b", usage: 50 })] as [string, OutcomeSummary]]);
  const byId = new Map<string, Capability>([
    ["cap:a", cap({ id: "cap:a", trust: "community" })],
    ["cap:b", cap({ id: "cap:b", trust: "verified" })],
  ]);
  const reports = buildReports(rows, summaries, byId);
  assert.equal(reports.length, 2);
  assert.equal(reports[0]!.capabilityId, "cap:b");
  assert.equal(reports[0]!.verificationRate, 0.9);
  assert.equal(reports[1]!.capabilityId, "cap:a");
  assert.ok(reports[1]!.summary === null);
});