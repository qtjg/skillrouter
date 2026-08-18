import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidCapabilityId, assertValidCapabilityId } from "../../src/core/ids.ts";
import { SkillRouterError } from "../../src/utils/errors.ts";

test("isValidCapabilityId accepts lowercase ids", () => {
  assert.equal(isValidCapabilityId("stripe-expert"), true);
  assert.equal(isValidCapabilityId("nextjs-optimizer"), true);
  assert.equal(isValidCapabilityId("a"), true);
  assert.equal(isValidCapabilityId("0abc"), true);
});

test("isValidCapabilityId rejects invalid ids", () => {
  assert.equal(isValidCapabilityId("Stripe"), false);
  assert.equal(isValidCapabilityId("stripe expert"), false);
  assert.equal(isValidCapabilityId("cap:test-writer"), false);
  assert.equal(isValidCapabilityId("-leading"), false);
  assert.equal(isValidCapabilityId("trailing-"), false);
  assert.equal(isValidCapabilityId(""), false);
  assert.equal(isValidCapabilityId("x".repeat(65)), false);
});

test("assertValidCapabilityId throws SkillRouterError on invalid id", () => {
  assert.throws(() => assertValidCapabilityId("Bad ID"), (err: unknown) => err instanceof SkillRouterError && err.code === "E_ID");
  assert.doesNotThrow(() => assertValidCapabilityId("good-id"));
});