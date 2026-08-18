import { test } from "node:test";
import assert from "node:assert/strict";
import type { Capability } from "../../src/core/types.ts";
import { requiredDependencies, optionalDependencies, expandDependencies, sortByDependencies } from "../../src/router/dependency-resolver.ts";

function depCap(id: string, dependencies: Array<{ id: string; version?: string; optional?: boolean }>): Capability {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: id,
    type: "skill",
    schema: "skillrouter/v1",
    manifestPath: `manifest-${id}.yaml`,
    compatibility: { opencode: "native" },
    dependencies,
    trust: "unknown",
  };
}

const A = depCap("a", []);
const B = depCap("b", [{ id: "a" }]);
const C = depCap("c", [{ id: "b" }, { id: "a", optional: true }]);
const D = depCap("d", [{ id: "ghost" }]);
const E = depCap("e", [{ id: "ghost-opt", optional: true }]);
const CYCLE1 = depCap("x1", [{ id: "x2" }]);
const CYCLE2 = depCap("x2", [{ id: "x1" }]);
const SELFCYCLE = depCap("self", [{ id: "self" }]);
const UNIVERSE = [A, B, C, D, E, CYCLE1, CYCLE2, SELFCYCLE];

test("requiredDependencies filters optionals", () => {
  assert.deepEqual(requiredDependencies(B), [{ id: "a" }]);
  assert.deepEqual(requiredDependencies(C), [{ id: "b" }]);
  assert.deepEqual(optionalDependencies(C), [{ id: "a", optional: true }]);
  assert.deepEqual(requiredDependencies(A), []);
});

test("expandDependencies orders deps first and includes closure", () => {
  const result = expandDependencies(["c"], UNIVERSE);
  assert.deepEqual(result.ordered, ["a", "b", "c"]);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.optionalMiss, []);
});

test("expandDependencies cross-checks missing required deps and aggregates requiredBy", () => {
  const result = expandDependencies(["d", "e"], UNIVERSE);
  assert.deepEqual(result.missing, [{ id: "ghost", version: undefined, requiredBy: ["d"] }]);
  assert.deepEqual(result.optionalMiss, [{ id: "ghost-opt", requiredBy: "e" }]);
});

test("expandDependencies aggregates missing deps pushed by multiple dependents", () => {
  const F = depCap("f", [{ id: "ghost" }]);
  const G = depCap("g", [{ id: "ghost" }]);
  const result = expandDependencies(["f", "g"], [...UNIVERSE, F, G]);
  assert.deepEqual(result.missing, [{ id: "ghost", version: undefined, requiredBy: ["f", "g"] }]);
});

test("sortByDependencies keeps deterministic order for independent caps", () => {
  const byId = new Map<string, Capability>([["a", A], ["b", B], ["c", C]]);
  const order = sortByDependencies(["c", "a", "b"], byId);
  assert.deepEqual(order.ordered, ["a", "b", "c"]);
  assert.deepEqual(order.cycles, []);
});

test("sortByDependencies detects cycles but keeps all ids", () => {
  const byId = new Map<string, Capability>([["x1", CYCLE1], ["x2", CYCLE2], ["a", A]]);
  const result = sortByDependencies(["x1", "x2", "a"], byId);
  assert.equal(result.ordered.length, 3);
  assert.ok(result.ordered.includes("a"));
  assert.ok(result.cycles.length >= 1);
  const cycle = result.cycles[0]!;
  assert.equal(cycle.length, 3);
  assert.equal(cycle[0], cycle[cycle.length - 1]);
});

test("sortByDependencies handles self-loops without deadlock", () => {
  const byId = new Map<string, Capability>([["self", SELFCYCLE]]);
  const result = sortByDependencies(["self"], byId);
  assert.deepEqual(result.ordered, ["self"]);
  assert.deepEqual(result.cycles, []);
});

test("expandDependencies reports cycles found in the closure", () => {
  const result = expandDependencies(["x1"], UNIVERSE);
  assert.ok(result.cycles.length >= 1);
  assert.ok(result.ordered.includes("x1") && result.ordered.includes("x2"));
});

test("expandDependencies computes per-id transitive closures", () => {
  const result = expandDependencies(["c", "a"], UNIVERSE);
  assert.deepEqual([...result.closure.get("c")!].sort(), ["a", "b"]);
  assert.equal(result.closure.has("a"), false);
});

test("expandDependencies ignores absent requested ids", () => {
  const result = expandDependencies(["nope", "a"], UNIVERSE);
  assert.deepEqual(result.ordered, ["a"]);
});