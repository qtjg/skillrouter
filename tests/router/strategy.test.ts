import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/router/index.ts";
import type { RouteContext, CapabilityScore } from "../../src/router/types.ts";
import { mockCapabilities, mockInstalled } from "../../src/utils/mockdata.ts";
import { DEFAULT_CONFIG, ROUTER_STRATEGIES } from "../../src/config/config.ts";
import type { Capability } from "../../src/core/types.ts";
import { weightsFor, W } from "../../src/router/factors.ts";
import { normalizeManifest, parseManifestYaml, validateManifest } from "../../src/manifest/validate.ts";

function context(task: string, capabilities: Capability[], strategy: string = "balanced"): RouteContext {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as typeof DEFAULT_CONFIG;
  config.router.strategy = strategy as typeof config.router.strategy;
  return {
    task,
    cwd: "/tmp",
    project: null,
    git: null,
    capabilities,
    installed: mockInstalled(),
    agents: ["opencode"],
    config,
  };
}

function scoreOf(scores: CapabilityScore[], id: string): CapabilityScore {
  const found = scores.find((s) => s.capability.id === id);
  assert.ok(found, `expected ${id} in scores`);
  return found;
}

test("strategy presets change weights without mutating the base set", () => {
  for (const strategy of ROUTER_STRATEGIES) {
    const w = weightsFor(strategy);
    assert.equal(w.keyword, strategy === "minimal" ? 8 : 12);
  }
  assert.ok(weightsFor("safe").permissionPenalty > weightsFor("balanced").permissionPenalty);
  assert.ok(weightsFor("cheap").costFactor > weightsFor("balanced").costFactor);
  assert.ok(weightsFor("speed").latencyFactor > weightsFor("balanced").latencyFactor);
  assert.deepEqual(weightsFor("balanced"), W);
});

test("safe strategy penalizes risky capabilities harder than balanced", async () => {
  const router = new Router();
  const balanced = await router.route(context("deploy the app to production", mockCapabilities(), "balanced"));
  const safe = await router.route(context("deploy the app to production", mockCapabilities(), "safe"));

  const deployerBalanced = scoreOf(balanced.scores, "cap:deployer").breakdown.permissionCost;
  const deployerSafe = scoreOf(safe.scores, "cap:deployer").breakdown.permissionCost;
  assert.ok(deployerSafe < deployerBalanced, `safe should penalize more (${deployerSafe} < ${deployerBalanced})`);
  assert.equal(balanced.strategy, "balanced");
  assert.equal(safe.strategy, "safe");
});

test("cheap strategy penalizes declared cost harder; speed penalizes latency", async () => {
  const caps = mockCapabilities().map((c) =>
    c.id === "cap:test-writer" ? { ...c, metadata: { ...c.metadata, cost: 4, latency: 3 } } : c,
  );
  const router = new Router();

  const balanced = scoreOf((await router.route(context("write unit tests", caps, "balanced"))).scores, "cap:test-writer");
  const cheap = scoreOf((await router.route(context("write unit tests", caps, "cheap"))).scores, "cap:test-writer");
  const speed = scoreOf((await router.route(context("write unit tests", caps, "speed"))).scores, "cap:test-writer");

  const costSignal = (s: CapabilityScore) => s.signals.find((sig) => sig.type === "cost")!;
  const latencySignal = (s: CapabilityScore) => s.signals.find((sig) => sig.type === "latency")!;

  assert.equal(costSignal(balanced)!.weight, -20); // 4 × costFactor 5
  assert.equal(costSignal(cheap)!.weight, -56); // 4 × costFactor 14
  assert.equal(latencySignal(balanced)!.weight, -15); // 3 × latencyFactor 5
  assert.equal(latencySignal(speed)!.weight, -42); // 3 × latencyFactor 14
});

test("declared reliability is the last-resort history proxy", async () => {
  const caps = mockCapabilities().map((c) =>
    c.id === "cap:test-writer" ? { ...c, metadata: { ...c.metadata, reliability: 0.92 } } : c,
  );
  const router = new Router();
  const decision = await router.route(context("write unit tests", caps));
  const signal = scoreOf(decision.scores, "cap:test-writer").signals.find((s) => s.type === "historical");
  assert.ok(signal);
  assert.match(signal!.text, /declared reliability 92%/);
});

test("strategy weight presets are applied by the router decision", async () => {
  const caps = mockCapabilities().map((c) =>
    c.id === "cap:test-writer" ? { ...c, metadata: { ...c.metadata, quality: 100 } } : c,
  );
  const router = new Router();
  const decision = await router.route(context("write unit tests", caps, "quality"));
  assert.equal(decision.strategy, "quality");
  const w = weightsFor("quality");
  assert.equal(scoreOf(decision.scores, "cap:test-writer").breakdown.quality, (100 / 100) * w.qualityFactor);
});