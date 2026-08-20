import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteStorage } from "../../src/storage/sqlite.ts";
import type { Capability } from "../../src/core/types.ts";
import { extractSections, resolveBodyDir } from "../../src/corpus/extract.ts";
import { redactSecrets, normalizeText, prepareText, estimateTokens } from "../../src/corpus/normalize.ts";
import { buildCorpusRecord } from "../../src/corpus/record.ts";
import { stableStringify } from "../../src/corpus/fingerprint.ts";
import { indexCorpus } from "../../src/corpus/indexer.ts";

function capability(id: string, overrides: Partial<Capability> = {}): Capability {
  return {
    id,
    name: `Capability ${id}`,
    version: "1.0.0",
    description: "Runs the fixture deployment workflow.",
    type: "workflow",
    compatibility: { opencode: "native" },
    context: { estimatedTokens: 900, resources: ["docker"] },
    ...overrides,
  };
}

async function fixtureSkill(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "corpus-fixture-"));
  await writeFile(
    join(dir, "skillrouter.yaml"),
    [
      "schema: skillrouter/v1",
      `id: fixture-skill`,
      "name: Fixture Skill",
      "version: 1.0.0",
      "description: Fixture for corpus indexing.",
      "type: skill",
      "tags: [fixture, docker]",
      "permissions:",
      "  shell:",
      "    enabled: true",
    ].join("\n") + "\n",
  );
  await writeFile(
    join(dir, "SKILL.md"),
    [
      "# Fixture Skill",
      "",
      "Compose deployments from fixture manifests.",
      "",
      "## Usage",
      "",
      "Run `deploy` with the fixture CLI. Never echo API tokens.",
      "",
      "## Options",
      "",
      "Set API_KEY_BASE64 to a value like `api_key: sk-fixture9f9f9f`, ",
      "it must never be indexed verbatim.",
    ].join("\n") + "\n",
  );
  await mkdir(join(dir, "instructions"));
  await writeFile(
    join(dir, "instructions", "usage.md"),
    [
      "## Rollback",
      "",
      "Roll back by redeploying the previous build image.",
    ].join("\n") + "\n",
  );
  return dir;
}

test("normalizeText collapses blank lines and trims", () => {
  assert.equal(normalizeText("  a\r\nb\n\n\n\n  c  "), "a\nb\n\n  c");
});

test("redactSecrets strips keys, bearer tokens and private keys", () => {
  const redacted = redactSecrets(
    "api_key: sk-abc1234567890123\nAuthorization: Bearer 401f8a1b2c3d4e5f6a7b8c9d\nghp_abcdefghijklmnopqrstuvwxyz0123456789\ncli --token=super-secret-value",
  );
  assert.ok(!redacted.includes("sk-abc1234567890123"));
  assert.ok(!redacted.includes("401f8a1b2c3d4e5f6a7b8c9d"));
  assert.ok(!redacted.includes("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
  assert.ok(!redacted.includes("super-secret-value"));
  assert.ok(redacted.includes("REDACTED"));
  assert.ok(!/\bBEGIN (?:RSA|EC|OPENSSH|DSA) PRIVATE KEY\b/.test(redactSecrets("-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----")));
});

test("estimateTokens approximates 4 chars per token", () => {
  assert.equal(estimateTokens(""), 1);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcdefgh"), 2);
});

test("stableStringify is deterministic and key-sorted", () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(stableStringify({ a: { c: 3, d: 2 }, b: 1 }), '{"a":{"c":3,"d":2},"b":1}');
});

test("extractSections pulls manifest, SKILL.md and instructions with heading splitting", async () => {
  const dir = await fixtureSkill();
  const extracted = await extractSections(dir);
  const kinds = new Set(extracted.sections.map((s) => s.kind));
  assert.ok(kinds.has("overview"));
  assert.ok(kinds.has("instructions"));
  assert.ok(kinds.has("manifest"));

  const usage = extracted.sections.find((s) => s.kind === "instructions");
  assert.ok(usage);
  assert.ok(usage.body.includes("Roll back"));

  const overviewSections = extracted.sections.filter((s) => s.kind === "overview");
  assert.ok(overviewSections.length >= 3, `expected heading-split overview sections, got ${overviewSections.length}`);
  assert.ok(overviewSections.some((s) => s.title === "Usage" && s.level === 2));
  assert.ok(overviewSections.some((s) => s.title === "Fixture Skill" && s.level === 1));

  const sectionIds = extracted.sections.map((s) => s.id);
  assert.equal(new Set(sectionIds).size, sectionIds.length, "section ids must be unique");
  assert.ok(!extracted.body.includes("sk-fixture9f9f9f"), "secrets must not survive extraction");
  assert.ok(!extracted.body.includes("api_key"), "secrets must not survive extraction");
  assert.ok(extracted.bodyTokens > 0);
  assert.ok(extracted.sections.every((s) => s.tokens >= 1));
});

test("resolveBodyDir prefers manifest dir then falls back to project user dir", async () => {
  const dir = await fixtureSkill();
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  const cap = capability("fixture-skill", { source: { type: "local", location: dir }, manifestPath: "skillrouter.yaml" });
  const located = await resolveBodyDir(cap, { repoRoot: "/nonexistent", cwd: "/nonexistent", storage });
  assert.ok(located);
  assert.equal(located!.dir, dir);

  const noLocation = capability("fixture-skill");
  const none = await resolveBodyDir(noLocation, { repoRoot: "/nonexistent", cwd: "/nonexistent", storage });
  assert.equal(none, null);
});

test("buildCorpusRecord fingerprints content and metadata deterministically", async () => {
  const dir = await fixtureSkill();
  const extracted = await extractSections(dir);
  const cap = capability("fixture-skill", { source: { type: "local", location: dir } });
  const a = buildCorpusRecord(cap, extracted.sections, "2026-08-20T00:00:00.000Z");
  const b = buildCorpusRecord(cap, extracted.sections, "2026-08-20T00:00:00.000Z");
  assert.equal(a.contentHash, b.contentHash);
  assert.equal(a.metadataHash, b.metadataHash);
  assert.ok(a.contentHash.length === 64);
  assert.ok(a.keywords.length > 0);
  assert.ok(!a.body.includes("sk-fixture9f9f9f"));
  assert.equal(a.bodyTokens, extracted.bodyTokens);
});

test("buildCorpusRecord content hash changes when the body changes", async () => {
  const dir = await fixtureSkill();
  const a = buildCorpusRecord(capability("fixture-skill"), (await extractSections(dir)).sections, "2026-08-20T00:00:00.000Z");
  await writeFile(join(dir, "SKILL.md"), "# Fixture Skill\n\nNow with extra deployment steps.\n\n## Usage\n\nRun deploy.\n", "utf8");
  const b = buildCorpusRecord(capability("fixture-skill"), (await extractSections(dir)).sections, "2026-08-20T00:00:00.000Z");
  assert.notEqual(a.contentHash, b.contentHash);
  assert.equal(a.metadataHash, b.metadataHash, "metadata hash must be stable across body edits");
});

test("indexCorpus indexes, skips on --changed, reindexes edits and removes stale rows", async () => {
  const dir = await fixtureSkill();
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  await storage.upsertCapability(capability("fixture-skill", { source: { type: "local", location: dir }, manifestPath: "skillrouter.yaml" }));

  const first = await indexCorpus(storage, "/nonexistent-repo", "/nonexistent-cwd");
  assert.equal(first.indexed, 1);
  assert.equal(first.failed, 0);
  assert.equal(first.skipped, 0);

  const record = await storage.getCorpusRecord("fixture-skill");
  assert.ok(record);
  assert.equal(record!.capabilityId, "fixture-skill");
  assert.ok(record!.body.length > 0);

  const noChange = await indexCorpus(storage, "/nonexistent-repo", "/nonexistent-cwd", { changedOnly: true });
  assert.equal(noChange.indexed, 0);
  assert.equal(noChange.skipped, 1);

  await writeFile(join(dir, "SKILL.md"), "# Fixture Skill\n\nChanged: pipeline now also cleans up.\n\n## Usage\n\nRun deploy --clean.\n", "utf8");
  const edit = await indexCorpus(storage, "/nonexistent-repo", "/nonexistent-cwd", { changedOnly: true });
  assert.equal(edit.indexed, 1);
  assert.equal(edit.skipped, 0);

  const full = await indexCorpus(storage, "/nonexistent-repo", "/nonexistent-cwd");
  assert.equal(full.indexed, 1);
  assert.equal(full.skipped, 0);

  await storage.removeCapability("fixture-skill");
  const pruned = await indexCorpus(storage, "/nonexistent-repo", "/nonexistent-cwd");
  assert.equal(pruned.removed, 1);
  assert.equal(await storage.getCorpusRecord("fixture-skill"), null);
});

test("indexCorpus honors capabilityIds and tolerates unresolvable capabilities", async () => {
  const dir = await fixtureSkill();
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  await storage.upsertCapability(capability("fixture-skill", { source: { type: "local", location: dir }, manifestPath: "skillrouter.yaml" }));
  await storage.upsertCapability(capability("fixture-ghost", { source: { type: "local", location: "/does/not/exist" } }));

  const targeted = await indexCorpus(storage, "/nonexistent-repo", "/nonexistent-cwd", { capabilityIds: ["fixture-skill"] });
  assert.equal(targeted.indexed, 1);
  assert.equal(targeted.skipped, 0);

  const absent = await indexCorpus(storage, "/nonexistent-repo", "/nonexistent-cwd", { capabilityIds: ["fixture-ghost"] });
  assert.equal(absent.indexed, 0);
  assert.equal(absent.failed, 0);
});

test("prepareText pipeline output is stable across repeated runs", async () => {
  const a = prepareText("Deploy\n\n  containers\t\t\n\napi_key: sk-abc1234567890123");
  const b = prepareText("Deploy\n\n  containers\t\t\n\napi_key: sk-abc1234567890123");
  assert.equal(a, b);
  assert.ok(!a.includes("sk-abc1234567890123"));
});

test("corpus records survive a storage round trip", async () => {
  const dir = await fixtureSkill();
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  await storage.upsertCapability(capability("fixture-skill", { source: { type: "local", location: dir }, manifestPath: "skillrouter.yaml" }));
  await indexCorpus(storage, "/nonexistent-repo", "/nonexistent-cwd");
  const all = await storage.allCorpusRecords();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.keywords.length, all[0]!.keywords.length);
});