import { test } from "node:test";
import assert from "node:assert/strict";
import type { Capability } from "../../src/core/types.ts";
import type { TaskAnalysis, RouteContext } from "../../src/router/types.ts";
import { scoreSingleCapability, prepareCapability, W } from "../../src/router/factors.ts";
import { rejectionReasons } from "../../src/router/explainer.ts";
import { parseManifestYaml, validateManifest, normalizeManifest } from "../../src/manifest/validate.ts";

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

function task(text: string): TaskAnalysis {
  const tokens = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#._-]+/)
      .filter((t) => t.length > 1),
  );
  return {
    task: text,
    normalized: { tokens, phrases: new Set() },
    tokens: [...tokens],
    technologies: [],
    domains: [],
    operations: ["implementation"],
    riskEstimate: "low",
  };
}

function ctx(capabilities: Capability[]): RouteContext {
  return {
    task: "x",
    cwd: "/tmp",
    project: null,
    git: null,
    capabilities,
    installed: new Map(),
    agents: ["opencode"],
    config: {
      project: { name: null },
      router: { mode: "assisted", always: [], never: [], prefer: [], avoid: [], threshold: 40, semantic: false, model: null, maxActivations: 5, strategy: "balanced", distinctiveness: true, classificationThresholds: { noMatch: 25, weak: 50, good: 75, exact: 90 }, context: { enabled: true, timeoutMs: 1000 } },
      capabilities: { autoInstall: false, autoActivate: true },
      security: { requireConsent: true, blocked: [], policy: {} },
      learning: { enabled: true, reputationWeight: 8, latencyWeight: 5, maxOutcomes: 1000 },
      agents: { opencode: true, gemini: true, claude: true, codex: false, mcp: false, generic: true },
      retrieval: { topK: 10, embeddings: { enabled: false, provider: "local", model: "m", dimension: 256, apiKeyEnv: "K", baseUrl: "https://api.example.com/v1" }, rerank: { enabled: true, provider: "lexical" } },
      sources: [],
    },
  };
}

function score(id: string, text: string, c = ctx([])) {
  const capability = c.capabilities.find((x) => x.id === id)!;
  const prepared = prepareCapability(capability);
  return scoreSingleCapability(capability, task(text), c, prepared);
}

test("notFor entries are validated and normalized by the manifest pipeline", () => {
  const doc = parseManifestYaml(
  `
schema: skillrouter/v1
id: docker-helper
name: Docker Helper
version: 1.0.0
description: Helps with docker workflows
type: skill
compatibility: { opencode: native }
notFor:
  - kubernetes deployment
  - database migration
`,
  "test.yaml",
);
  const validation = validateManifest(doc);
  assert.deepEqual(validation.errors, []);
  const capability = normalizeManifest(doc, "test.yaml");
  assert.deepEqual(capability.notFor, ["kubernetes deployment", "database migration"]);
  const bad = validateManifest(parseManifestYaml("schema: skillrouter/v1\nid: a\nname: A\nversion: 1.0.0\ndescription: d\ntype: skill\ncompatibility: {opencode: native}\nnotFor: 42\n", "bad.yaml"));
  assert.ok(bad.problems.some((p) => p.path === "notFor" && p.message.includes("array")), "non-array notFor must be flagged");
});

test("negative capability match penalizes a candidate harder than keywords boost it", () => {
  const c = ctx([cap("docker-helper", { triggers: { keywords: ["docker", "deploy"] }, notFor: ["kubernetes deployment"] })]);
  const result = score("docker-helper", "deploy to kubernetes", c);
  const negative = result.signals.find((s) => s.type === "negativeSignal");
  assert.ok(negative, "explicit negative match must produce a negative signal");
  assert.equal(Math.abs(negative!.weight), Math.abs(W.negativeSignal));
  assert.ok(negative!.text.includes("kubernetes deployment"));
  assert.equal(result.score, 0, "explicit negative match must dominate keyword matches");

  const positive = score("docker-helper", "deploy docker containers", c);
  assert.ok(positive.score > 0, "without a negative match the keyword path is untouched");
  assert.ok(!positive.signals.some((s) => s.type === "negativeSignal"));
});

test("negative signals are stronger than name/id matches", () => {
  const c = ctx([cap("kubernetes-deployer", { name: "Kubernetes Deployer", notFor: ["database migration", "kubernetes deployment"] })]);
  const result = score("kubernetes-deployer", "kubernetes rollout database migration", c);
  assert.equal(result.score, 0, "name match (+20) must lose to explicit negative matches (-36)");
});

test("rejectionReasons surfaces the explicit negative capability reason", () => {
  const c = ctx([cap("docker-helper", { notFor: ["kubernetes deployment"] })]);
  const result = score("docker-helper", "deploy to kubernetes", c);
  const reasons = rejectionReasons({ ...result, capability: result.capability });
  assert.ok(reasons.some((r) => r.includes("negative capability match") && r.includes("kubernetes deployment")));
});