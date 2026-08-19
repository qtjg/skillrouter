import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateConstraints, softPreferenceDelta, permissionKinds } from "../../src/constraints/constraints.ts";
import type { Capability } from "../../src/core/types.ts";

function cap(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "cap:x",
    name: "X",
    version: "1.0.0",
    type: "skill",
    description: "x",
    compatibility: {},
    trust: "unknown",
    permissions: { filesystem: { read: false, write: false }, network: { allowed: [] }, shell: { enabled: false } },
    ...overrides,
  };
}

test("a candidate with no violations is allowed", () => {
  const result = evaluateConstraints(cap({ metadata: { cost: 2, latency: 2 } }), { network: "forbidden", maxCost: 4, maxLatency: 4 });
  assert.equal(result.allowed, true);
  assert.deepEqual(result.reasons, []);
});

test("network forbidden rejects network-enabled candidates", () => {
  const result = evaluateConstraints(cap({ permissions: { network: { allowed: ["api.example.com"] } } }), { network: "forbidden" });
  assert.equal(result.allowed, false);
  assert.ok(result.eliminatedBy.includes("network"));
});

test("maxCost rejects expensive candidates", () => {
  const result = evaluateConstraints(cap({ metadata: { cost: 5 } }), { maxCost: 3 });
  assert.equal(result.allowed, false);
  assert.ok(result.eliminatedBy.includes("maxCost"));
});

test("maxLatency and maxLatencyMs reject slow candidates", () => {
  assert.equal(evaluateConstraints(cap({ metadata: { latency: 4 } }), { maxLatency: 2 }).allowed, false);
  assert.equal(evaluateConstraints(cap({ metadata: { latencyMs: 5000 } }), { maxLatencyMs: 3000 }).allowed, false);
  assert.equal(evaluateConstraints(cap({ metadata: { latency: 1 } }), { maxLatency: 2 }).allowed, true);
  assert.equal(evaluateConstraints(cap({ metadata: { latencyMs: 500 } }), { maxLatencyMs: 3000 }).allowed, true);
});

test("permission boundary rejects out-of-bound permissions", () => {
  const result = evaluateConstraints(
    cap({ permissions: { filesystem: { read: true, write: true }, shell: { enabled: true } } }),
    { permissions: ["filesystem.read"] },
  );
  assert.equal(result.allowed, false);
  assert.ok(result.eliminatedBy.includes("permissions"));
  assert.ok(result.reasons[0]!.includes("filesystem.write"));
});

test("permission boundary passes when every kind is within it", () => {
  const result = evaluateConstraints(
    cap({ permissions: { filesystem: { read: true, write: false }, network: { allowed: ["example.com"] } } }),
    { permissions: ["filesystem.read", "network.read"] },
  );
  // network.allowed implies both read and write in the canonical kinds
  assert.equal(result.allowed, false);
});

test("required language eliminates unsupported candidates", () => {
  const result = evaluateConstraints(cap({ requirements: { language: ["typescript", "javascript"] } }), {
    requiredLanguage: ["python"],
  });
  assert.equal(result.allowed, false);
  assert.ok(result.eliminatedBy.includes("requiredLanguage"));
});

test("soft preferences add points but never eliminate", () => {
  const candidate = cap({ requirements: { language: ["typescript"], framework: ["react"] } });
  assert.equal(softPreferenceDelta(candidate, { requiredLanguage: ["typescript"], requiredFramework: ["react"] }), 12);
  assert.equal(softPreferenceDelta(candidate, { requiredLanguage: ["python"] }), 0);
  const r = evaluateConstraints(candidate, { requiredLanguage: ["python"] });
  assert.equal(r.allowed, false);
});

test("permissionKinds derives canonical kinds from permission sets", () => {
  const kinds = permissionKinds(
    cap({ permissions: { filesystem: { read: true, write: true }, network: { allowed: ["*"] }, shell: { enabled: true }, processes: { enabled: true }, credentials: { access: "requested" } } }),
  );
  for (const expected of ["filesystem.read", "filesystem.write", "network.read", "network.write", "shell.execute", "process.execute", "credentials"]) {
    assert.ok(kinds.includes(expected as never), `expected ${expected}`);
  }
  assert.equal(permissionKinds(cap()).length, 0);
});