import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteStorage } from "../../src/storage/sqlite.ts";
import { OutcomeStore, summarizeOutcomes, percentile95, type OutcomeSummary } from "../../src/learning/outcomes.ts";
import { successRate } from "../../src/learning/metrics.ts";
import { globalBus } from "../../src/core/events.ts";
import type { SkillOutcomeRow } from "../../src/storage/types.ts";

function outcome(capabilityId: string, ts: string, overrides: Partial<SkillOutcomeRow> = {}): SkillOutcomeRow {
  return {
    executionId: `x-${capabilityId}-${ts}`,
    capabilityId,
    task: "deploy",
    success: true,
    latencyMs: 1000,
    verification: "pass",
    rating: 1,
    ts,
    context: null,
    ...overrides,
  };
}

test("percentile95 picks the 95th percentile deterministically", () => {
  assert.equal(percentile95([]), null);
  assert.equal(percentile95([100]), 100);
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];
  assert.equal(percentile95(sorted), 190);
});

test("summarizeOutcomes computes success, latency, verification and rating aggregates", () => {
  const rows = [
    outcome("cap:a", "2026-08-19T10:00:00.000Z", { success: true, latencyMs: 100, verification: "pass", rating: 1 }),
    outcome("cap:a", "2026-08-19T10:01:00.000Z", { success: true, latencyMs: 200, verification: "fail", rating: 0 }),
    outcome("cap:a", "2026-08-19T10:02:00.000Z", { success: false, latencyMs: 4000, verification: null, rating: -2 }),
  ];
  const summary = summarizeOutcomes(rows)!;
  assert.equal(summary.usage, 3);
  assert.equal(summary.successRate, 2 / 3);
  assert.equal(summary.avgLatencyMs, 1433.3);
  assert.equal(summary.p95LatencyMs, 4000);
  assert.equal(summary.verificationRate, 0.5);
  assert.equal(summary.avgRating, -0.33);
  assert.equal(summary.lastSeen, "2026-08-19T10:02:00.000Z");
});

test("summarizeOutcomes returns null for empty input and handles missing fields", () => {
  assert.equal(summarizeOutcomes([]), null);
  const sparse = summarizeOutcomes([outcome("cap:a", "2026-08-19T10:00:00.000Z", { latencyMs: null, verification: null, rating: null })])!;
  assert.equal(sparse.avgLatencyMs, null);
  assert.equal(sparse.p95LatencyMs, null);
  assert.equal(sparse.verificationRate, null);
  assert.equal(sparse.avgRating, null);
});

test("OutcomeStore records outcomes, aggregates metrics and emits feedback.received", async () => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  const feedback: string[] = [];
  const off = globalBus.on<{ event: "feedback.received"; executionId: string; capabilityId: string; success: boolean; latencyMs: number | null; verification: "pass" | "fail" | null; rating: number | null; observations: number }>("feedback.received", (e) => feedback.push(`${e.capabilityId}:${e.success}:${e.latencyMs}`));
  try {
    const store = new OutcomeStore(storage, 100);
    const row = await store.record({ capabilityId: "cap:a", task: "deploy", success: true, latencyMs: 250, verification: "pass", rating: 1, executionId: "x-1" });
    assert.equal(row.executionId, "x-1");
    const metrics = await storage.getMetrics("cap:a");
    assert.equal(metrics?.tasks, 1);
    assert.equal(successRate(metrics!), 1);
    const stored = await storage.recentSkillOutcomes();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.verification, "pass");
    assert.equal(stored[0]!.rating, 1);
    assert.deepEqual(feedback, ["cap:a:true:250"]);
  } finally {
    off();
    storage.close();
  }
});

test("OutcomeStore clamps ratings and keeps history bounded per capability", async () => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  try {
    const store = new OutcomeStore(storage, 10);
    for (let i = 0; i < 25; i++) {
      await store.record({ capabilityId: "cap:b", task: `run ${i}`, success: i % 3 !== 0, latencyMs: 100 + i, rating: i === 0 ? 99 : i === 1 ? -99 : 0 });
    }
    const summaries = await store.summaries();
    const summary = summaries.get("cap:b");
    assert.ok(summary);
    assert.equal(summary!.usage, 10, "pruned to maxOutcomes");
    assert.equal(summaries.size, 1);

    const rows = await storage.recentSkillOutcomes(100);
    const ratings = rows.map((r) => r.rating).filter((r) => r !== null);
    assert.ok(ratings.every((r) => r! >= -2 && r! <= 2));
  } finally {
    storage.close();
  }
});

test("recentSkillOutcomes respects the per-capability limit across capabilities", async () => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  try {
    const store = new OutcomeStore(storage, 4);
    for (let i = 0; i < 6; i++) {
      await store.record({ capabilityId: "cap:x", success: true, task: `t${i}` });
      await store.record({ capabilityId: "cap:y", success: true, task: `t${i}` });
    }
    const rows = await storage.recentSkillOutcomes(4);
    const xRows = rows.filter((r) => r.capabilityId === "cap:x");
    const yRows = rows.filter((r) => r.capabilityId === "cap:y");
    assert.equal(xRows.length, 4);
    assert.equal(yRows.length, 4);
  } finally {
    storage.close();
  }
});

test("summaries groups by capability with newest rows winning", async () => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  try {
    const store = new OutcomeStore(storage, 100);
    await store.record({ capabilityId: "cap:a", success: true, latencyMs: 100 });
    await store.record({ capabilityId: "cap:a", success: false, latencyMs: 300 });
    await store.record({ capabilityId: "cap:b", success: true, latencyMs: 50 });
    const map = await store.summaries();
    assert.deepEqual([...map.keys()].sort(), ["cap:a", "cap:b"]);
    assert.equal(map.get("cap:a")!.avgLatencyMs, 200);
  } finally {
    storage.close();
  }
});