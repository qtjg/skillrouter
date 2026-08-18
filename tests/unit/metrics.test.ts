import { test } from "node:test";
import assert from "node:assert/strict";
import { SqliteStorage } from "../../src/storage/sqlite.ts";
import { ReliabilityEngine, updateMetrics, successRate, estimate, MAX_OBSERVATIONS } from "../../src/learning/metrics.ts";
import { globalBus } from "../../src/core/events.ts";
import type { MetricsRow } from "../../src/storage/types.ts";

test("updateMetrics counts successes and failures", () => {
  const first = updateMetrics(null, true);
  assert.deepEqual(first, { capabilityId: "", tasks: 1, successes: 1, failures: 0, lastUpdated: first.lastUpdated });
  const second = updateMetrics(first, false);
  assert.deepEqual(second, { capabilityId: "", tasks: 2, successes: 1, failures: 1, lastUpdated: second.lastUpdated });
});

test("updateMetrics stays bounded once the window is exceeded", () => {
  let current: MetricsRow | null = null;
  for (let i = 0; i < MAX_OBSERVATIONS + 100; i++) {
    current = updateMetrics(current, i % 2 === 0);
  }
  assert.ok(current!.tasks <= MAX_OBSERVATIONS);
  assert.equal(current!.tasks, current!.successes + current!.failures);
});

test("halving preserves the success rate approximately", () => {
  let current: MetricsRow | null = null;
  const overall = { successes: 0, failures: 0 };
  for (let i = 0; i < MAX_OBSERVATIONS + 300; i++) {
    const ok = i % 4 !== 0;
    current = updateMetrics(current, ok);
    if (ok) overall.successes += 1;
    else overall.failures += 1;
  }
  const overallRate = overall.successes / (overall.successes + overall.failures);
  assert.ok(Math.abs(successRate(current!) - overallRate) < 0.02, `rate ${successRate(current!)} vs ${overallRate}`);
});

test("successRate and estimate reflect observations", () => {
  const metrics = updateMetrics(updateMetrics(null, true), true);
  assert.equal(successRate(metrics), 1);
  assert.deepEqual(estimate(metrics), { rate: 1, tasks: 2, confidence: "low" });

  const medium = updateMetrics({ ...metrics, tasks: 20, successes: 15, failures: 5 }, true);
  assert.equal(estimate(medium)?.confidence, "medium");
  assert.equal(estimate(null), null);
});

test("ReliabilityEngine records, persists and emits events", async () => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  const events: string[] = [];
  const off = globalBus.on<{ event: "metrics.updated"; capabilityId: string; successRate: number; ok: "success" | "failure"; context: string | null }>(
    "metrics.updated",
    (e) => events.push(`${e.capabilityId}:${e.ok}`),
  );
  try {
    const engine = new ReliabilityEngine(storage);
    let row = await engine.record("cap:test-writer", true, "route #12");
    assert.equal(row.tasks, 1);
    assert.equal(row.successes, 1);
    assert.equal((await storage.getMetrics("cap:test-writer"))?.tasks, 1);

    row = await engine.record("cap:test-writer", false);
    assert.equal(row.tasks, 2);
    assert.equal(row.failures, 1);
    assert.equal(await engine.freshRateOf("cap:test-writer"), 0.5);

    await engine.record("cap:docs-writer", true);
    const snapshot = await engine.snapshot();
    assert.equal(snapshot.length, 2);
    assert.ok(snapshot.every((m) => m.lastUpdated.length > 0));
    assert.deepEqual(events, ["cap:test-writer:success", "cap:test-writer:failure", "cap:docs-writer:success"]);
    assert.equal(await engine.freshRateOf("cap:missing"), null);
  } finally {
    off();
    storage.close();
  }
});

test("ReliabilityEngine rejects empty capability ids", async () => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  try {
    const engine = new ReliabilityEngine(storage);
    await assert.rejects(() => engine.record("", true), /capabilityId is required/);
  } finally {
    storage.close();
  }
});

test("storage round-trips metrics rows through the public API", async () => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  try {
    assert.equal(await storage.getMetrics("nope"), null);
    assert.deepEqual(await storage.allMetrics(), []);
    await storage.setMetrics({ capabilityId: "cap:a", tasks: 3, successes: 2, failures: 1, lastUpdated: "2026-08-19T00:00:00.000Z" });
    assert.deepEqual(await storage.getMetrics("cap:a"), { capabilityId: "cap:a", tasks: 3, successes: 2, failures: 1, lastUpdated: "2026-08-19T00:00:00.000Z" });
    const snapshot = await storage.allMetrics();
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0]!.capabilityId, "cap:a");
  } finally {
    storage.close();
  }
});