import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/router/index.ts";
import type { RouteContext, CapabilityScore } from "../../src/router/types.ts";
import { mockCapabilities, mockInstalled } from "../../src/utils/mockdata.ts";
import { DEFAULT_CONFIG } from "../../src/config/config.ts";
import type { Capability } from "../../src/core/types.ts";
import type { MetricsRow } from "../../src/storage/types.ts";

function context(task: string, capabilities: Capability[], metrics?: Map<string, MetricsRow>): RouteContext {
  return {
    task,
    cwd: "/tmp",
    project: null,
    git: null,
    capabilities,
    installed: mockInstalled(),
    agents: ["opencode"],
    config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
    metrics,
  };
}

function makeMetrics(overrides: Array<[string, Partial<MetricsRow>]>): Map<string, MetricsRow> {
  const map = new Map<string, MetricsRow>();
  for (const [id, over] of overrides) {
    map.set(id, { capabilityId: id, tasks: 100, successes: 50, failures: 50, lastUpdated: "2026-08-19T00:00:00.000Z", ...over });
  }
  return map;
}

function scoreOf(scores: CapabilityScore[], id: string): CapabilityScore {
  const found = scores.find((s) => s.capability.id === id);
  assert.ok(found, `expected ${id} in scores`);
  return found;
}

function historicalSignal(scores: CapabilityScore[], id: string) {
  return scoreOf(scores, id).signals.find((s) => s.type === "historical");
}

function twinCapabilities(): Capability[] {
  const base = (id: string): Capability => ({
    id,
    name: "Test Suite Writer",
    version: "1.0.0",
    type: "skill",
    schema: "skillrouter/v1",
    description: "Writes unit tests for JavaScript projects",
    manifestPath: `${id}.yaml`,
    compatibility: { opencode: "native" },
    triggers: { keywords: ["test", "spec", "coverage"] },
    context: { estimatedTokens: 800 },
    trust: "unknown",
  });
  // Identical twins except for id; alphabetical order without metrics favors a-beta.
  return [base("z-alpha-tests"), base("a-beta-tests")];
}

test("fresh metrics override the declared success rate in scoring", async () => {
  const router = new Router();
  const caps = mockCapabilities().map((c) =>
    c.id === "cap:test-writer" ? { ...c, metadata: { ...c.metadata, successRate: 90 } } : c,
  );

  const declared = await router.route(context("write unit tests", caps));
  const declaredSignal = historicalSignal(declared.scores, "cap:test-writer");
  assert.ok(declaredSignal, "declared successRate produces an historical signal");
  assert.match(declaredSignal!.text, /declared success rate 90%/);

  const fresh = await router.route(context("write unit tests", caps, makeMetrics([["cap:test-writer", { successes: 15, failures: 85 }]])));
  const freshSignal = historicalSignal(fresh.scores, "cap:test-writer");
  assert.ok(freshSignal, "fresh metrics produce an historical signal");
  assert.match(freshSignal!.text, /15% \(100 observations\)/);
});

test("no metrics and no declared rate leave the historical factor silent", async () => {
  const router = new Router();
  const decision = await router.route(context("write unit tests", mockCapabilities()));
  const signal = historicalSignal(decision.scores, "cap:test-writer");
  assert.equal(signal, undefined);
});

test("fresh metrics flip the ranking of otherwise identical capabilities", async () => {
  const router = new Router();
  const caps = twinCapabilities();

  const withoutMetrics = await router.route(context("write test coverage", caps));
  assert.equal(withoutMetrics.scores[0]!.capability.id, "a-beta-tests");

  const withMetrics = await router.route(
    context(
      "write test coverage",
      caps,
      makeMetrics([
        ["z-alpha-tests", { successes: 95, failures: 5 }],
        ["a-beta-tests", { successes: 5, failures: 95 }],
      ]),
    ),
  );
  assert.equal(withMetrics.scores[0]!.capability.id, "z-alpha-tests");

  const alphaHistorical = historicalSignal(withMetrics.scores, "z-alpha-tests");
  assert.match(alphaHistorical!.text, /95% \(100 observations\)/);
});

test("reliability differences break ties at the planner threshold", async () => {
  const router = new Router();
  const caps = twinCapabilities();
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as typeof DEFAULT_CONFIG;
  config.router.threshold = 40;
  config.router.maxActivations = 1;
  config.router.always = [];
  const base = { ...context("write test coverage", caps), config };

  const noMetrics = await router.route(base);
  const activations = noMetrics.plan.filter((p) => p.action === "activate" || p.action === "keep").map((p) => p.capabilityId);
  assert.deepEqual(activations, ["a-beta-tests"]);

  const withMetrics = await router.route({
    ...base,
    metrics: makeMetrics([
      ["z-alpha-tests", { successes: 95, failures: 5 }],
      ["a-beta-tests", { successes: 5, failures: 95 }],
    ]),
  });
  const boosted = withMetrics.plan.filter((p) => p.action === "activate" || p.action === "keep").map((p) => p.capabilityId);
  assert.deepEqual(boosted, ["z-alpha-tests"]);
});