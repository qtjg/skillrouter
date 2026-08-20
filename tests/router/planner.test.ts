import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, defaultPlannerOptions, randomId } from "../../src/router/planner.ts";
import { resolveConflicts, findConflicts } from "../../src/router/conflicts.ts";
import type { CapabilityScore, PlanAction, TaskAnalysis } from "../../src/router/types.ts";
import type { Capability, CapabilityState } from "../../src/core/types.ts";

function score(id: string, value: number, overrides: Partial<Capability> = {}): CapabilityScore {
  const capability: Capability = {
    id,
    name: id,
    version: "1.0.0",
    description: id,
    type: "skill",
    schema: "skillrouter/v1",
    manifestPath: `${id}.yaml`,
    compatibility: { opencode: "compatible" },
    risk: { declared: "low", score: 10 },
    trust: "trusted",
    ...overrides,
  };
  return {
    capability,
    score: value,
    signals: [],
    breakdown: {
      keyword: 0, taskSimilarity: 0, technology: 0, project: 0, git: 0, file: 0, dependency: 0,
      compatibility: 0, trust: 0, quality: 0, historical: 0, cost: 0, latency: 0, context: 0, preference: 0, contextCost: 0, permissionCost: 0, conflict: 0, negativeSignal: 0,
    },
    compatibility: "compatible",
    trust: "trusted",
    riskLevel: "low",
    conflictWith: null,
  };
}

function analysisFor(task: string): TaskAnalysis {
  return {
    task,
    normalized: { tokens: new Set(), phrases: new Set() },
    tokens: [],
    technologies: [],
    domains: [],
    operations: ["implementation"],
    riskEstimate: "low",
  };
}

function planFor(scores: CapabilityScore[], options: Partial<ReturnType<typeof defaultPlannerOptions>>, installed: Array<[string, CapabilityState]> = []) {
  return buildPlan({
    task: analysisFor("t"),
    scores,
    installedStates: new Map(installed.map(([id, state]) => [id, { state, installed: true }])),
    options: defaultPlannerOptions(options),
  });
}

test("buildPlan selects above threshold and caps activations", () => {
  const scores = [score("low", 20), score("high-a", 90), score("high-b", 80)];
  const plan = planFor(scores, { threshold: 50, maxActivations: 1 });
  const activations = plan.filter((p) => p.action === "activate").map((p) => p.capabilityId);
  assert.deepEqual(activations, ["high-a"]);
  const lowEntry = plan.find((p) => p.capabilityId === "low");
  assert.ok(lowEntry);
  assert.equal(lowEntry.action, "keep-inactive");
});

test("buildPlan forces always entries and excludes never entries", () => {
  const scores = [score("forced", 5), score("blocked", 95), score("normal", 60)];
  const plan = planFor(scores, { always: ["forced"], never: ["blocked"] });
  assert.ok(plan.some((p) => p.capabilityId === "forced" && p.action === "activate"));
  assert.ok(!plan.some((p) => p.capabilityId === "blocked"));
  assert.ok(plan.some((p) => p.capabilityId === "normal" && p.action === "activate"));
});

test("buildPlan keeps active caps and deactivates irrelevant ones", () => {
  const scores = [score("keeper", 80), score("active-stale", 10)];
  const plan = planFor(scores, { threshold: 50 }, [["keeper", "ACTIVE"], ["active-stale", "ACTIVE"]]);
  const byId = new Map(plan.map((p) => [p.capabilityId, p.action]));
  assert.equal(byId.get("keeper"), "keep");
  assert.equal(byId.get("active-stale"), "deactivate");
});

test("buildPlan flags avoided entries keep-inactive", () => {
  const scores = [score("avoided", 80), score("wanted", 80)];
  const plan = planFor(scores, { avoid: ["avoided"] });
  assert.equal(plan.find((p) => p.capabilityId === "avoided")?.action, "keep-inactive");
});

test("buildPlan orders actions activate < keep < deactivate", () => {
  const scores = [score("stale", 20), score("keep-me", 90), score("go", 95)];
  const plan = planFor(scores, { threshold: 50 }, [["stale", "ACTIVE"], ["keep-me", "ACTIVE"]]);
  const order = plan.map((p) => p.action);
  assert.deepEqual(order, ["activate", "keep", "deactivate"]);
});

test("buildPlan marks confidence by score", () => {
  const plan = planFor([score("high", 88), score("mid", 55), score("low", 30)], { threshold: 0 });
  const highPlan: PlanAction = plan.find((p) => p.capabilityId === "high")!;
  const midPlan: PlanAction = plan.find((p) => p.capabilityId === "mid")!;
  const lowPlan: PlanAction = plan.find((p) => p.capabilityId === "low")!;
  assert.equal(highPlan.confidence, "high");
  assert.equal(midPlan.confidence, "medium");
  assert.equal(lowPlan.confidence, "low");
});

test("resolveConflicts drops the lower-scoring conflicting capability", () => {
  const a = score("conflictor", 70, { conflicts: ["conflictee"] });
  const b = score("conflictee", 60);
  const resolved = resolveConflicts([a, b]);
  assert.deepEqual(resolved.map((s) => s.capability.id), ["conflictor"]);
  assert.equal(resolved[0]?.conflictWith, null);
  assert.deepEqual(findConflicts([a, b]), [{ a: "conflictor", b: "conflictee" }]);
});

test("resolveConflicts keeps the higher-scoring conflicting capability", () => {
  const a = score("conflictor", 60, { conflicts: ["conflictee"] });
  const b = score("conflictee", 80);
  const resolved = resolveConflicts([a, b]);
  assert.deepEqual(resolved.map((s) => s.capability.id), ["conflictee"]);
  assert.equal(resolved[0]?.conflictWith, null);
});

test("randomId produces unique ids", () => {
  const ids = new Set(Array.from({ length: 100 }, () => randomId()));
  assert.equal(ids.size, 100);
  assert.ok(randomId().startsWith("d-"));
});