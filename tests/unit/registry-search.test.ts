import { test } from "node:test";
import assert from "node:assert/strict";
import { mockCapabilities } from "../../src/utils/mockdata.ts";
import { rankCapabilities, fuzzyIdMatch } from "../../src/registry/search.ts";
import type { Capability } from "../../src/core/types.ts";

function cap(id: string): Capability {
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
  };
}

test("rankCapabilities finds best matches first", () => {
  const results = rankCapabilities("write unit tests", mockCapabilities());
  assert.ok(results.length > 0);
  assert.equal(results[0]?.id, "cap:test-writer");
});

test("rankCapabilities empty query returns nothing", () => {
  assert.deepEqual(rankCapabilities("   ", mockCapabilities()), []);
});

test("rankCapabilities applies limit and minScore", () => {
  const results = rankCapabilities("deploy to production", mockCapabilities(), { limit: 2, minScore: 5 });
  assert.ok(results.length <= 2);
  assert.ok(results[0]?.id === "cap:deployer");
});

test("fuzzyIdMatch finds exact, prefix and close ids", () => {
  const caps = [cap("deployer"), cap("deployer-cli"), cap("stripe-expert"), cap("stripe-webhook")];
  assert.equal(fuzzyIdMatch("deployer", caps)?.id, "deployer");
  assert.equal(fuzzyIdMatch("deploy", caps)?.id, "deployer");
  assert.equal(fuzzyIdMatch("stripe", caps)?.id, "stripe-expert");
  assert.equal(fuzzyIdMatch("xyzzy-plugh", caps), null);
});