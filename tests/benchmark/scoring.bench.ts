import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Router } from "../../src/router/index.ts";
import { mockCapabilities, mockInstalled } from "../../src/utils/mockdata.ts";
import { DEFAULT_CONFIG } from "../../src/config/config.ts";

const ITERATIONS = 200;

async function routeContext() {
  const cwd = await mkdtemp(join(tmpdir(), "skillrouter-bench-"));
  return {
    task: "write unit tests for the CLI",
    cwd,
    project: { root: cwd, languages: ["typescript"], frameworks: ["typescript"], packageManager: null, dependencies: [], devDependencies: [], databases: [], cloudProviders: [], testingFrameworks: [], configFiles: [], docker: false, isTypescript: true, isJavascript: false, signals: [] },
    git: { repoRoot: null, branch: null, changed: [], staged: [], commitCount: 0, signals: [] },
    capabilities: mockCapabilities(),
    installed: mockInstalled(),
    agents: [],
    config: DEFAULT_CONFIG,
  };
}

test(`benchmark: ${ITERATIONS} full routes complete well under budget`, async () => {
  const router = new Router();
  const ctx = await routeContext();

  // warm-up (module caches, storage handles, etc.)
  await router.route(ctx);

  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await router.route(ctx);
  }
  const elapsedMs = performance.now() - start;

  // Scoring measured ~68M ops/sec in self-test; a full route (analysis +
  // scoring + planning) should stay in the low milliseconds. The bound here
  // is deliberately generous so CI machines never flake.
  assert.ok(elapsedMs < 20_000, `expected ${ITERATIONS} routes < 20s, took ${elapsedMs.toFixed(0)}ms`);
});

test("benchmark: routing is deterministic for identical inputs", async () => {
  const router = new Router();
  const ctx = await routeContext();

  const first = await router.route(ctx);
  const second = await router.route(ctx);

  const idsOf = (d: Awaited<ReturnType<Router["route"]>>) => d.plan.map((p) => p.capabilityId).join(",");
  assert.equal(idsOf(first), idsOf(second));
});
