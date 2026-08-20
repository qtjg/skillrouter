import { test } from "node:test";
import assert from "node:assert/strict";
import type { Capability } from "../../src/core/types.ts";
import { Router } from "../../src/router/index.ts";
import { explainDecision, rejectionReasons } from "../../src/router/explainer.ts";
import { DEFAULT_CONFIG } from "../../src/config/config.ts";
import type { RouteContext, CapabilityScore } from "../../src/router/types.ts";

function cap(id: string, overrides: Partial<Capability> = {}): Capability {
  return {
    id,
    name: "Deploy Helper",
    version: "1.0.0",
    description: "Deploys application stacks for you",
    type: "skill",
    compatibility: { opencode: "native" },
    triggers: { keywords: ["deploy"] },
    ...overrides,
  };
}

import { mockInstalled } from "../../src/utils/mockdata.ts";

function ctx(capabilities: Capability[], overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    task: "please deploy the application",
    cwd: "/tmp",
    project: null,
    git: null,
    capabilities,
    installed: mockInstalled(),
    agents: ["opencode"],
    config: JSON.parse(JSON.stringify({ ...DEFAULT_CONFIG, router: { ...DEFAULT_CONFIG.router, threshold: 45 } })),
    ...overrides,
  };
}

test("weaker near-duplicate is diluted below threshold; stronger one activates", async () => {
  const strong = cap("deploy-a", { metadata: { quality: 95 }, name: "Deploy Helper" });
  const weak = cap("deploy-b", { metadata: { quality: 30 }, name: "Deploy Helper" });
  const decision = await new Router().route(ctx([strong, weak]));
  const selected = decision.plan.filter((p) => p.action === "activate").map((p) => p.capabilityId);
  assert.deepEqual(selected, ["deploy-a"], "the better-evidenced clone wins the shared area");

  const weakScore = decision.scores.find((s) => s.capability.id === "deploy-b")!;
  const strongScore = decision.scores.find((s) => s.capability.id === "deploy-a")!;
  assert.ok(weakScore.signals.some((s) => s.type === "neighbor" && s.text.includes("deploy-a")), "weaker clone must carry a neighbor signal");
  assert.ok(!strongScore.signals.some((s) => s.type === "neighbor"), "winner is not diluted");

  const explanation = explainDecision(decision);
  const rejection = explanation.rejections.find((r) => r.id === "deploy-b");
  assert.ok(rejection, "diluted candidate shows as rejected in the trace");
  assert.ok(rejection!.reasons.some((r) => r.includes("deploy-a")), "rejection reason names the stronger neighbor");
});

test("no dilution when only one capability covers the area", async () => {
  const solo = cap("deploy-a", { metadata: { quality: 95 } });
  const other = cap("unrelated", { name: "Gardening Guide", description: "tends your garden", triggers: { keywords: ["plant"] } });
  const decision = await new Router().route(ctx([solo, other]));
  const deploy = decision.scores.find((s) => s.capability.id === "deploy-a")!;
  assert.ok(!deploy.signals.some((s) => s.type === "neighbor"), "unique capability must not be diluted");
  assert.equal(decision.scores.find((s) => s.capability.id === "deploy-a")!.score, deploy.score);
});

test("distinctiveness gate disabled by config leaves scores untouched", async () => {
  const strong = cap("deploy-a", { metadata: { quality: 95 } });
  const weak = cap("deploy-b", { metadata: { quality: 30 } });
  const config = JSON.parse(JSON.stringify({ ...DEFAULT_CONFIG, router: { ...DEFAULT_CONFIG.router, threshold: 25, distinctiveness: false } }));
  const decision = await new Router().route(ctx([strong, weak], { config }));
  const weakScore = decision.scores.find((s) => s.capability.id === "deploy-b")!;
  assert.ok(!weakScore.signals.some((s) => s.type === "neighbor"));
  assert.ok(decision.plan.filter((p) => p.action === "activate").map((p) => p.capabilityId).includes("deploy-b"), "weaker clone still eligible without dilution");
});

test("dilution never inflates a score and stays within bounds", async () => {
  const a = cap("deploy-a", { metadata: { quality: 90 } });
  const b = cap("deploy-b", { metadata: { quality: 40 } });
  const decision = await new Router().route(ctx([a, b]));
  for (const s of decision.scores) {
    const dilution = s.signals.filter((sig) => sig.type === "neighbor").reduce((sum, sig) => sum + sig.weight, 0);
    assert.ok(dilution <= 0, "neighbor signals only ever reduce");
    assert.ok(s.score >= 0 && s.score <= 100);
    if (dilution < 0) {
      assert.ok(s.signals.some((sig) => sig.type === "neighbor" && sig.weight === dilution), "signal weight matches the applied cut");
    }
  }
});

test("rejectionReasons picks up dilution text", () => {
  const score: CapabilityScore = {
    capability: cap("deploy-b"),
    score: 23,
    signals: [{ type: "neighbor" as const, weight: -8, text: "area shared with deploy-a (90% overlay, 40 vs 30); attention diluted" }],
    breakdown: {
      keyword: 12, taskSimilarity: 0, technology: 0, project: 0, git: 0, file: 0, dependency: 0,
      compatibility: 0, trust: 5, quality: 3, historical: 0, cost: 0, latency: 0, context: 0, preference: 0, contextCost: 0, permissionCost: 0, conflict: 0, negativeSignal: 0,
    },
    compatibility: "compatible",
    trust: "trusted",
    riskLevel: "low",
    conflictWith: null,
  };
  assert.ok(rejectionReasons(score).some((r) => r.includes("deploy-a")));
});