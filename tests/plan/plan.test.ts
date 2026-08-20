import { test } from "node:test";
import assert from "node:assert/strict";
import type { Capability } from "../../src/core/types.ts";
import { composePlan } from "../../src/plan/index.ts";
import { buildPlanDag, detectCycles, linearize, validatePlan } from "../../src/plan/graph.ts";
import type { PlanInput } from "../../src/plan/types.ts";

function cap(id: string, overrides: Partial<Capability> = {}): Capability {
  return {
    id,
    name: `Cap ${id}`,
    version: "1.0.0",
    description: `Capability ${id}`,
    type: "skill",
    compatibility: { opencode: "native" },
    ...overrides,
  };
}

test("composePlan builds a DAG over capability.capabilities[] (requires edges)", () => {
  const registry = new Map([
    ["docker", cap("docker", { capabilities: ["registry", "compose"] })],
    ["registry", cap("registry")],
    ["compose", cap("compose")],
  ]);
  const plan = composePlan({ registry, roots: ["docker"] });

  assert.equal(plan.dag.root.kind, "root");
  assert.ok(plan.validation.valid, JSON.stringify(plan.validation));
  assert.ok(plan.dag.links.some((l) => l.from === "docker" && l.to === "registry" && l.rel === "requires"));
  assert.ok(plan.dag.links.some((l) => l.from === "docker" && l.to === "compose" && l.rel === "requires"));
});

test("roots default to the whole registry in deterministic order", () => {
  const registry = new Map([
    ["zebra", cap("zebra")],
    ["alpha", cap("alpha")],
    ["mike", cap("mike")],
  ]);
  const first = buildPlanDag({ registry, roots: [] });
  const second = buildPlanDag({ registry, roots: [] });
  const ids = (dag: typeof first) => dag.root.children.map((c) => c.id);
  assert.deepEqual(ids(first), ids(second));
  assert.deepEqual(ids(first), ["alpha", "mike", "zebra"]);
});

test("missing sub-capability is reported and can be expanded transitively", () => {
  const registry = new Map([
    ["a", cap("a", { capabilities: ["b"] })],
    ["b", cap("b", { capabilities: ["c"] })],
  ]);
  const plan = composePlan({ registry, roots: ["a"] });
  assert.ok(!plan.validation.valid);
  assert.deepEqual(plan.validation.missing, [{ capabilityId: "c", requiredBy: "b" }]);
  const missingNode = plan.dag.nodes.find((n) => n.id === "c");
  assert.equal(missingNode?.status, "missing");
});

test("cycles are detected and marked", () => {
  const registry = new Map([
    ["x", cap("x", { capabilities: ["y"] })],
    ["y", cap("y", { capabilities: ["x"] })],
  ]);
  const dag = buildPlanDag({ registry, roots: ["x"] });
  const cycles = detectCycles(dag);
  assert.equal(cycles.length, 1);
  assert.deepEqual(cycles[0]!.path, ["x", "y", "x"]);
  const validation = validatePlan(dag, new Set(registry.keys()));
  assert.ok(!validation.valid);
  const plan = composePlan({ registry, roots: ["x"] });
  assert.equal(plan.dag.nodes.find((n) => n.id === "y")?.status, "skipped");
});

test("declared conflicts invalidate the plan and mark nodes", () => {
  const registry = new Map([
    ["base", cap("base", { capabilities: ["linter", "formatter"] })],
    ["linter", cap("linter", { conflicts: ["formatter"] })],
    ["formatter", cap("formatter")],
  ]);
  const plan = composePlan({ registry, roots: ["base"] });
  assert.ok(!plan.validation.valid);
  assert.deepEqual(plan.validation.conflicts, [{ a: "linter", b: "formatter" }]);
  assert.equal(plan.dag.nodes.find((n) => n.id === "linter")?.status, "conflict");
  assert.equal(plan.dag.nodes.find((n) => n.id === "formatter")?.status, "conflict");
});

test("unresolved enhances/fallback references surface as warnings, not errors", () => {
  const registry = new Map([["a", cap("a", { enhances: ["ghost"], fallbacks: ["ghost2"] })]]);
  const plan = composePlan({ registry, roots: ["a"] });
  assert.ok(plan.validation.valid);
  assert.equal(plan.validation.warnings.length, 2);
});

test("linearize yields a deterministic dependency-first execution order", () => {
  const registry = new Map([
    ["target", cap("target", { capabilities: ["deps"] })],
    ["deps", cap("deps", { capabilities: ["base"] })],
    ["base", cap("base")],
  ]);
  const plan = composePlan({ registry, roots: ["target"] });
  const order = linearize(plan.dag);
  const base = order.indexOf("base");
  const deps = order.indexOf("deps");
  const target = order.indexOf("target");
  assert.ok(base >= 0 && deps > base && target > deps, `bad order: ${order.join(",")}`);
  assert.deepEqual(plan.steps.map((s) => s.capabilityId), ["base", "deps", "target"]);
});

test("excluded capabilities are skipped from composition", () => {
  const registry = new Map([
    ["root", cap("root", { capabilities: ["keep", "skip"] })],
    ["keep", cap("keep")],
    ["skip", cap("skip")],
  ]);
  const plan = composePlan({ registry, roots: ["root"], exclude: ["skip"] });
  const skip = plan.dag.nodes.find((n) => n.id === "skip");
  assert.equal(skip?.status, "skipped");
  assert.ok(!plan.steps.some((s) => s.capabilityId === "skip"));
});

test("shared sub-capability is composed exactly once", () => {
  const registry = new Map([
    ["root", cap("root", { capabilities: ["a", "b"] })],
    ["a", cap("a", { capabilities: ["shared"] })],
    ["b", cap("b", { capabilities: ["shared"] })],
    ["shared", cap("shared")],
  ]);
  const plan = composePlan({ registry, roots: ["root"] });
  const sharedNodes = plan.dag.nodes.filter((n) => n.id === "shared");
  assert.equal(sharedNodes.length, 1);
  assert.equal(plan.steps.filter((s) => s.capabilityId === "shared").length, 1);
});

test("plan input type shape", () => {
  const registry = new Map<string, Capability>([["a", cap("a")]]);
  const input: PlanInput = { registry, roots: [] };
  assert.equal(typeof composePlan, "function");
  assert.ok(input.registry.has("a"));
});