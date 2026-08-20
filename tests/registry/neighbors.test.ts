import { test } from "node:test";
import assert from "node:assert/strict";
import type { Capability } from "../../src/core/types.ts";
import { similarityBetween, findNeighbors, analyzePool, distinctivenessOf } from "../../src/registry/neighbors.ts";

function cap(id: string, overrides: Partial<Capability> = {}): Capability {
  return {
    id,
    name: `Capability ${id}`,
    version: "1.0.0",
    description: "A generic description for the capability",
    type: "skill",
    compatibility: { opencode: "native" },
    ...overrides,
  };
}

test("identical name is a perfect overlay (1.0)", () => {
  const a = cap("a", { name: "Docker Helper" });
  const b = cap("b", { name: "Docker Helper" });
  assert.equal(similarityBetween(a, b).similarity, 1);
  assert.deepEqual(similarityBetween(a, b).fields, ["name"]);
});

test("near-duplicate triggers + name tokens yield a high overlay", () => {
  const a = cap("docker-deploy-a", {
    name: "Docker Deployer A",
    description: "Deploys the application containers",
    triggers: { keywords: ["docker"], intents: ["deployment"], technologies: ["docker"] },
  });
  const b = cap("docker-deploy-b", {
    name: "Docker Deployer B",
    description: "Deploys the application containers",
    triggers: { keywords: ["docker"], intents: ["deployment"], technologies: ["docker"] },
  });
  const r = similarityBetween(a, b);
  assert.ok(r.similarity >= 0.85, `expected high overlay, got ${r.similarity}`);
  assert.ok(r.fields.includes("triggers"));
  assert.ok(r.shared.length > 0);
});

test("unrelated capabilities have zero overlay", () => {
  const a = cap("web-search", { name: "Web Research", description: "Search the web", triggers: { keywords: ["research", "web"] } });
  const b = cap("db-migrator", { name: "Schema Migration", description: "Migrate schemas", triggers: { keywords: ["migrate", "schema"] } });
  assert.equal(similarityBetween(a, b).similarity, 0);
});

test("id nesting is a strong signal", () => {
  const k8s = cap("kubernetes-deploy", { name: "Kubernetes Deploy", description: "Rolls out services" });
  const generic = cap("deploy", { name: "Deploy Tooling", description: "Releases artifacts" });
  const k8sAnalysis = similarityBetween(k8s, generic);
  assert.ok(k8sAnalysis.similarity >= 0.9, `id containment should dominate, got ${k8sAnalysis.similarity}`);
});

test("findNeighbors excludes self, filters by threshold, sorts desc", () => {
  const caps = [
    cap("alpha", { name: "Grass Cutter", description: "Mows the lawns", triggers: { keywords: ["grass"] } }),
    cap("beta", { name: "Grass Cutter", description: "Mows the lawns", triggers: { keywords: ["grass"] } }),
    cap("gamma", { name: "Grass Cutter", description: "Mows the lawns", triggers: { keywords: ["grass"] } }),
    cap("zebra", { name: "Zebra Watcher", description: "Watches zebras", triggers: { keywords: ["zebra"] } }),
  ];
  const neighbors = findNeighbors(caps, "alpha");
  assert.deepEqual(neighbors.map((n) => n.id), ["beta", "gamma"]);
  assert.ok(!neighbors.some((n) => n.id === "alpha"));
  assert.ok(neighbors[0]!.similarity >= neighbors[1]!.similarity);
  assert.equal(findNeighbors(caps, "alpha", { minSimilarity: 1.0001 }).length, 0);
  assert.equal(findNeighbors(caps, "missing", {}).length, 0);
});

test("distinctiveness is 1 − best overlap; unique capability stays at 1", () => {
  const unique = cap("alpha", { name: "Gardening Guide", triggers: { keywords: ["gardening"] } });
  const pool = [unique, cap("beta", { name: "Gardening Helper", triggers: { keywords: ["gardening"] } })];
  const analysis = analyzePool(pool);
  assert.ok(analysis.get("alpha")!.distinctiveness < 1, "shared area must lower distinctiveness");
  assert.equal(distinctivenessOf(pool, "beta"), analysis.get("beta")!.distinctiveness);
  assert.equal(distinctivenessOf([unique], "alpha"), 1, "single capability pool is maximally distinct");
});