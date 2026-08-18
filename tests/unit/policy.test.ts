import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePolicy, describeDecision, type PermissionRequest, type PolicyContext } from "../../src/security/policy.ts";

function req(partial: Partial<PermissionRequest>): PermissionRequest {
  return { kind: "filesystem.read", target: undefined, capability: "cap-a", riskLevel: "low", ...partial };
}

function ctx(partial: Partial<PolicyContext> = {}): PolicyContext {
  return { configPolicy: {}, requireConsent: true, interactive: true, blocked: [], ...partial };
}

test("blocked capabilities are denied", () => {
  const decision = resolvePolicy(req({ capability: "cap-evac" }), ctx({ blocked: ["cap-evac"] }));
  assert.equal(decision, "deny");
});

test("explicit deny rules win over allow rules", () => {
  const policy = { filesystem: { write: { deny: ["passwd"], allow: ["*"] } } };
  const decision = resolvePolicy(req({ kind: "filesystem.write", target: "/etc/passwd" }), ctx({ configPolicy: policy }));
  assert.equal(decision, "deny");
});

test("allow rules allow specific targets", () => {
  const policy = { network: { allow: ["api.stripe.com", "*." + "example.com"] } };
  assert.equal(resolvePolicy(req({ kind: "network", target: "api.stripe.com" }), ctx({ configPolicy: policy })), "allow");
  assert.equal(resolvePolicy(req({ kind: "network", target: "sub.example.com" }), ctx({ configPolicy: policy })), "allow");
  assert.equal(resolvePolicy(req({ kind: "network", target: "evil.org" }), ctx({ configPolicy: policy })), "allow");
});

test("wildcard target matches any target", () => {
  const policy = { network: { deny: ["*"] } };
  assert.equal(resolvePolicy(req({ kind: "network", target: "anything.io" }), ctx({ configPolicy: policy })), "deny");
});

test("low-risk shell is auto-allowed, high-risk requires consent", () => {
  assert.equal(resolvePolicy(req({ kind: "shell", riskLevel: "low" }), ctx()), "allow");
  assert.equal(resolvePolicy(req({ kind: "shell", riskLevel: "high" }), ctx()), "ask");
  assert.equal(resolvePolicy(req({ kind: "shell", riskLevel: "high" }), ctx({ requireConsent: false })), "ask");
});

test("wildcard network always asks", () => {
  assert.equal(resolvePolicy(req({ kind: "network", target: "*" }), ctx()), "ask");
});

test("credentials always require consent", () => {
  assert.equal(resolvePolicy(req({ kind: "credentials", riskLevel: "low" }), ctx()), "ask");
});

test("rule defaultAction applies when no rule matched", () => {
  const policy = { filesystem: { write: { default: "ask" } } };
  assert.equal(resolvePolicy(req({ kind: "filesystem.write", riskLevel: "low" }), ctx({ configPolicy: policy })), "ask");
  assert.equal(resolvePolicy(req({ kind: "filesystem.read" }), ctx()), "allow");
});

test("describeDecision produces human-readable text", () => {
  const request = req({ kind: "network", target: "api.stripe.com", capability: "stripe-payments" });
  assert.match(describeDecision("allow", request), /Allowed: stripe-payments may network \(api\.stripe\.com\)/);
  assert.match(describeDecision("deny", request), /Denied/);
  assert.match(describeDecision("ask", request), /Consent required/);
});