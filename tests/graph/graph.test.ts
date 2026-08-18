import { test } from "node:test";
import assert from "node:assert/strict";
import { CapabilityGraph } from "../../src/graph/graph.ts";
import type { Capability } from "../../src/core/types.ts";

function cap(id: string, extra: Partial<Capability> = {}): Capability {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: id,
    type: "skill",
    schema: "skillrouter/v1",
    manifestPath: `${id}.yaml`,
    compatibility: { opencode: "native" },
    trust: "unknown",
    ...extra,
  };
}

const CHAIN = [
  cap("testing"),
  cap("typescript", { enhances: ["testing"] }),
  cap("react", { dependencies: [{ id: "typescript" }] }),
  cap("nextjs", { dependencies: [{ id: "react" }, { id: "testing", optional: true }], enhances: ["testing"], replaces: ["gatsby"] }),
  cap("gatsby"),
  cap("oauth", {}),
  cap("nextauth", { dependencies: [{ id: "oauth" }], conflicts: ["oauth"] }),
];

test("graph builds and reports nodes and ids", () => {
  const graph = CapabilityGraph.build(CHAIN);
  assert.equal(graph.size(), 7);
  assert.equal(graph.has("nextjs"), true);
  assert.equal(graph.get("react")?.version, "1.0.0");
  assert.equal(graph.get("missing"), null);
});

test("dependenciesOf traverses recursively and excludes self", () => {
  const graph = CapabilityGraph.build(CHAIN);
  assert.deepEqual(graph.dependenciesOf("nextjs"), ["react", "typescript"]);
  assert.deepEqual(graph.dependenciesOf("nextjs", { includeOptional: true }), ["react", "testing", "typescript"]);
  assert.deepEqual(graph.dependenciesOf("nextjs", { recursive: false }), ["react"]);
  assert.deepEqual(graph.prerequisitesOf("nextjs"), ["react", "typescript"]);
  assert.deepEqual(graph.dependenciesOf("unknown"), []);
});

test("dependentsOf walks the reverse dependency chain", () => {
  const graph = CapabilityGraph.build(CHAIN);
  assert.deepEqual(graph.dependentsOf("typescript"), ["nextjs", "react"]);
  assert.deepEqual(graph.dependentsOf("oauth"), ["nextauth"]);
});

test("conflictingWith is symmetric", () => {
  const graph = CapabilityGraph.build(CHAIN);
  assert.deepEqual(graph.conflictingWith("nextauth"), ["oauth"]);
  assert.deepEqual(graph.conflictingWith("oauth"), ["nextauth"]);
});

test("enhancers, enhancements, replacements and compatibility edges", () => {
  const graph = CapabilityGraph.build([
    cap("typescript", { enhances: ["testing"] }),
    cap("testing"),
    cap("nextjs", { replaces: ["gatsby"], compatibleWith: ["next", "docker"] }),
    cap("gatsby"),
  ]);
  assert.deepEqual(graph.enhancersOf("testing"), ["typescript"]);
  assert.deepEqual(graph.enhancementsOf("typescript"), ["testing"]);
  assert.deepEqual(graph.replacementsFor("gatsby"), ["nextjs"]);
  assert.deepEqual(graph.replacedByIds("nextjs"), ["gatsby"]);
  assert.deepEqual(graph.compatibleTagsOf("nextjs"), ["docker", "next"]);
});

test("cluster reaches requires and enhances within depth", () => {
  const graph = CapabilityGraph.build(CHAIN);
  assert.deepEqual(graph.cluster("nextjs", { maxDepth: 2 }), ["react", "testing", "typescript"]);
  assert.deepEqual(graph.cluster("nextjs", { maxDepth: 1 }), ["react", "testing"]);
  assert.deepEqual(graph.cluster("unknown"), []);
});

test("validate flags unknown references", () => {
  const graph = CapabilityGraph.build([cap("security", { dependencies: [{ id: "auth-core" }], replaces: ["legacy-lib"] })]);
  const problems = graph.validate();
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.message.includes('"auth-core"')));
  assert.ok(problems.some((p) => p.message.includes('"legacy-lib"')));
});

test("validate flags self referencing edges", () => {
  const graph = CapabilityGraph.build([cap("selfy", { dependencies: [{ id: "selfy" }], conflicts: ["selfy"] })]);
  const problems = graph.validate();
  assert.equal(problems.filter((p) => p.message.includes("self-referencing")).length, 2);
});

test("validate flags dependency cycles and replacement cycles", () => {
  const graph = CapabilityGraph.build([
    cap("node-a", { dependencies: [{ id: "node-b" }] }),
    cap("node-b", { dependencies: [{ id: "node-a" }] }),
    cap("r1", { replaces: ["r2"] }),
    cap("r2", { replaces: ["r1"] }),
  ]);
  const problems = graph.validate();
  assert.ok(problems.some((p) => p.relation === "requires" && p.message.includes("cycle")));
  assert.ok(problems.some((p) => p.relation === "replaces" && p.message.includes("cycle")));
});

test("validate flags conflicts against required capabilities", () => {
  const graph = CapabilityGraph.build([cap("paradox", { dependencies: [{ id: "partner" }], conflicts: ["partner"] }), cap("partner")]);
  const problems = graph.validate();
  assert.ok(problems.some((p) => p.message.includes('conflicts with required capability "partner"')));
});

test("edges are deterministic and optional deps are marked", () => {
  const graph = CapabilityGraph.build([
    cap("nextjs", { dependencies: [{ id: "react" }, { id: "testing", optional: true }] }),
    cap("react"),
    cap("testing"),
  ]);
  const edges = graph.edges();
  assert.ok(edges.some((e) => e.relation === "requires" && e.to === "testing" && e.optional === true));
  assert.ok(edges.every((e, i) => i === 0 || edges[i - 1]!.from + edges[i - 1]!.relation <= e.from + e.relation));
});

test("add is idempotent for duplicate ids", () => {
  const graph = CapabilityGraph.build([cap("dup")]);
  graph.add(cap("dup"));
  assert.equal(graph.size(), 1);
});