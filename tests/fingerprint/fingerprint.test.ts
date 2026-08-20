import { test } from "node:test";
import assert from "node:assert/strict";
import { shinglesOf, featureHashOf, fingerprintSimilarity, findDuplicates } from "../../src/fingerprint/shingle.ts";
import { buildCorpusRecord } from "../../src/corpus/record.ts";
import type { Capability } from "../../src/core/types.ts";
import type { CapabilityCorpusRecord } from "../../src/corpus/types.ts";
import type { CorpusSection } from "../../src/corpus/types.ts";

function section(id: string, body: string, kind: CorpusSection["kind"] = "docs"): CorpusSection {
  return { id, title: id, kind, source: `${id}.md`, level: 1, body, tokens: Math.ceil(body.length / 4) };
}

function cap(id: string, description: string, overrides: Partial<Capability> = {}): Capability {
  return {
    id,
    name: id,
    version: "1.0.0",
    description,
    type: "skill",
    compatibility: { opencode: "native" },
    ...overrides,
  };
}

function record(id: string, sections: CorpusSection[], overrides: Partial<CapabilityCorpusRecord> = {}): CapabilityCorpusRecord {
  return buildCorpusRecord(cap(id, id), sections, "2026-08-20T00:00:00.000Z");
}

/** Records that share metadata (realistically forked skills) but differ in body. */
function forkPair(): [CapabilityCorpusRecord, CapabilityCorpusRecord] {
  const mk = (id: string, body: string) =>
    buildCorpusRecord(
      cap(id, "Docker deployment skill", { name: "Docker Deployer", metadata: { tags: ["docker", "deploy"] }, triggers: { keywords: ["docker", "deploy"] } }),
      [section("s1", body)],
      "2026-08-20T00:00:00.000Z",
    );
  return [
    mk("cap:dup-a", "Deploy docker containers to the fleet with rolling updates and health checks, then verify the rollout finished cleanly."),
    mk("cap:dup-b", "Deploy docker containers to the fleet with rolling updates and health checks, then verify the rollout finished cleanly (fork)."),
  ];
}

test("shinglesOf is deterministic and includes unigrams plus trigrams", () => {
  const a = shinglesOf("deploy docker containers to the fleet");
  const b = shinglesOf("deploy docker containers to the fleet");
  assert.deepEqual(a, b);
  assert.ok(a.includes("1:deploy"));
  assert.ok(a.includes("3:deploy docker containers"));
  assert.ok(a.length >= 8);
});

test("featureHashOf is a stable 64-bit hex digest", () => {
  const r = record("cap:x", [section("s1", "Roll back deploys and clean up containers afterwards.")]);
  assert.equal(r.featureHash.length, 16);
  const again = record("cap:x", [section("s1", "Roll back deploys and clean up containers afterwards.")]);
  assert.equal(r.featureHash, again.featureHash, "feature hash must be deterministic");
});

test("fingerprintSimilarity distinguishes identical, similar and distinct texts", () => {
  const a = record("cap:a", [section("s1", "Deploy docker containers to the fleet with rolling updates and health checks, then verify the rollout.")]);
  const b = record("cap:b", [section("s1", "Deploy docker containers to the fleet with rolling updates and health checks, then verify the rollout. (fork)")]);
  const c = record("cap:c", [section("s1", "Process stripe refunds and chargebacks within the 30 day window.")]);

  assert.equal(fingerprintSimilarity(a.featureHash, a.featureHash), 1);
  const near = fingerprintSimilarity(a.featureHash, b.featureHash);
  assert.ok(near > 0.85, `near-identical bodies should be similar, got ${near}`);
  const far = fingerprintSimilarity(a.featureHash, c.featureHash);
  assert.ok(far < 0.7, `unrelated bodies should be dissimilar, got ${far}`);
  assert.ok(near > far);
});

test("findDuplicates clusters near-identical capabilities and reports pairs", () => {
  const [dupA, dupB] = forkPair();
  const other = record("cap:other", [section("s1", "Process stripe refunds and chargebacks within the 30 day window.")]);
  const dups = [dupA, dupB];

  const at85 = findDuplicates([...dups, other], 0.8);
  assert.equal(at85.pairs.length, 1);
  assert.deepEqual(at85.pairs[0]!.a, "cap:dup-a");
  assert.deepEqual(at85.pairs[0]!.b, "cap:dup-b");
  assert.equal(at85.clusters.length, 1);
  assert.deepEqual(at85.clusters[0]!.members, ["cap:dup-a", "cap:dup-b"]);

  const similarity = fingerprintSimilarity(dupA.featureHash, dupB.featureHash);
  const at99 = findDuplicates([...dups, other], Math.min(0.99, similarity + 0.05));
  assert.equal(at99.pairs.length, 0, "threshold above the observed similarity must not report the fork pair");

  const triCluster = findDuplicates(
    [
      record("cap:t1", [section("s", "Generate release notes from git log since the last tag, grouped by semantic type.")]),
      record("cap:t2", [section("s", "Generate release notes from git log since the last tag, grouped by semantic type (v2).")]),
      record("cap:t3", [section("s", "Generate release notes from git log since the last tag, grouped by semantic type (v3 fork).")]),
    ],
    0.8,
  );
  assert.equal(triCluster.clusters.length, 1);
  assert.equal(triCluster.clusters[0]!.members.length, 3);
});

test("buildCorpusRecord exposes all three fingerprints together", () => {
  const r = record("cap:all", [section("s1", "A single deterministic body for fingerprinting.")]);
  assert.equal(r.contentHash.length, 64);
  assert.equal(r.metadataHash.length, 64);
  assert.equal(r.featureHash.length, 16);
});