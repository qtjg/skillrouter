import { test } from "node:test";
import assert from "node:assert/strict";
import { LexicalReranker } from "../../src/rerank/lexical.ts";
import { applyRerank } from "../../src/rerank/index.ts";
import type { CorpusSection, CapabilityCorpusRecord } from "../../src/corpus/types.ts";
import type { RetrievalHit } from "../../src/retrieval/types.ts";
import type { OutcomeSummary } from "../../src/learning/outcomes.ts";

function section(id: string, body: string, kind: CorpusSection["kind"] = "docs"): CorpusSection {
  return { id, title: id, kind, source: `${id}.md`, level: 1, body, tokens: Math.ceil(body.length / 4) };
}

function corpusRecord(capabilityId: string, sections: CorpusSection[], keywords: string[] = []): CapabilityCorpusRecord {
  const body = sections.map((s) => s.body).join("\n\n");
  return {
    capabilityId,
    name: capabilityId,
    version: "1.0.0",
    type: "skill",
    summary: capabilityId,
    description: capabilityId,
    tags: [],
    keywords,
    context: {},
    source: { type: "local", location: "/tmp" },
    sections,
    body,
    bodyTokens: Math.ceil(body.length / 4),
    contentHash: `hash-${capabilityId}`,
    metadataHash: `meta-${capabilityId}`,
    indexedAt: "2026-08-20T00:00:00.000Z",
  };
}

function hit(capabilityId: string, rank: number, sources: ["sparse"] | ["dense"] | ["sparse", "dense"], matchedSections: RetrievalHit["matchedSections"]): RetrievalHit {
  return {
    capabilityId,
    sectionId: matchedSections[0]?.id ?? null,
    sectionKind: "docs",
    matchedSections,
    score: 1 / (rank + 1),
    rank,
    sources,
  };
}

const DEPLOY_RECORD = corpusRecord(
  "cap:deployer",
  [
    section("deployer::SKILL.md::top::1", "Deploy docker containers to the fleet with rolling updates and health checks.", "overview"),
    section("deployer::SKILL.md::usage::1", "Run deploy for staging uploads.", "instructions"),
  ],
  ["deploy", "docker"],
);
const REFUND_RECORD = corpusRecord("cap:refunder", [section("refunder::SKILL.md::top::1", "Process stripe refunds and chargebacks within the 30 day window.")], ["stripe", "refund"]);

test("LexicalReranker promotes full-coverage instruction matches and annotates reasons", async () => {
  const deployer = hit("cap:deployer", 1, ["dense"], [{ id: "deployer::SKILL.md::usage::1", title: "usage", score: 0.01 }]);
  deployer.sectionKind = "instructions";
  const refunder = hit("cap:refunder", 0, ["sparse", "dense"], [{ id: "refunder::SKILL.md::top::1", title: "top", score: 0.05 }]);

  const rerank = new LexicalReranker();
  const out = await rerank.rerank({
    query: "deploy docker containers fleet",
    hits: [refunder, deployer],
    context: [
      { hit: refunder, ctx: { corpusRecord: REFUND_RECORD, reliability: null } },
      { hit: deployer, ctx: { corpusRecord: DEPLOY_RECORD, reliability: null } },
    ],
  });

  assert.equal(out[0]!.hit.capabilityId, "cap:deployer", "full-coverage hit must win even when it was ranked second by fusion");
  assert.equal(out[0]!.hit.rank, 0);
  assert.ok(out[0]!.reason.length > 0);
  assert.ok(out[0]!.score >= 0 && out[0]!.score <= 1);
  assert.equal(out[1]!.hit.capabilityId, "cap:refunder");
});

test("LexicalReranker is deterministic and tolerates empty queries", async () => {
  const rerank = new LexicalReranker();
  const a = hit("cap:a", 0, ["sparse"], []);
  const b = hit("cap:b", 0, ["sparse"], []);
  const input = { query: "docker", hits: [a, b], context: [] };
  const first = await rerank.rerank(input);
  const second = await rerank.rerank(input);
  assert.deepEqual(first.map((r) => r.hit.capabilityId), second.map((r) => r.hit.capabilityId));

  const empty = await rerank.rerank({ query: "   ", hits: [a], context: [] });
  assert.equal(empty.length, 1);
  assert.ok(empty[0]!.score > 0);
});

test("reliability nudge reorders equally-matched capabilities", async () => {
  const rerank = new LexicalReranker();
  const reliable = hit("cap:good", 0, ["sparse"], [{ id: "good::s::1", title: "s", score: 1 }]);
  const flaky = hit("cap:bad", 1, ["sparse"], [{ id: "bad::s::1", title: "s", score: 1 }]);
  const out = await rerank.rerank({
    query: "deploy",
    hits: [flaky, reliable],
    context: [
      { hit: flaky, ctx: { corpusRecord: corpusRecord("cap:bad", [section("bad::s::1", "deploy containers", "overview")]), reliability: { successRate: 0.2 } as OutcomeSummary } },
      { hit: reliable, ctx: { corpusRecord: corpusRecord("cap:good", [section("good::s::1", "deploy containers", "overview")]), reliability: { successRate: 0.95 } as OutcomeSummary } },
    ],
  });
  assert.equal(out[0]!.hit.capabilityId, "cap:good");
  assert.ok(out[0]!.reason.includes("reliability"));
});

test("applyRerank integrates records and summaries into annotated hits", async () => {
  const deployer = hit("cap:deployer", 1, ["dense"], [{ id: "deployer::SKILL.md::usage::1", title: "usage", score: 0.01 }]);
  deployer.sectionKind = "overview";
  const refunder = hit("cap:refunder", 0, ["sparse"], [{ id: "refunder::SKILL.md::top::1", title: "top", score: 0.05 }]);
  const summaries = new Map<string, OutcomeSummary>([["cap:deployer", { capabilityId: "cap:deployer", usage: 7, successRate: 1, avgLatencyMs: 100, p95LatencyMs: 150, verificationRate: 1, avgRating: 1, lastSeen: "2026-08-20T00:00:00.000Z" }]]);

  const hits = await applyRerank("lexical", {
    query: "deploy docker containers fleet",
    hits: [refunder, deployer],
    records: [DEPLOY_RECORD, REFUND_RECORD],
    summaries,
  });

  assert.equal(hits[0]!.capabilityId, "cap:deployer");
  assert.equal(hits[0]!.rerankReason, "full query coverage; overview match; keyword match; high reliability");
  assert.ok(typeof hits[0]!.rerankScore === "number");
});