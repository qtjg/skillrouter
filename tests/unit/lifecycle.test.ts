import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, transitionReason, transition, permittedTargets } from "../../src/core/lifecycle.ts";
import { SkillRouterError } from "../../src/utils/errors.ts";

test("valid lifecycle transitions", () => {
  assert.equal(canTransition("DISCOVERED", "INSTALLED"), true);
  assert.equal(canTransition("CANDIDATE", "ACTIVE"), true);
  assert.equal(canTransition("ACTIVE", "BLOCKED"), true);
  assert.equal(canTransition("BLOCKED", "ENABLED"), true);
  assert.equal(canTransition("ENABLED", "CANDIDATE"), true);
});

test("invalid transitions are rejected", () => {
  assert.equal(canTransition("DISCOVERED", "ACTIVE"), false);
  assert.equal(canTransition("ACTIVE", "INSTALLED"), true);
  assert.equal(canTransition("BLOCKED", "CANDIDATE"), false);
});

test("transitionReason explains valid pairs and null for invalid", () => {
  assert.equal(transitionReason("ACTIVE", "SUSPENDED"), "temporarily suspended");
  assert.equal(transitionReason("ACTIVE", "CANDIDATE"), null);
});

test("transition throws SkillRouterError on illegal move", () => {
  assert.throws(() => transition("DISCOVERED", "ACTIVE"), (err: unknown) => err instanceof SkillRouterError && err.code === "E_STATE");
  assert.equal(transition("DISCOVERED", "INSTALLED"), "INSTALLED");
});

test("permittedTargets lists out-edges", () => {
  const targets = permittedTargets("ENABLED");
  assert.ok(targets.includes("CANDIDATE"));
  assert.ok(targets.includes("ACTIVE"));
  assert.ok(targets.includes("DISABLED"));
  assert.ok(!targets.includes("DISCOVERED"));
});