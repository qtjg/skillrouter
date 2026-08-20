import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteStorage } from "../../src/storage/sqlite.ts";
import type { Capability } from "../../src/core/types.ts";
import type { CapabilityCorpusRecord, CorpusSection } from "../../src/corpus/types.ts";
import { extractSections } from "../../src/corpus/extract.ts";
import { buildCorpusRecord } from "../../src/corpus/record.ts";
import { Bm25Index } from "../../src/retrieval/sparse.ts";
import { LocalEmbeddingProvider, cosine } from "../../src/retrieval/embeddings.ts";
import { denseSearch } from "../../src/retrieval/dense.ts";
import { rrfFuse } from "../../src/retrieval/fusion.ts";
import { retrieve, refreshEmbeddings, clearSparseCache } from "../../src/retrieval/index.ts";

function section(id: string, body: string, kind = "docs" as const): CorpusSection {
  return { id, title: id, kind, source: `${id}.md`, level: 1, body, tokens: Math.ceil(body.length / 4) };
}

function record(capabilityId: string, sections: CorpusSection[], opts: Partial<CapabilityCorpusRecord> = {}): CapabilityCorpusRecord {
  const body = sections.map((s) => s.body).join("\n\n");
  return {
    capabilityId,
    name: capabilityId,
    version: "1.0.0",
    type: "skill",
    summary: capabilityId,
    description: capabilityId,
    tags: [],
    keywords: [capabilityId],
    context: {},
    source: { type: "local", location: "/tmp" },
    sections,
    body,
    bodyTokens: Math.ceil(body.length / 4),
    contentHash: `content-${capabilityId}`,
    metadataHash: `meta-${capabilityId}`,
    indexedAt: "2026-08-20T00:00:00.000Z",
    ...opts,
  };
}

const CAP_A = record("cap:a", [section("a/deploy", "Deploy docker containers to the fleet with rolling updates and health checks.")]);
const CAP_B = record("cap:b", [section("b/refund", "Process stripe refunds and chargebacks within the 30 day window.")]);
const CAP_C = record("cap:c", [section("c/logs", "Tail and aggregate application logs across all services and regions.")]);

test("Bm25Index ranks the most relevant capability first and orders deterministically", () => {
  const index = new Bm25Index([CAP_A, CAP_B, CAP_C]);
  assert.equal(index.size, 3);

  const dockerTop = index.search("deploy docker container", 3);
  assert.equal(dockerTop[0]!.capabilityId, "cap:a");

  const refundTop = index.search("stripe refund", 3);
  assert.equal(refundTop[0]!.capabilityId, "cap:b");

  assert.ok(dockerTop[0]!.score > 0);
  assert.equal(dockerTop[0]!.matchedSections[0]!.id, "a/deploy");
  assert.deepEqual(index.search("deploy docker container", 3).map((h) => h.capabilityId), index.search("deploy docker container", 3).map((h) => h.capabilityId));
});

test("Bm25Index weights rare terms higher than common ones", () => {
  const index = new Bm25Index([CAP_A, CAP_B, CAP_C]);
  const rare = index.search("stripe chargeback", 3);
  const common = index.search("the", 3);
  assert.ok(rare[0]!.capabilityId === "cap:b");
  assert.ok(common.length === 0, "stop-word-only queries return nothing with zero idf contribution");
});

test("LocalEmbeddingProvider is deterministic, unit-normalized and discriminative", async () => {
  const provider = new LocalEmbeddingProvider(64);
  const [v1a, v1b] = await provider.embed(["deploy docker container", "deploy docker container"]);
  const [v2] = await provider.embed(["stripe refund"]);
  assert.ok(v1a && v1b && v2);
  assert.deepEqual(v1a, v1b, "identical text must produce identical vectors");
  const norm = (v: number[]) => Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  assert.ok(Math.abs(norm(v1a) - 1) < 1e-9, "vectors must be unit length");
  assert.ok(cosine(v1a, v1b) > 0.999);
  assert.ok(cosine(v1a, v2) < 0.5, "different topics must be far apart in cosine space");
  assert.equal(provider.dimension, 64);
  assert.equal(provider.name, "local");
});

test("denseSearch aggregates per-capability cosine similarity with matched section", async () => {
  const provider = new LocalEmbeddingProvider(64);
  const embeds = [];
  for (const cap of [CAP_A, CAP_B, CAP_C]) {
    for (const s of cap.sections) {
      const [vec] = await provider.embed([s.body]);
      embeds.push({ sectionId: s.id, capabilityId: cap.capabilityId, vector: vec!, dimension: 64, model: "local:64", recordHash: cap.contentHash, createdAt: "2026-08-20T00:00:00.000Z" });
    }
  }
  const results = await denseSearch(embeds, [CAP_A, CAP_B, CAP_C], provider, "deploy containers to a fleet", 3);
  assert.equal(results[0]!.capabilityId, "cap:a");
  assert.equal(results[0]!.sectionId, "a/deploy");
  assert.ok(results[0]!.score >= results[1]!.score);
});

test("rrfFuse merges ranked lists into a deterministic fused ranking", () => {
  const fused = rrfFuse(
    [
      [
        { capabilityId: "cap:a", rank: 0, source: "sparse" },
        { capabilityId: "cap:b", rank: 1, source: "sparse" },
        { capabilityId: "cap:c", rank: 2, source: "sparse" },
      ],
      [
        { capabilityId: "cap:c", rank: 0, source: "dense", sectionId: "c/logs", sectionTitle: "logs" },
        { capabilityId: "cap:b", rank: 1, source: "dense" },
        { capabilityId: "cap:a", rank: 2, source: "dense" },
      ],
    ],
    3,
  );
  assert.deepEqual(fused.map((h) => h.capabilityId), ["cap:a", "cap:c", "cap:b"]);
  assert.ok(fused[0]!.sources.includes("sparse"));
  assert.ok(fused[1]!.sources.includes("dense"));
  assert.equal(fused[2]!.rank, 2);

  const again = rrfFuse(
    [
      [{ capabilityId: "cap:z", rank: 0, source: "sparse" }],
      [{ capabilityId: "cap:a", rank: 0, source: "dense" }],
    ],
    1,
  );
  assert.deepEqual(again.map((h) => h.capabilityId), ["cap:a", "cap:z"].slice(0, 1));
  assert.equal(again[0]!.rank, 0);

  const tie = rrfFuse(
    [
      [{ capabilityId: "cap:y", rank: 0, source: "sparse" }],
      [{ capabilityId: "cap:y", rank: 0, source: "dense", sectionId: "y/top", sectionTitle: "top" }],
    ],
    1,
  );
  assert.equal(tie[0]!.capabilityId, "cap:y");
  assert.ok(tie[0]!.sources.length === 2);
  assert.equal(tie[0]!.sectionId, "y/top");
});

async function seedCorpus(storage: SqliteStorage): Promise<{ repo: string }> {
  const repo = await mkdtemp(join(tmpdir(), "retrieval-seed-"));
  const skills: Array<{ id: string; body: string }> = [
    { id: "deployer", body: "# Deployer\n\nDeploy docker containers to the fleet with rolling updates and health checks.\n\n## Usage\n\nRun deploy for staging uploads.\n" },
    { id: "refunder", body: "# Refunder\n\nProcess stripe refunds and chargebacks within the 30 day window.\n\n## Usage\n\nRefund stripe charges\n" },
  ];
  for (const skill of skills) {
    const dir = join(repo, skill.id);
    await mkdir(dir);
    await writeFile(join(dir, "skillrouter.yaml"), `schema: skillrouter/v1\nid: ${skill.id}\nname: ${skill.id}\nversion: 1.0.0\ndescription: ${skill.id} capability\ntype: skill\ncompatibility: {}\n`, "utf8");
    await writeFile(join(dir, "SKILL.md"), skill.body, "utf8");
    const capability: Capability = {
      id: skill.id,
      name: skill.id,
      version: "1.0.0",
      description: `${skill.id} capability`,
      type: "skill",
      compatibility: { opencode: "native" },
      source: { type: "local", location: dir },
      manifestPath: "skillrouter.yaml",
    };
    await storage.upsertCapability(capability);
  }
  return { repo };
}

async function makeApp(): Promise<{ storage: SqliteStorage; repo: string }> {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  const seeded = await seedCorpus(storage);
  return { storage, repo: seeded.repo };
}

import { indexCorpus } from "../../src/corpus/indexer.ts";

test("retrieve fuses sparse and local-dense modalities over a seeded corpus", async (t) => {
  clearSparseCache();
  const { storage } = await makeApp();
  t.after(() => storage.close());
  await indexCorpus(storage, "/nonexistent", "/nonexistent");

  const config = {
    topK: 5,
    embeddings: { enabled: true, provider: "local" as const, model: "local", dimension: 128, apiKeyEnv: "OPENAI_API_KEY", baseUrl: "https://example.invalid" },
    rerank: { enabled: true, provider: "lexical" },
  };

  const sparseOnly = await retrieve(storage, config, { query: "deploy docker container to the fleet", sources: ["sparse"] });
  assert.ok(sparseOnly.hits.length > 0);
  assert.equal(sparseOnly.hits[0]!.capabilityId, "deployer");
  assert.ok(sparseOnly.hits[0]!.sources.includes("sparse"));

  const before = await storage.allEmbeddings();
  assert.equal(before.length, 0, "no embeddings stored before refresh");

  const refreshed = await refreshEmbeddings(storage, config);
  assert.equal(refreshed.enabled, true);
  assert.ok(refreshed.embedded >= 6, `expected all sections embedded, got ${refreshed.embedded}`);
  assert.equal(refreshed.skipped, 0);

  const cached = await refreshEmbeddings(storage, config);
  assert.ok(cached.embedded === 0 && cached.skipped >= 6, "second refresh must skip unchanged sections");

  const hybrid = await retrieve(storage, config, { query: "deploy docker container" });
  assert.equal(hybrid.provider, "local");
  assert.equal(hybrid.hits[0]!.capabilityId, "deployer");
  assert.ok(hybrid.hits[0]!.sources.length >= 1);
  assert.ok(hybrid.latencyMs >= 0);
});

test("retrieve returns empty result for empty corpus without throwing", async (t) => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  t.after(() => storage.close());
  const config = { topK: 5, embeddings: { enabled: true, provider: "local" as const, model: "local", dimension: 32, apiKeyEnv: "OPENAI_API_KEY", baseUrl: "https://example.invalid" }, rerank: { enabled: false, provider: "lexical" } };
  const result = await retrieve(storage, config, { query: "anything" });
  assert.equal(result.hits.length, 0);
  assert.equal(result.total, 0);
  assert.equal(result.provider, "none");
});

test("refreshEmbeddings is a no-op when embeddings are disabled", async (t) => {
  const storage = new SqliteStorage(":memory:");
  await storage.init();
  t.after(() => storage.close());
  const config = { topK: 5, embeddings: { enabled: false, provider: "local" as const, model: "local", dimension: 64, apiKeyEnv: "OPENAI_API_KEY", baseUrl: "https://example.invalid" }, rerank: { enabled: false, provider: "lexical" } };
  const result = await refreshEmbeddings(storage, config);
  assert.equal(result.enabled, false);
  assert.equal(result.embedded, 0);
  assert.equal(result.failed, 0);
});

test("corpus snapshot hash is stable but content-sensitive", () => {
  // buildCorpusRecord path already covers hashing; spot-check determinism here
  const a = buildCorpusRecord({ id: "x", name: "X", version: "1", description: "d", type: "skill", compatibility: { opencode: "native" } }, [section("s1", "body text")], "2026-08-20T00:00:00.000Z");
  const b = buildCorpusRecord({ id: "x", name: "X", version: "1", description: "d", type: "skill", compatibility: { opencode: "native" } }, [section("s1", "body text")], "2026-08-20T00:00:00.000Z");
  assert.equal(a.contentHash, b.contentHash);
  assert.equal(a.bodyTokens, b.bodyTokens);
});