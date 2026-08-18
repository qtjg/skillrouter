import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorage } from "../../src/storage/sqlite.ts";
import { SkillRouterError } from "../../src/utils/errors.ts";
import type { Capability } from "../../src/core/types.ts";

function mockCapability(id: string, version = "1.0.0"): Capability {
  return {
    id,
    name: id,
    version,
    description: "test capability",
    type: "skill",
    schema: "skillrouter/v1",
    manifestPath: `/tmp/manifest-${id}.yaml`,
    trust: "unknown",
    compatibility: { opencode: "native" },
    permissions: { filesystem: { read: false, write: false }, network: { allowed: [] }, shell: { enabled: false } },
    risk: { declared: "low", score: 5 },
    metadata: { tags: ["test"] },
  };
}

test("SqliteStorage requires init before use", async () => {
  const storage = new SqliteStorage(":memory:");
  await assert.rejects(() => storage.allCapabilities(), (err: unknown) => err instanceof SkillRouterError && err.code === "E_STORAGE");
  storage.close();
});

test("SqliteStorage capability CRUD", async () => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  try {
    assert.equal(await storage.getCapability("a"), null);
    await storage.upsertCapability(mockCapability("a"));
    await storage.upsertCapability(mockCapability("b", "2.0.0"));
    const cap = await storage.getCapability("a");
    assert.equal(cap?.id, "a");
    const all = await storage.allCapabilities();
    assert.deepEqual(all.map((c) => c.id), ["a", "b"]);
    await storage.upsertCapability(mockCapability("a", "1.1.0"));
    assert.equal((await storage.getCapability("a"))?.version, "1.1.0");
    await storage.removeCapability("a");
    assert.equal(await storage.getCapability("a"), null);
  } finally {
    storage.close();
  }
});

test("SqliteStorage installed rows round-trip agents", async () => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  try {
    await storage.setInstalledState("a", "ACTIVE", { id: "a", version: "1.0.0", agents: ["opencode", "claude"] });
    const row = await storage.getInstalled("a");
    assert.equal(row?.state, "ACTIVE");
    assert.deepEqual(row?.agents, ["opencode", "claude"]);
    await storage.setInstalledState("a", "SUSPENDED", {});
    assert.equal((await storage.getInstalled("a"))?.state, "SUSPENDED");
    await storage.setInstalledState("b", "ENABLED", { id: "b", version: "2.0.0", installRoot: "/tmp/root" });
    assert.equal((await storage.getInstalled("b"))?.installRoot, "/tmp/root");
    assert.equal((await storage.allInstalled()).length, 2);
  } finally {
    storage.close();
  }
});

test("SqliteStorage preferences, trust, history, audit, cache", async () => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  try {
    await storage.setPreference("mode", "automatic");
    assert.equal(await storage.getPreference("mode"), "automatic");
    assert.deepEqual(await storage.allPreferences(), [{ key: "mode", value: "automatic" }]);

    await storage.setTrust("a", "trusted", "reviewed");
    const trust = await storage.getTrust("a");
    assert.equal(trust?.trust, "trusted");
    await storage.removeTrust("a");
    assert.equal(await storage.getTrust("a"), null);

    await storage.addHistory({ task: "write tests", project: null, decisionId: "d1", activations: "a", deactivations: "", selected: "a", mode: "assisted" });
    const history = await storage.getHistory({ task: "tests", limit: 10 });
    assert.equal(history.length, 1);
    assert.equal(history[0]?.decisionId, "d1");

    await storage.addAudit("cli", "install", "a", "v1");
    const audit = await storage.getAudit({ capability: "a" });
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.action, "install");

    await storage.setRouterCache("k", "v");
    assert.equal(await storage.getRouterCache("k"), "v");
  } finally {
    storage.close();
  }
});

test("SqliteStorage persists to disk across instances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-store-"));
  try {
    const dbPath = join(dir, "state", "skillrouter.db");
    const first = new SqliteStorage(dbPath);
    await first.init();
    await first.upsertCapability(mockCapability("persisted"));
    await first.setPreference("key", "value");
    first.close();

    const second = new SqliteStorage(dbPath);
    await second.init();
    try {
      assert.equal((await second.getCapability("persisted"))?.id, "persisted");
      assert.equal(await second.getPreference("key"), "value");
      assert.equal(second.dataDir, join(dir, "state"));
    } finally {
      second.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SqliteStorage rejects SQL injection via values", async () => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  try {
    const evil = "' OR 1=1; DROP TABLE preferences; --";
    await storage.setPreference(evil, "x");
    await storage.setPreference("clean", evil);
    assert.equal(await storage.getPreference(evil), "x");
    assert.equal(await storage.getPreference("' OR 1=1"), null);
    assert.equal(await storage.getPreference("clean"), evil);
    const preferences = await storage.allPreferences();
    assert.equal(preferences.length, 2);
  } finally {
    storage.close();
  }
});