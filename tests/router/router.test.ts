import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/router/index.ts";
import type { CapabilityScore, RouteContext } from "../../src/router/types.ts";
import { mockCapabilities, mockInstalled } from "../../src/utils/mockdata.ts";
import { DEFAULT_CONFIG, type SkillRouterConfig } from "../../src/config/config.ts";
import { explainDecision, summarizeScores, findCapabilityScore } from "../../src/router/explainer.ts";
import { globalBus } from "../../src/core/events.ts";

function context(task: string, overrides: Partial<SkillRouterConfig> = {}): RouteContext {
  const config: SkillRouterConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (overrides.router) Object.assign(config.router, overrides.router);
  return {
    task,
    cwd: "/tmp",
    project: null,
    git: null,
    capabilities: mockCapabilities(),
    installed: mockInstalled(),
    agents: ["opencode"],
    config,
  };
}

test("route ranks the best-matching capability first", async () => {
  const router = new Router();
  const decision = await router.route(context("write unit tests for the new API endpoint"));
  const top = decision.scores[0]!;
  assert.equal(top.capability.id, "cap:test-writer");
  const entry = findCapabilityScore(decision, "cap:test-writer");
  assert.ok(entry);
  assert.ok(entry.score > 40);
  const actives = decision.plan.filter((p) => p.action === "keep" || p.action === "activate");
  assert.ok(actives.some((p) => p.capabilityId === "cap:test-writer"));
  assert.ok(decision.decisionId.startsWith("d-"));
  assert.equal(decision.mode, "assisted");
});

test("route with high threshold deactivates the active capability", async () => {
  const router = new Router();
  const ctx = context("deploy the docker image to production", {
    router: { ...DEFAULT_CONFIG.router, threshold: 90 },
  });
  const decision = await router.route(ctx);
  const deactivation = decision.plan.find((p) => p.capabilityId === "cap:test-writer");
  assert.ok(deactivation);
  assert.equal(deactivation.action, "deactivate");
});

test("route honors always and never configuration", async () => {
  const router = new Router();
  const always = await router.route(
    context("optimize the landing page", {
      router: { ...DEFAULT_CONFIG.router, always: ["cap:docs-writer"] },
    }),
  );
  const docs = always.plan.find((p) => p.capabilityId === "cap:docs-writer");
  assert.ok(docs);
  assert.equal(docs.action, "activate");

  const never = await router.route(
    context("design a new component", {
      router: { ...DEFAULT_CONFIG.router, never: ["cap:ui-design"] },
    }),
  );
  assert.equal(never.plan.find((p) => p.capabilityId === "cap:ui-design"), undefined);
});

test("route emits router.decided on the global bus", async () => {
  globalBus.clear();
  const router = new Router();
  const decision = await router.route(context("audit our dependencies for vulnerabilities"));
  const seen = globalBus.getHistory().filter((e) => e.event === "router.decided");
  assert.equal(seen.length, 1);
  const decided = seen[0]!;
  if (decided.event === "router.decided") {
    assert.equal(decided.decisionId, decision.decisionId);
  }
});

test("explainDecision summarizes plan and context", async () => {
  const router = new Router();
  const decision = await router.route(context("write unit tests for the API"));
  const explained = explainDecision(decision);
  assert.equal(explained.task, decision.task);
  assert.ok(explained.context.budget > 0);
  assert.ok(Array.isArray(explained.activations) && Array.isArray(explained.deactivations));
  const summary = summarizeScores(decision, 3);
  assert.ok(summary.length <= 3);
  assert.ok(summary.every((s) => typeof s.score === "number" && typeof s.risk === "string"));
});

test("route is deterministic for equal inputs", async () => {
  const router = new Router();
  const first = await router.route(context("refactor the css into components"));
  const second = await router.route(context("refactor the css into components"));
  assert.deepEqual(first.scores.map((s) => [s.capability.id, s.score]), second.scores.map((s) => [s.capability.id, s.score]));
  assert.deepEqual(
    first.plan.map((p) => [p.capabilityId, p.action]),
    second.plan.map((p) => [p.capabilityId, p.action]),
  );
});