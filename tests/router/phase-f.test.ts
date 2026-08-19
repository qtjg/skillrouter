import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/router/index.ts";
import type { Capability, CapabilityState } from "../../src/core/types.ts";
import type { RouteContext } from "../../src/router/types.ts";
import type { NormalizedContext } from "../../src/context/types.ts";
import { mockCapabilities, mockInstalled } from "../../src/utils/mockdata.ts";
import { DEFAULT_CONFIG } from "../../src/config/config.ts";
import { PERMISSION_KINDS } from "../../src/constraints/constraints.ts";

function cap(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "cap:phase-f",
    name: "Phase F Capability",
    description: "Test capability",
    version: "1.0.0",
    type: "skill",
    compatibility: { opencode: "native" },
    permissions: { filesystem: { read: false, write: false }, network: { allowed: [] }, shell: { enabled: false } },
    risk: { declared: "low", score: 10 },
    metadata: { tags: [], categories: [] },
    trust: "community",
    source: { type: "catalog", location: "builtin", catalog: "tests" },
    ...overrides,
  };
}

const NOW = new Date().toISOString();
const installed = (ids: string[]): Map<string, { id: string; version: string; state: CapabilityState; installRoot: string | null; agents: string[]; installedAt: string; updatedAt: string; sourceType: string | null; sourceLocation: string | null }> => {
  const map = new Map<string, { id: string; version: string; state: CapabilityState; installRoot: string | null; agents: string[]; installedAt: string; updatedAt: string; sourceType: string | null; sourceLocation: string | null }>();
  for (const id of ids) map.set(id, { id, version: "1.0.0", state: "ENABLED", installRoot: null, agents: [], installedAt: NOW, updatedAt: NOW, sourceType: "catalog", sourceLocation: "builtin" });
  return map;
};

const typedContext = (fields: Record<string, import("../../src/context/types.ts").ContextValue>): NormalizedContext => ({
  fields,
  warnings: [],
  timeline: [],
  collectedAt: NOW,
});

function ctx(task: string, overrides: Partial<RouteContext> = {}): RouteContext {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
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

test("intent is auto-classified when not provided and surfaced on the decision", async () => {
  const router = new Router();
  const decision = await router.route(ctx("write unit tests for the new API endpoint"));
  assert.equal(decision.intent.type, "testing");
  assert.ok(decision.intent.confidence > 0);
});

test("capability category matching the classified intent raises taskSimilarity", async () => {
  const router = new Router();
  const decision = await router.route(ctx("write unit tests for the parser"));
  const entry = decision.scores.find((s) => s.capability.id === "cap:test-writer");
  assert.ok(entry);
  const intentSignal = entry.signals.find((s) => s.type === "taskSimilarity" && /intent/.test(s.text));
  assert.ok(intentSignal, "expected an intent-match signal");
  assert.ok(entry.breakdown.taskSimilarity > 0);
});

test("context language/framework/runtime requirements raise the context factor", async () => {
  const router = new Router();
  const typed = cap({
    id: "cap:typed",
    name: "Typed",
    requirements: { language: ["typescript"], framework: ["react"], runtime: ["linux"] },
  });
  const decision = await router.route(
    ctx("something unrelated", {
      capabilities: [typed],
      installed: installed(["cap:typed"]),
      context: typedContext({
        "project.language": ["typescript"],
        "project.framework": ["react"],
        "runtime.os": "linux",
      }),
    }),
  );
  const entry = decision.scores.find((s) => s.capability.id === "cap:typed");
  assert.ok(entry);
  assert.equal(entry.breakdown.keyword, 0, "no task signal should fire");
  const contextSignals = entry.signals.filter((s) => s.type === "context");
  assert.ok(contextSignals.some((s) => /language/.test(s.text)));
  assert.ok(contextSignals.some((s) => /framework/.test(s.text)));
  assert.ok(contextSignals.some((s) => /runtime/.test(s.text)));
  assert.ok(entry.breakdown.context >= 8 + 8 + 6, "language 8 + framework 8 + runtime 6");
});

test("runtime mismatch is penalized through the context factor", async () => {
  const router = new Router();
  const windowsOnly = cap({
    id: "cap:windows-only",
    name: "Windows Only",
    requirements: { runtime: ["windows"] },
  });
  const decision = await router.route(
    ctx("configure the environment", {
      capabilities: [windowsOnly],
      installed: installed(["cap:windows-only"]),
      context: typedContext({ "runtime.os": "linux" }),
    }),
  );
  const entry = decision.scores.find((s) => s.capability.id === "cap:windows-only");
  assert.ok(entry);
  assert.ok(entry.breakdown.context < 0, "mismatched runtime should penalize");
  assert.ok(entry.signals.some((s) => s.type === "context" && /mismatch|requires runtime/.test(s.text)));
});

test("hard constraints eliminate candidates before ranking", async () => {
  const router = new Router();
  const offline = await router.route(
    ctx("deploy the docker image", {
      constraints: { network: "forbidden" },
    }),
  );
  assert.equal(offline.scores.find((s) => s.capability.id === "cap:deployer"), undefined);

  const budget = await router.route(
    ctx("deploy the docker image", {
      constraints: { maxCost: 1 },
      capabilities: [
        cap({ id: "cap:pricey", name: "Pricey", metadata: { tags: [], categories: [], cost: 4 } }),
        cap({ id: "cap:cheap", name: "Cheap", metadata: { tags: [], categories: [], cost: 1 } }),
      ],
      installed: installed(["cap:pricey", "cap:cheap"]),
    }),
  );
  assert.equal(budget.scores.find((s) => s.capability.id === "cap:pricey"), undefined);
  assert.ok(budget.scores.find((s) => s.capability.id === "cap:cheap"));
});

test("required language/framework constraints reject unsupported capabilities", async () => {
  const router = new Router();
  const tsOnly = cap({ id: "cap:ts", requirements: { language: ["typescript"] } });
  const pyOnly = cap({ id: "cap:py", requirements: { language: ["python"] } });
  const decision = await router.route(
    ctx("implement the feature", {
      capabilities: [tsOnly, pyOnly],
      installed: installed(["cap:ts", "cap:py"]),
      constraints: { requiredLanguage: ["typescript"] },
    }),
  );
  assert.ok(decision.scores.find((s) => s.capability.id === "cap:ts"));
  assert.equal(decision.scores.find((s) => s.capability.id === "cap:py"), undefined);
});

test("soft preferences add a preference signal on top of the hard requirement", async () => {
  const router = new Router();
  const react = cap({ id: "cap:react", requirements: { framework: ["react"] } });
  const vue = cap({ id: "cap:vue", requirements: { framework: ["vue"] } });
  const decision = await router.route(
    ctx("build the dashboard", {
      capabilities: [react, vue],
      installed: installed(["cap:react", "cap:vue"]),
      constraints: { requiredFramework: ["react"] },
    }),
  );
  const reactEntry = decision.scores.find((s) => s.capability.id === "cap:react");
  const vueEntry = decision.scores.find((s) => s.capability.id === "cap:vue");
  assert.ok(reactEntry, "matching capability survives the hard requirement");
  assert.ok(reactEntry.breakdown.preference >= 6, "matching capability gains the soft preference delta");
  assert.equal(vueEntry, undefined, "non-matching capability is eliminated by the hard requirement");
});

test("requiredCapabilities are forced into the activation plan like always", async () => {
  const router = new Router();
  const decision = await router.route(
    ctx("optimize the landing page", {
      constraints: { requiredCapabilities: ["cap:docs-writer"] },
    }),
  );
  const action = decision.plan.find((p) => p.capabilityId === "cap:docs-writer");
  assert.ok(action);
  assert.equal(action.action, "activate");
});

test("permission boundary rejects capabilities requiring anything outside it", async () => {
  const router = new Router();
  const deployer = mockCapabilities().find((c) => c.id === "cap:deployer")!;
  const boundary = PERMISSION_KINDS.slice(0, 4);
  const decision = await router.route(
    ctx("deploy the docker image", {
      capabilities: [deployer],
      installed: installed(["cap:deployer"]),
      constraints: { permissions: [...boundary] },
    }),
  );
  assert.equal(decision.scores.find((s) => s.capability.id === "cap:deployer"), undefined);
});

test("every scored candidate carries a normalized scoreBreakdownV2", async () => {
  const router = new Router();
  const decision = await router.route(ctx("write unit tests for the new API endpoint"));
  assert.ok(decision.scores.length > 0);
  for (const score of decision.scores) {
    assert.ok(score.scoreBreakdownV2);
    const breakdown = score.scoreBreakdownV2!;
    assert.ok(Math.abs(breakdown.total - score.score / 100) <= 0.001);
    for (const key of ["capability", "context", "intent", "historical", "strategy", "exploration", "riskPenalty"] as const) {
      assert.ok(breakdown[key] >= 0 && breakdown[key] <= 1, `${key} out of range: ${breakdown[key]}`);
    }
  }
});

test("decision carries classified intent and normalized context when provided", async () => {
  const router = new Router();
  const decision = await router.route(
    ctx("fix the failing login flow", {
      context: typedContext({ "project.language": ["typescript"], "runtime.os": "linux" }),
    }),
  );
  assert.equal(decision.intent.type, "debugging");
  assert.deepEqual(decision.context, { "project.language": ["typescript"], "runtime.os": "linux" });
});