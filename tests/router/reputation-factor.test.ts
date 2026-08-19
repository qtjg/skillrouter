import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/router/index.ts";
import type { RouteContext } from "../../src/router/types.ts";
import type { OutcomeSummary } from "../../src/learning/outcomes.ts";
import { mockCapabilities, mockInstalled } from "../../src/utils/mockdata.ts";
import { DEFAULT_CONFIG, type SkillRouterConfig } from "../../src/config/config.ts";

const NOW = "2026-08-19T12:00:00.000Z";

function outcomeSummary(overrides: Partial<OutcomeSummary> = {}): OutcomeSummary {
  return {
    capabilityId: "cap:test-writer",
    usage: 30,
    successRate: 1,
    avgLatencyMs: 500,
    p95LatencyMs: 900,
    verificationRate: 1,
    avgRating: 2,
    lastSeen: NOW,
    ...overrides,
  };
}

function ctx(task: string, overrides: Partial<RouteContext> = {}): RouteContext {
  const config: SkillRouterConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  return {
    task,
    cwd: "/tmp",
    project: null,
    git: null,
    capabilities: mockCapabilities(),
    installed: mockInstalled(),
    agents: ["opencode"],
    config,
    ...overrides,
  };
}

test("reputation verification and rating nudge the historical factor when learning is enabled", async () => {
  const router = new Router();
  const decision = await router.route(
    ctx("write unit tests for the API", {
      outcomes: new Map([["cap:test-writer", outcomeSummary({ successRate: 1 })]]),
      metrics: new Map([["cap:test-writer", { capabilityId: "cap:test-writer", tasks: 30, successes: 30, failures: 0, lastUpdated: NOW }]]),
    }),
  );
  const entry = decision.scores.find((s) => s.capability.id === "cap:test-writer");
  assert.ok(entry);
  const reputationSignal = entry.signals.find((s) => /reputation/.test(s.text));
  assert.ok(reputationSignal, "expected a reputation signal when learning is enabled");
  assert.ok(reputationSignal!.weight > 0);
});

test("no reputation signal when learning is disabled, keeping pre-Phase-G behavior", async () => {
  const router = new Router();
  const base: RouteContext = ctx("deploy the docker image", {
    outcomes: new Map([["cap:deployer", outcomeSummary({ capabilityId: "cap:deployer", avgLatencyMs: 100, usage: 5 })]]),
    metrics: new Map([["cap:deployer", { capabilityId: "cap:deployer", tasks: 5, successes: 5, failures: 0, lastUpdated: NOW }]]),
  });
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as SkillRouterConfig;
  config.learning.enabled = false;
  base.config = config;

  const decision = await router.route(base);
  const entry = decision.scores.find((s) => s.capability.id === "cap:deployer");
  assert.ok(entry);
  assert.equal(entry.signals.some((s) => /reputation/.test(s.text)), false);
  assert.equal(entry.signals.some((s) => /observed average latency/.test(s.text)), false);
});

test("observed average latency replaces the declared latency penalty when learning is enabled", async () => {
  const router = new Router();
  const slow = mockCapabilities().find((c) => c.id === "cap:test-writer")!;
  slow.metadata = { ...slow.metadata, tags: [], categories: [], latency: 2 };
  const decision = await router.route(
    ctx("write unit tests for the API", {
      capabilities: [slow],
      installed: mockInstalled(),
      outcomes: new Map([["cap:test-writer", outcomeSummary({ avgLatencyMs: 5000, usage: 10 })]]) ,
    }),
  );
  const entry = decision.scores.find((s) => s.capability.id === "cap:test-writer");
  assert.ok(entry);
  const observed = entry.signals.find((s) => /observed average latency/.test(s.text));
  assert.ok(observed, "expected an observed-latency signal");
  assert.ok(observed!.weight < 0);
  assert.equal(entry.signals.some((s) => /declared latency/.test(s.text)), false);
});

test("learning scoring is deterministic for identical inputs", async () => {
  const router = new Router();
  const build = () =>
    ctx("research competitors", {
      outcomes: new Map([
        ["cap:test-writer", outcomeSummary({ avgLatencyMs: 300, verificationRate: 0.5, avgRating: 1 })],
        ["cap:deployer", outcomeSummary({ capabilityId: "cap:deployer", avgLatencyMs: 2000, verificationRate: 0.2, avgRating: -1, usage: 40 })],
      ]),
      metrics: new Map([
        ["cap:test-writer", { capabilityId: "cap:test-writer", tasks: 30, successes: 25, failures: 5, lastUpdated: NOW }],
        ["cap:deployer", { capabilityId: "cap:deployer", tasks: 40, successes: 30, failures: 10, lastUpdated: NOW }],
      ]),
    });
  const first = await router.route(build());
  const second = await router.route(build());
  assert.deepEqual(
    first.scores.map((s) => [s.capability.id, s.score, s.breakdown.historical, s.breakdown.latency]),
    second.scores.map((s) => [s.capability.id, s.score, s.breakdown.historical, s.breakdown.latency]),
  );
  assert.deepEqual(first.plan.map((p) => [p.capabilityId, p.action]), second.plan.map((p) => [p.capabilityId, p.action]));
});

test("reputationWeight caps the reputation nudge", async () => {
  const router = new Router();
  const decision = await router.route(
    ctx("write unit tests", {
      outcomes: new Map([["cap:test-writer", outcomeSummary({ successRate: 1, verificationRate: 1, avgRating: 2 })]]) ,
      metrics: new Map([["cap:test-writer", { capabilityId: "cap:test-writer", tasks: 100, successes: 100, failures: 0, lastUpdated: NOW }]]),
    }),
  );
  const entry = decision.scores.find((s) => s.capability.id === "cap:test-writer");
  assert.ok(entry);
  const reputation = entry.signals.find((s) => /reputation/.test(s.text));
  assert.ok(reputation);
  assert.ok(reputation!.weight <= DEFAULT_CONFIG.learning.reputationWeight + 1e-9);
});