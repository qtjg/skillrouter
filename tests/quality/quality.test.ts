import { test } from "node:test";
import assert from "node:assert/strict";
import type { Capability } from "../../src/core/types.ts";
import { analyzeCapabilityQuality, completenessOf, historyQuality, analyzeRegistry } from "../../src/quality/analyzer.ts";

function cap(id: string, overrides: Partial<Capability> = {}): Capability {
  return {
    id,
    name: `Cap ${id}`,
    version: "1.0.0",
    description: "Does the thing cap does for you",
    type: "skill",
    compatibility: { opencode: "native" },
    ...overrides,
  };
}

test("declared metadata.quality is authoritative", () => {
  const report = analyzeCapabilityQuality(cap("a", { metadata: { quality: 92 } }));
  assert.equal(report.quality, 92);
  assert.equal(report.source, "declared");
  assert.equal(report.verdict, "excellent");
});

test("bare capability derives quality from manifest surface", () => {
  const bareReport = analyzeCapabilityQuality(cap("a", { description: "" }));
  assert.equal(bareReport.source, "derived");
  assert.equal(bareReport.quality, 0, "an empty manifest is worth zero surface quality");
  assert.equal(bareReport.verdict, "minimal");
  const rich = analyzeCapabilityQuality(
    cap("a", {
      description: "Very long description that explains everything a capability does in enough detail to fill eighty characters.",
      triggers: { keywords: ["deploy"], intents: ["devops"] },
      permissions: { filesystem: { read: true, write: false }, shell: { enabled: true, allow: ["docker"] } },
      risk: { declared: "medium", score: 40 },
      dependencies: [{ id: "docker" }],
      fallbacks: ["other"],
      metadata: { license: "MIT", author: "maya", repository: "https://example.com/a", cost: 2, latency: 100 },
    }),
  );
  assert.ok(rich.quality > 60, `expected rich manifest to score high, got ${rich.quality}`);
  assert.ok(["good", "excellent"].includes(rich.verdict), `expected strong verdict, got ${rich.verdict}`);
});

test("outcome history blends into derived quality (mixed)", () => {
  const summary = { capabilityId: "a", usage: 80, successRate: 0.9, avgLatencyMs: 100, p95LatencyMs: 150, verificationRate: 1, avgRating: 1.5, lastSeen: "2026-08-01" };
  assert.ok(historyQuality(summary)! > 60, "high success rate with coverage must score well");
  assert.equal(historyQuality({ ...summary, usage: 0 }), null);

  const report = analyzeCapabilityQuality(cap("a"), { history: summary });
  assert.equal(report.source, "mixed");
  assert.ok(report.dimensions.history !== null);
  assert.ok(report.quality >= report.dimensions.completeness);
});

test("completeness scoring scales with description length", () => {
  const short = completenessOf(cap("a", { description: "short" }), undefined);
  const medium = completenessOf(cap("a", { description: "A description long enough to be considered reasonable." }), undefined);
  assert.ok(medium > short);
});

test("analyzeRegistry ranks by quality with deterministic tie-break", () => {
  const caps = [cap("b", { metadata: { quality: 70 } }), cap("a", { metadata: { quality: 70 } }), cap("c")];
  const { ranking } = analyzeRegistry(caps);
  assert.deepEqual(ranking.map((r) => r.id), ["a", "b", "c"]);
  assert.equal(ranking[0]!.quality, 70);
  assert.equal(ranking[2]!.source, "derived");
});