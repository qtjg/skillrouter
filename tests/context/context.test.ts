import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorage } from "../../src/storage/sqlite.ts";
import { ContextEngine } from "../../src/context/engine.ts";
import { DEFAULT_CONFIG } from "../../src/config/config.ts";
import type { SkillRouterConfig } from "../../src/config/config.ts";
import type { Capability } from "../../src/core/types.ts";

function capability(id: string): Capability {
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

async function withStorage<T>(fn: (storage: SqliteStorage) => Promise<T>): Promise<T> {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  try {
    return await fn(storage);
  } finally {
    storage.close();
  }
}

test("collect assembles a normalized snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-ctx-"));
  try {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo", dependencies: { react: "^19.0.0" } }));
    await withStorage(async (storage) => {
      await storage.upsertCapability(capability("ui-kit"));
      await storage.setInstalledState("ui-kit", "ACTIVE", { id: "ui-kit", version: "1.0.0", agents: ["opencode"] });
      await storage.addHistory({
        task: "build landing page",
        project: null,
        decisionId: "dec-1",
        activations: '["ui-kit"]',
        deactivations: "[]",
        selected: '["ui-kit"]',
        mode: "assisted",
      });
      await storage.setPreference("mode", "automatic");

      const engine = new ContextEngine(storage, DEFAULT_CONFIG);
      const snapshot = await engine.collect({ task: "build landing page", cwd: dir });

      assert.equal(snapshot.task, "build landing page");
      assert.equal(snapshot.cwd, dir);
      assert.equal(snapshot.project?.packageManager, "npm");
      assert.ok(snapshot.project?.dependencies.includes("react"));
      assert.equal(snapshot.environment.node.length > 0, true);
      assert.equal(snapshot.environment.offline, false);
      assert.deepEqual(snapshot.capabilities.map((c) => c.id), ["ui-kit"]);
      assert.equal(snapshot.activeCapabilities.length, 1);
      assert.deepEqual(snapshot.activeCapabilities[0], { id: "ui-kit", state: "ACTIVE", version: "1.0.0", agents: ["opencode"] });
      assert.equal(snapshot.history.length, 1);
      assert.equal(snapshot.history[0]!.decisionId, "dec-1");
      assert.deepEqual(snapshot.preferences.map((p) => ({ ...p })), [{ key: "mode", value: "automatic" }]);
      assert.equal(snapshot.threshold, DEFAULT_CONFIG.router.threshold);
      assert.equal(snapshot.sources.includes("project"), true);
      assert.equal(snapshot.sources.includes("git"), true);
      assert.deepEqual(snapshot.warnings, []);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("collect surfaces active agents from config and honors offline flag", async () => {
  await withStorage(async (storage) => {
    const config: SkillRouterConfig = {
      ...DEFAULT_CONFIG,
      agents: { ...DEFAULT_CONFIG.agents, opencode: true, gemini: false, claude: false, generic: false },
    };
    const engine = new ContextEngine(storage, config);
    const snapshot = await engine.collect({ cwd: process.cwd(), offline: true, historyLimit: 5 });
    assert.deepEqual(snapshot.environment.agentIds, ["opencode"]);
    assert.equal(snapshot.environment.offline, true);
    assert.equal(snapshot.capabilities.length, 0);
    assert.deepEqual(snapshot.activeCapabilities, []);
  });
});

test("failing collectors degrade to warnings instead of aborting", async () => {
  await withStorage(async (storage) => {
    const engine = new ContextEngine(storage, DEFAULT_CONFIG);
    const original = storage.allCapabilities.bind(storage);
    (storage as unknown as { allCapabilities: () => Promise<never> }).allCapabilities = () => Promise.reject(new Error("store down"));
    try {
      const snapshot = await engine.collect({ cwd: process.cwd() });
      assert.deepEqual(snapshot.capabilities, []);
      assert.ok(snapshot.sources.includes("capabilities"));
      assert.deepEqual(snapshot.warnings, ["capabilities: store down"]);
    } finally {
      (storage as unknown as { allCapabilities: () => Promise<Capability[]> }).allCapabilities = original;
    }
  });
});

test("collect includes git context when in a repository", async () => {
  await withStorage(async (storage) => {
    const engine = new ContextEngine(storage, DEFAULT_CONFIG);
    const snapshot = await engine.collect({ cwd: process.cwd() });
    assert.ok(snapshot.git);
    assert.equal(typeof snapshot.git.repoRoot, "string");
    assert.equal(snapshot.git.repoRoot, process.cwd());
  });
});