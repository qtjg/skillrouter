import { test } from "node:test";
import assert from "node:assert/strict";
import { decomposeTask, splitConnectors } from "../../src/task/decompose.ts";

test("explicit sequences are preserved in order", () => {
  const d = decomposeTask("write the tests, then deploy the app");
  assert.ok(d.subtasks.length >= 2);
  assert.match(d.subtasks[0]!.description, /write/i);
  assert.match(d.subtasks[d.subtasks.length - 1]!.description, /deploy/i);
  assert.equal(d.confidence, 0.9);
  assert.equal(d.note, "explicit task sequence preserved");
  assert.ok(d.subtasks.every((s) => s.source === "explicit"));
});

test("splitConnectors handles several separators", () => {
  assert.deepEqual(splitConnectors("alpha; beta -> gamma"), ["alpha", "beta", "gamma"]);
  assert.deepEqual(splitConnectors("alpha and then beta and then gamma"), ["alpha", "beta", "gamma"]);
});

test("recipe tasks produce an ordered stage list tied to the primary operation", () => {
  const d = decomposeTask("deploy the app");
  assert.ok(d.subtasks.length >= 4, "deployment recipe has multiple stages");
  assert.match(d.subtasks[0]!.stage ?? "", /build/i);
  assert.match(d.subtasks[1]!.description, /test/i);
  assert.match(d.subtasks[d.subtasks.length - 1]!.description, /verify/i);
  assert.equal(d.confidence, 0.7);
  assert.ok(d.subtasks.every((s) => s.source === "recipe"));
  assert.ok(d.subtasks.every((s) => s.operations.includes("deployment")));
});

test("recipe subtasks carry the parent technologies for independent routing", () => {
  const d = decomposeTask("deploy the app using kubernetes");
  for (const subtask of d.subtasks) {
    assert.ok(subtask.technologies.includes("kubernetes"), `subtask ${subtask.id} should carry kubernetes`);
    assert.ok(subtask.domains.includes("devops"));
  }
});

test("multiple operations fold into a combined recipe without duplicates", () => {
  const d = decomposeTask("write tests and deploy");
  const descriptions = d.subtasks.map((s) => s.description);
  assert.equal(new Set(descriptions).size, descriptions.length, "no duplicate stage descriptions");
  assert.ok(d.subtasks.length <= 10);
});

test("deterministic: same task decomposes identically", () => {
  const a = decomposeTask("refactor the auth service");
  const b = decomposeTask("refactor the auth service");
  assert.deepEqual(a, b);
});