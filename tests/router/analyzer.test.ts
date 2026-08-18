import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeTask, canonicalTechnology, isTechnologyToken, describeAnalysis } from "../../src/router/analyzer.ts";
import { RouterError } from "../../src/utils/errors.ts";

test("analyzeTask detects technologies, domains and operations", () => {
  const analysis = analyzeTask("write unit tests with vitest for the stripe checkout flow");
  assert.ok(analysis.technologies.includes("vitest"), JSON.stringify(analysis.technologies));
  assert.ok(analysis.technologies.includes("stripe"));
  assert.ok(analysis.domains.includes("testing"));
  assert.ok(analysis.domains.includes("payments"));
  assert.ok(analysis.operations.includes("testing"));
  assert.ok(analysis.operations.includes("implementation"));
  assert.ok(analysis.tokens.length > 0);
});

test("analyzeTask assigns risk estimates", () => {
  assert.equal(analyzeTask("deploy to production").riskEstimate, "high");
  assert.equal(analyzeTask("run a security audit on the auth module").riskEstimate, "high");
  assert.equal(analyzeTask("refactor the header component").riskEstimate, "low");
  const medium = analyzeTask("add a payment page");
  assert.ok(["medium", "high"].includes(medium.riskEstimate));
});

test("analyzeTask defaults to implementation when no operation matches", () => {
  const analysis = analyzeTask("ponder the existential nature of shims");
  assert.deepEqual(analysis.operations, ["implementation"]);
});

test("canonicalTechnology maps aliases", () => {
  assert.equal(canonicalTechnology("next.js"), "nextjs");
  assert.equal(canonicalTechnology("k8s"), "kubernetes");
  assert.equal(canonicalTechnology("postgres"), "postgresql");
  assert.equal(canonicalTechnology("vite"), null);
  assert.equal(isTechnologyToken("dockerfile"), true);
  assert.equal(isTechnologyToken("banana"), false);
});

test("describeAnalysis renders summary lines", () => {
  const lines = describeAnalysis(analyzeTask("write tests"));
  assert.ok(lines.some((l) => l.startsWith("operations:")));
  assert.ok(lines.some((l) => l.startsWith("risk:")));
});

test("Router rejects empty tasks", async () => {
  const { Router } = await import("../../src/router/index.ts");
  const { mockCapabilities, mockInstalled } = await import("../../src/utils/mockdata.ts");
  const { DEFAULT_CONFIG } = await import("../../src/config/config.ts");
  const router = new Router();
  await assert.rejects(
    () =>
      router.route({
        task: "   ",
        cwd: "/tmp",
        project: null,
        git: null,
        capabilities: mockCapabilities(),
        installed: mockInstalled(),
        agents: ["opencode"],
        config: DEFAULT_CONFIG,
      }),
    (err: unknown) => err instanceof RouterError,
  );
});