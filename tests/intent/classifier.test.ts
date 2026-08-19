import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, INTENTS, type IntentType } from "../../src/intent/classifier.ts";

test("classifies a debugging task", () => {
  const result = classifyIntent("fix this React error");
  assert.equal(result.intent, "debugging");
  assert.ok(result.confidence > 0.4);
  assert.ok(result.signals.includes("fix"));
  assert.ok(Array.isArray(result.language));
});

test("classifies a debugging task enriched by project context", () => {
  const result = classifyIntent("fix this React error", {
    fields: { "project.language": ["typescript"] },
    warnings: [],
    timeline: [],
    collectedAt: "",
  });
  assert.equal(result.intent, "debugging");
  assert.ok(result.language.includes("typescript"));
});

test("classifies a testing task", () => {
  const result = classifyIntent("write unit tests for the API");
  assert.equal(result.intent, "testing");
  assert.ok(result.confidence > 0.4);
});

test("classifies a deployment task", () => {
  const result = classifyIntent("deploy the app to production");
  assert.equal(result.intent, "deployment");
  assert.ok(result.confidence > 0.4);
});

test("classifies a security task", () => {
  const result = classifyIntent("audit authentication vulnerabilities");
  assert.equal(result.intent, "security");
});

test("classifies a documentation task", () => {
  const result = classifyIntent("write documentation for the readme");
  assert.equal(result.intent, "documentation");
});

test("classifies a refactoring task", () => {
  const result = classifyIntent("refactor the payment module");
  assert.equal(result.intent, "refactoring");
});

test("classifies a coding task", () => {
  const result = classifyIntent("implement a new feature");
  assert.equal(result.intent, "coding");
});

test("classifies a research task", () => {
  const result = classifyIntent("research best practices for rate limiting");
  assert.equal(result.intent, "research");
});

test("classifies a generation task", () => {
  const result = classifyIntent("generate a scaffold for a new component");
  assert.equal(result.intent, "generation");
});

test("classifies an analysis task", () => {
  const result = classifyIntent("inspect the performance profile");
  assert.ok(["analysis", "debugging"].includes(result.intent));
});

test("unknown task falls back to analysis with low confidence", () => {
  const result = classifyIntent("xylophone quantum widget");
  assert.equal(result.intent, "analysis");
  assert.ok(result.confidence <= 0.1);
  assert.deepEqual(result.signals, []);
});

test("ambiguous task yields medium confidence", () => {
  const result = classifyIntent("add tests and fix the bug");
  assert.ok(["testing", "debugging"].includes(result.intent), `got ${result.intent}`);
  assert.ok(result.confidence < 0.8, `ambiguous intent confidence should stay bounded, got ${result.confidence}`);
  assert.ok(INTENTS.includes(result.intent as IntentType));
});

test("classifier is deterministic across calls", () => {
  const first = classifyIntent("write unit tests for the API");
  const second = classifyIntent("write unit tests for the API");
  assert.equal(first.intent, second.intent);
  assert.equal(first.confidence, second.confidence);
});