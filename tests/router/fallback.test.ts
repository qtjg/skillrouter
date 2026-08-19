import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFallbackChains, selectFallback } from "../../src/router/fallback.ts";
import type { Capability } from "../../src/core/types.ts";
import type { CapabilityScore, RouteContext, TaskAnalysis } from "../../src/router/types.ts";
import { Router } from "../../src/router/index.ts";
import { mockInstalled } from "../../src/utils/mockdata.ts";
import { DEFAULT_CONFIG } from "../../src/config/config.ts";

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

function score(id: string, scoreValue = 50): CapabilityScore {
  return {
    capability: cap(id),
    score: scoreValue,
    signals: [],
    breakdown: {
      keyword: 0, taskSimilarity: 0, technology: 0, project: 0, git: 0, file: 0, dependency: 0,
      compatibility: 0, trust: 0, quality: 0, historical: 0, cost: 0, latency: 0, context: 0, preference: 0, contextCost: 0, permissionCost: 0, conflict: 0,
    },
    compatibility: "adaptable",
    trust: "unknown",
    riskLevel: "low",
    conflictWith: null,
  };
}

test("resolveFallbackChains builds ordered, deduplicated chains and drops self refs", () => {
  const capabilities = [
    cap("web-search", { fallbacks: ["browser-search", "http-fetch", "browser-search", "web-search"] }),
    cap("browser-search"),
    cap("http-fetch"),
  ];
  const chains = resolveFallbackChains(capabilities);
  assert.deepEqual(chains.get("web-search"), ["browser-search", "http-fetch"]);
  assert.equal(chains.size, 1);
});

test("selectFallback walks the chain in order", () => {
  const chainCap = cap("web-search", { fallbacks: ["browser-search", "http-fetch", "docs-search"] });
  const chains = resolveFallbackChains([chainCap, cap("browser-search"), cap("http-fetch"), cap("docs-search")]);
  assert.deepEqual(selectFallback("web-search", chains, [score("browser-search", 55), score("http-fetch", 60)]), { id: "browser-search", steps: 0 });

  // first candidate unavailable → second wins
  const selection = selectFallback(
    "web-search",
    chains,
    [score("browser-search", 55), score("http-fetch", 60)],
    { unavailable: (id) => id === "browser-search" },
  );
  assert.deepEqual(selection, { id: "http-fetch", steps: 1 });
});

test("selectFallback skips unknown and below-conflict candidates when scores are given", () => {
  const chainCap = cap("web-search", { fallbacks: ["ghost", "http-fetch", "docs-search"] });
  const chains = resolveFallbackChains([chainCap, cap("http-fetch"), cap("docs-search")]);
  const selection = selectFallback("web-search", chains, [score("http-fetch", 80)]);
  assert.deepEqual(selection, { id: "http-fetch", steps: 1 });
});

test("selectFallback prevents infinite loops on cyclic chains via attempted", () => {
  const chains = new Map<string, string[]>([
    ["a", ["b"]],
    ["b", ["a"]],
  ]);
  const attempted = new Set(["b"]);
  assert.deepEqual(selectFallback("a", chains, [], { attempted }), null);
});

test("selectFallback respects maxSteps", () => {
  const chainCap = cap("base", { fallbacks: ["n1", "n2", "n3", "n4"] });
  const chains = resolveFallbackChains([chainCap, cap("n1"), cap("n2"), cap("n3"), cap("n4")]);
  const all = selectFallback("base", chains, [score("n1"), score("n2"), score("n3"), score("n4")], {
    unavailable: () => true,
    maxSteps: 2,
  });
  assert.equal(all, null);
  const limited = selectFallback("base", chains, [score("n1"), score("n2"), score("n3"), score("n4")], { unavailable: () => true, maxSteps: 3 });
  assert.equal(limited, null);
  const short = selectFallback("base", chains, [score("n1"), score("n2"), score("n3"), score("n4")], { maxSteps: 1 });
  assert.deepEqual(short, { id: "n1", steps: 0 });
});

test("selectFallback works chain-only without scores", () => {
  const chainCap = cap("web-search", { fallbacks: ["browser-search"] });
  const chains = resolveFallbackChains([chainCap, cap("browser-search")]);
  assert.deepEqual(selectFallback("web-search", chains, []), { id: "browser-search", steps: 0 });
  assert.equal(selectFallback("no-chain", chains, []), null);
  assert.equal(selectFallback("web-search", new Map(), []), null);
});

test("router attaches fallback chains to selected capabilities in the decision", async () => {
  const caps = [
    cap("web-search", {
      fallbacks: ["browser-search"],
      triggers: { keywords: ["research", "pricing", "web"] },
      description: "research information on the web",
    }),
    cap("browser-search", { description: "alternative browser research", triggers: { keywords: ["research"] } }),
    cap("unrelated", { description: "unrelated skill" }),
  ];
  const ctx: RouteContext = {
    task: "research the web for pricing",
    cwd: "/tmp",
    project: null,
    git: null,
    capabilities: caps,
    installed: mockInstalled(),
    agents: ["opencode"],
    config: JSON.parse(JSON.stringify({ ...DEFAULT_CONFIG, router: { ...DEFAULT_CONFIG.router, threshold: 25 } })),
  };
  const decision = await new Router().route(ctx);
  const selected = decision.plan.filter((p) => p.action === "activate" || p.action === "keep").map((p) => p.capabilityId);
  assert.ok(selected.includes("web-search"));
  assert.deepEqual(decision.fallbacks["web-search"], ["browser-search"]);
  if (!selected.includes("browser-search")) {
    assert.equal(decision.fallbacks["browser-search"], undefined);
  }
});

test("router hides fallbacks whose targets are not candidates", async () => {
  const caps = [
    cap("web-search", { fallbacks: ["ghost-typo", "browser-search"], triggers: { keywords: ["research", "pricing", "web"] }, description: "web research" }),
    cap("browser-search", { triggers: { keywords: ["research"] }, description: "browser research" }),
  ];
  const ctx: RouteContext = {
    task: "research pricing",
    cwd: "/tmp",
    project: null,
    git: null,
    capabilities: caps,
    installed: mockInstalled(),
    agents: ["opencode"],
    config: JSON.parse(JSON.stringify({ ...DEFAULT_CONFIG, router: { ...DEFAULT_CONFIG.router, threshold: 25 } })),
  };
  const decision = await new Router().route(ctx);
  const webFallbacks = decision.fallbacks["web-search"];
  assert.ok(webFallbacks);
  assert.deepEqual(webFallbacks, ["browser-search"]);
});