import { test } from "node:test";
import assert from "node:assert/strict";
import type { CapabilityCorpusRecord, CorpusSection } from "../../src/corpus/types.ts";
import type { Capability } from "../../src/core/types.ts";
import { buildCorpusRecord } from "../../src/corpus/record.ts";
import { analyzeGaps } from "../../src/gaps/analyze.ts";
import { isGapCandidate } from "../../src/gaps/index.ts";

function section(id: string, body: string): CorpusSection {
  return { id, title: id, kind: "docs", source: `${id}.md`, level: 1, body, tokens: Math.ceil(body.length / 4) };
}

function cap(id: string, description: string): Capability {
  return { id, name: id, version: "1.0.0", description, type: "skill", compatibility: { opencode: "native" } };
}

function record(id: string, sections: CorpusSection[]): CapabilityCorpusRecord {
  return buildCorpusRecord(cap(id, id), sections, "2026-08-20T00:00:00.000Z");
}

test("analyzeGaps ranks frequent query terms with low coverage highest", () => {
  const queries = [
    "deploy kubernetes clusters across regions",
    "rollback a kubernetes release",
    "monitor kubernetes pods",
  ];
  const corpus = [record("cap:a", [section("s1", "process stripe refunds and chargebacks")])];

  const analysis = analyzeGaps({ queries, corpus, minFrequency: 1 });
  assert.equal(analysis.totalQueries, 3);
  const kube = analysis.gaps.find((g) => g.term === "kubernetes");
  assert.ok(kube, "kubernetes must appear in gap ranking");
  assert.equal(kube!.frequency, 3);
  assert.equal(kube!.coverage, 0);
  assert.equal(kube!.score, 3);

  const gap = analysis.gaps[0]!;
  assert.equal(gap.term, "kubernetes", "highest-frequency zero-coverage term ranks first");
  assert.ok(analysis.gaps.every((g) => g.score <= gap.score), "deterministic sorted order");
});

test("terms covered by the corpus rank lower", () => {
  const queries = ["refund stripe transactions", "monitor stripe balance"];
  const corpus = [record("cap:s", [section("s1", "stripe refunds and chargebacks processing")])];

  const analysis = analyzeGaps({ queries, corpus, minFrequency: 1 });
  const stripe = analysis.gaps.find((g) => g.term === "stripe");
  assert.ok(stripe, "stripe still appears (it is in queries)");
  assert.equal(stripe!.coverage, 1, "stripe is covered by corpus");
  const refund = analysis.gaps.find((g) => g.term === "refund");
  assert.equal(refund!.coverage, 0, "tokenizer is non-stemming: refund != refunds, so corpus coverage is 0");
  const monitor = analysis.gaps.find((g) => g.term === "monitor");
  assert.equal(monitor!.coverage, 0);
  assert.ok(monitor!.score >= stripe!.score, "uncovered term scores at least as high as covered term");
});

test("minFrequency filters sparse terms; suggestedQuery is composed from top gaps", () => {
  const queries = ["ship release notes", "ship changelog entries", "audit dependencies", "audit lockfile drift"];
  const corpus: CapabilityCorpusRecord[] = [];
  const loose = analyzeGaps({ queries, corpus, minFrequency: 1 });
  assert.equal(loose.gaps.find((g) => g.term === "ship")?.frequency, 2);
  assert.equal(loose.gaps.find((g) => g.term === "changelog")?.frequency, 1);
  assert.equal(loose.suggestedQuery, "audit ship changelog");

  const tight = analyzeGaps({ queries, corpus, minFrequency: 2 });
  assert.ok(!tight.gaps.some((g) => g.term === "changelog"), "single-query terms filtered by minFrequency");
  assert.deepEqual(
    tight.gaps.map((g) => g.term),
    ["audit", "ship"],
  );
  assert.equal(tight.suggestedQuery, "audit ship");
  const sliced = analyzeGaps({ queries, corpus, minFrequency: 1, maxGaps: 2 });
  assert.ok(sliced.gaps.length <= 2);
});

test("stop words and duplicate terms within a query are ignored", () => {
  const queries = ["how can you deploy docker deploy", "deploy docker images"];
  const analysis = analyzeGaps({ queries, corpus: [], minFrequency: 1 });
  assert.equal(analysis.gaps.find((g) => g.term === "deploy")?.frequency, 2, "duplicate within one query counts once");
  assert.ok(!analysis.gaps.some((g) => ["how", "can", "you"].includes(g.term)), "stop words excluded");
});

test("isGapCandidate flags empty selected/activations only", () => {
  assert.equal(isGapCandidate("", ""), true);
  assert.equal(isGapCandidate("docker-deploy", ""), false);
  assert.equal(isGapCandidate("", "docker-deploy"), false);
});