import { test } from "node:test";
import assert from "node:assert/strict";
import { inferGitSignals } from "../../src/git/signals.ts";

test("inferGitSignals maps changed files to task signals", () => {
  const signals = inferGitSignals(["src/auth/login.tsx", "src/components/button.tsx"]);
  assert.ok(signals.includes("authentication"));
  assert.ok(signals.includes("frontend"));
  assert.ok(signals.includes("typescript"));
});

test("inferGitSignals detects testing files", () => {
  assert.ok(inferGitSignals(["tests/api.test.ts"]).includes("testing"));
  assert.ok(inferGitSignals(["src/__tests__/x.spec.js"]).includes("testing"));
});

test("inferGitSignals detects deployment and payments", () => {
  assert.ok(inferGitSignals(["Dockerfile", ".github/workflows/ci.yml"]).includes("deployment"));
  assert.ok(inferGitSignals(["src/stripe.ts"]).includes("payments"));
  assert.ok(inferGitSignals(["src/stripe.ts", "webhook-handler.ts"]).includes("webhook"));
});

test("inferGitSignals returns empty for no files", () => {
  assert.deepEqual(inferGitSignals([]), []);
});

test("inferGitSignals deduplicates signals", () => {
  const signals = inferGitSignals(["a.tsx", "b.ts", "c.js"]);
  assert.equal(signals.filter((s) => s === "typescript").length, 1);
  assert.ok(signals.includes("refactoring"));
});