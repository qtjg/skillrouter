import { test } from "node:test";
import assert from "node:assert/strict";
import { planWorkflow } from "../../src/workflow/planner.ts";
import { decomposeTask } from "../../src/task/decompose.ts";
import { mockInstalled } from "../../src/utils/mockdata.ts";
import { DEFAULT_CONFIG } from "../../src/config/config.ts";
import type { RouteContext } from "../../src/router/types.ts";
import type { Capability } from "../../src/core/types.ts";

function cap(id: string, overrides: Partial<Capability> = {}): Capability {
  return {
    id,
    name: id.replace(/-/g, " "),
    version: "1.0.0",
    description: `Performs ${id} work`,
    type: "skill",
    compatibility: { opencode: "native" },
    ...overrides,
  };
}

const DB_MIGRATOR = cap("db-migrate", {
  name: "Database Migrator",
  description: "Applies database schema migrations safely",
  triggers: { keywords: ["database", "migrate", "schema"] },
});
const TEST_WRITER = cap("test-writer", {
  name: "Test Suite Writer",
  description: "Writes unit and integration tests",
  triggers: { keywords: ["test", "spec", "coverage"] },
});
const DEPLOYER = cap("deploy", {
  name: "Deploy Runner",
  description: "Deploys the built artifacts to the environment",
  triggers: { keywords: ["deploy", "rollout", "release"] },
  capabilities: ["test-writer"],
});
const GHOST_DEPLOYER = cap("deploy-ghost", {
  name: "Deploy Runner",
  description: "Deploys the built artifacts to the environment",
  triggers: { keywords: ["deploy", "rollout", "release"] },
  capabilities: ["ghost-cap"],
});

function ctx(task: string, capabilities: Capability[]): RouteContext {
  return {
    task,
    cwd: "/tmp",
    project: null,
    git: null,
    capabilities,
    installed: mockInstalled(),
    agents: ["opencode"],
    config: JSON.parse(JSON.stringify({ ...DEFAULT_CONFIG, router: { ...DEFAULT_CONFIG.router, threshold: 30 } })),
  };
}

test("workflow routes each subtask and composes a dependency-safe plan", async () => {
  const plan = await planWorkflow({ ctx: ctx("deploy the app", [DB_MIGRATOR, TEST_WRITER, DEPLOYER]) });
  assert.ok(plan.steps.length >= 4, "deployment recipe produces multiple steps");
  const routed = plan.steps.filter((s) => s.source === "routed");
  assert.ok(routed.length > 0, "at least one subtask must match a capability");
  assert.ok(plan.steps.some((s) => s.capabilityId === "deploy"), "deployment subtask maps to the deployer");
  assert.ok(plan.composed, "chosen capabilities are composed into a DAG");
  const dep = plan.steps.find((s) => s.capabilityId === "deploy");
  assert.deepEqual(dep!.dependencies, ["test-writer"], "declared capabilities[] becomes a requires edge to a routed peer");
});

test("declared-but-unrouted dependencies surface as composition warnings", async () => {
  const plan = await planWorkflow({ ctx: ctx("deploy the app", [TEST_WRITER, GHOST_DEPLOYER]) });
  const dep = plan.steps.find((s) => s.capabilityId === "deploy-ghost");
  assert.ok(dep, "ghost deployer routes for the deployment subtask");
  assert.deepEqual(dep!.dependencies, [], "ghost-cap was never routed, no edge");
  assert.ok(plan.composed, "composition still happens");
  assert.ok(plan.composed.validation.missing.some((m) => m.capabilityId === "ghost-cap"), "missing declared dependency reported");
  assert.ok(plan.note?.includes("missing"), "plan note flags the gap");
});

test("steps carry per-subtask routing detail", async () => {
  const plan = await planWorkflow({ ctx: ctx("deploy the app", [DB_MIGRATOR, TEST_WRITER, DEPLOYER]) });
  for (const step of plan.steps) {
    assert.ok(step.step >= 1);
    assert.ok(step.subtaskId.startsWith("subtask-"));
    assert.ok(step.confidence.length > 0);
    if (step.source === "routed") {
      assert.ok(step.score >= 30);
      assert.ok(step.capabilityId);
    }
  }
});

test("decomposition can be supplied by the caller", async () => {
  const decomposition = decomposeTask("migrate the database");
  const plan = await planWorkflow({ ctx: ctx("anything", [DB_MIGRATOR, TEST_WRITER, DEPLOYER]), decomposition });
  assert.equal(plan.decomposition, decomposition);
  assert.equal(plan.steps.length, decomposition.subtasks.length);
});

test("an explicit sequence routes each clause", async () => {
  const plan = await planWorkflow({ ctx: ctx("write tests, then deploy", [DB_MIGRATOR, TEST_WRITER, DEPLOYER]) });
  const descriptions = plan.steps.map((s) => s.subtaskDescription);
  assert.ok(descriptions.some((d) => /write/i.test(d)));
  assert.ok(descriptions.some((d) => /deploy/i.test(d)));
});

test("unmatched subtasks degrade to source 'none' without crashing composition", async () => {
  const plan = await planWorkflow({ ctx: ctx("brew coffee beans", [DB_MIGRATOR, TEST_WRITER, DEPLOYER]) });
  assert.ok(plan.steps.length > 0);
  const unmatched = plan.steps.filter((s) => s.source === "none");
  assert.ok(unmatched.length > 0, "generic cookbook stages without capability matches stay 'none'");
  assert.ok(plan.steps.every((s) => s.capabilityId === null || s.source === "routed"));
  assert.doesNotThrow(() => plan.composed, "composition tolerates partial routing");
  if (plan.composed) {
    assert.equal(plan.composed.validation.valid, true, "routed subset alone is dependency-safe");
  }
});