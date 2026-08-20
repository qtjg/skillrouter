# Implementation Status — PRD v2.0 (Project Intelligence Plane)

Status legend:
- **IMPLEMENTED** — built, tested and verified in this repo (tests + smoke).
- **PARTIAL** — core exists but the PRD contract is not fully covered.
- **EXISTS** — the mechanism is present, but the PRD-specific contract does not exist yet.
- **MISSING** — nothing in the repo satisfies this requirement.

Updated: 2026-08-20

## Phase D1 — Capability Corpus Foundation

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| Canonical capability record (§7.2): full body, not manifest summary | IMPLEMENTED | `src/corpus/types.ts` `CapabilityCorpusRecord` | — |
| Extract full body: SKILL.md, README, instructions/, docs/, examples/, manifest prose | IMPLEMENTED | `src/corpus/extract.ts` (`extractSections`) | — |
| Section-level granularity (headings, kind, source path) | IMPLEMENTED | `CorpusSection`; heading split in `splitMarkdown` | — |
| Normalization + secret redaction before persist/fingerprint | IMPLEMENTED | `src/corpus/normalize.ts` (`prepareText`, `redactSecrets`) | — |
| Content + metadata fingerprints | IMPLEMENTED | `src/corpus/fingerprint.ts`, `buildCorpusRecord` (`contentHash`, `metadataHash`) | — |
| Corpus persistence (SQLite) | IMPLEMENTED | migration 4 `corpus_records`; Storage corpus API | — |
| Incremental indexing (skip unchanged) + stale-row pruning | IMPLEMENTED | `src/corpus/indexer.ts` (`indexCorpus`, `changedOnly`) | — |
| CLI surface: `skillrouter index [--changed] [--capability] [--json]` | IMPLEMENTED | `src/cli/commands/corpus.ts` | — |
| Deterministic router unchanged while corpus is built | IMPLEMENTED | corpus layer is additive; router untouched | — |
| Token estimation per section / body | IMPLEMENTED | `estimateTokens` (chars/4) | refine in D8 |
| Capability content-root resolution (install/manifest/source/catalog/project) | IMPLEMENTED | `resolveBodyDir` | — |

Tests: `tests/corpus/corpus.test.ts` (12). Events: `corpus.indexed`.

## Phase D2 — Hybrid Retrieval

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| Sparse retrieval (BM25-style) over full corpus bodies/sections | MISSING | keyword scoring in `src/router/` operates on manifest fields only | new `src/retrieval/` BM25 index over corpus sections |
| `EmbeddingProvider` contract + pluggable providers | MISSING | — | `EmbeddingProvider` interface; local (hashing) + remote adapters |
| Dense retrieval + vector store | MISSING | — | `embeddings` table (migration 5); cosine/similarity search |
| Fusion (e.g. RRF) of sparse + dense results | MISSING | — | `fusion.ts`, `RetrievalRequest/Result` contract |
| `skillrouter retrieve <query>` CLI / library call | MISSING | `search` command | new command + doc |

## Phase D2 — Hybrid Retrieval

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| Sparse retrieval (BM25-style) over full corpus bodies/sections | IMPLEMENTED | `src/retrieval/sparse.ts` `Bm25Index` (k1=1.2, b=0.75, deterministic) over corpus sections | — |
| `EmbeddingProvider` contract + pluggable providers | IMPLEMENTED | `EmbeddingProvider` in `src/retrieval/types.ts`; `LocalEmbeddingProvider` (feature hashing, offline) + `OpenAiEmbeddingProvider` (OpenAI-compatible `/embeddings`) with automatic local fallback | — |
| Dense retrieval + vector store | IMPLEMENTED | migration 5 `embeddings` table; `src/retrieval/dense.ts` cosine search, per-capability aggregation | — |
| Fusion (RRF) of sparse + dense results | IMPLEMENTED | `src/retrieval/fusion.ts` (`rrfFuse`, k=60, deterministic tie-breaks) | — |
| `RetrievalRequest/Result` contracts | IMPLEMENTED | `src/retrieval/types.ts` | — |
| `skillrouter retrieve <query>` CLI / library call | IMPLEMENTED | `src/cli/commands/retrieve.ts` (`--top-k`, `--json`); embeddings refresh wired into `skillrouter index` | — |
| Config surface | IMPLEMENTED | `retrieval.{topK,embeddings.{enabled,provider,model,dimension,apiKeyEnv,baseUrl}}` + validation | — |

Tests: `tests/retrieval/retrieval.test.ts` (9). Events: `retrieval.queried`.

## Phase D3 — Reranking

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| `RerankerProvider` contract + pluggable rerankers | MISSING | — | `src/rerank/` interface + default lexical/simple reranker |
| W-score integration with retrieval results | PARTIAL | `src/router/factors.ts` W scores use manifest fields + outcomes | feed corpus + retrieval signals |

## Phase D3 — Reranking

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| `RerankerProvider` contract + pluggable rerankers | IMPLEMENTED | `src/rerank/types.ts` + `createRerankerProvider` registry | — |
| Default deterministic lexical reranker (corpus-informed) | IMPLEMENTED | `src/rerank/lexical.ts` `LexicalReranker`: full-body term coverage, section-kind weighting, keyword bonus, reliability nudge (Phase G), no LLM | — |
| Perspective-aware reordering without reciprocal link preload | PARTIAL | `src/rerank/index.ts` `applyRerank` reorders fused hits deterministically | add cross-agent ranking in Phase F |
| Config surface + CLI | IMPLEMENTED | `retrieval.rerank.{enabled,provider}`; `retrieve --no-rerank`; per-hit `rerankScore`/`rerankReason` outputs | — |

Tests: `tests/rerank/rerank.test.ts` (4).

## Phase D4 — Content Fingerprinting & Deduplication

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| `CapabilityFingerprint` (semantic + content hashes) | PARTIAL | `contentHash`/`metadataHash` in corpus record | full `CapabilityFingerprint` with feature vectors |
| Near-duplicate detection across capabilities | MISSING | `src/router/graph.ts` `replaces/conflicts` only | similarity/dedup pass + `skillrouter duplicates` |
| Duplicate reporting CLI | MISSING | — | TBD |

## Phase D4 — Content Fingerprinting & Deduplication

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| `CapabilityFingerprint` (semantic + content hashes) | IMPLEMENTED | `CapabilityCorpusRecord` carries `contentHash`, `metadataHash` and 64-bit SimHash `featureHash` (`src/fingerprint/shingle.ts`) | — |
| Near-duplicate detection | IMPLEMENTED | shingle-set (unigram+trigram) Dice similarity per capability; `findDuplicates` pair + cluster reports, deterministic ordering | — |
| Duplicate reporting CLI | IMPLEMENTED | `skillrouter duplicates [--threshold 0..1] [--capability] [--json]` (default 0.85) | — |

Tests: `tests/fingerprint/fingerprint.test.ts` (5).

## Phase D5 — Capability Composition / DAG

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| `PlanNode` / plan DAG representation | IMPLEMENTED | explicit `PlanNode` DAG (`src/plan/types.ts`) with root/capability nodes, depth/order/status | — |
| Cross-capability composition from `capabilities[]` | IMPLEMENTED | `buildPlanDag` expands `capabilities[]` transitively (single node per shared dep), `enhances`/`conflicts`/`fallbacks` as typed links | — |
| Validation of composition | IMPLEMENTED | cycle detection (DFS), unresolvable requires (`missing`), declared conflicts, unresolved-relation warnings; `classifyStatuses` marks nodes; `linearize` dependency-first order | — |
| Plan CLI | IMPLEMENTED | `skillrouter plan [<capability-id> ...] [--json]` renders tree, execution order, validity report (exit 2 on invalid) | — |

Tests: `tests/plan/plan.test.ts` (10).

## Phase D6 — Gap Analysis & Acquisition

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| Detect capability gaps in retrieval/planning | PARTIAL | `docs/architecture/gap-analysis.md`, gap notes in planner | programmatic `CapabilityGap` analysis over corpus terms |
| Acquisition suggestions (source search) | PARTIAL | `search` + sources | gap-driven acquisition command `skillrouter gaps` |

## Phase D7 — Preflight Execution Validation

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| Pre-activation checks (permissions, resources, inputs) | PARTIAL | permission checks during install/route | `PreflightResult` + `--preflight` on route/install |
| Dry-run / validation report | MISSING | — | TBD |

## Phase D8 — Context Optimization

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| Context budget handling / section selection | PARTIAL | `src/context/` providers + `context.estimatedTokens` | corpus-aware section budget assembly |
| Context usage accounting in decisions | PARTIAL | route JSON `contextUsage` | per-section budget attribution |

## Phase D9 — Benchmark & Simulation

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| Deterministic-simulated routing (`simulate`/`benchmark`) | PARTIAL | `route --dry-run`-style paths, router deterministic fallback | `skillrouter benchmark` + `simulate` harness over corpora |
| Quality metrics (precision/recall of ranking) | PARTIAL | selection history, audits | ranking quality scoring |

## Phase D10 — Adaptive Intelligence & Counterfactuals

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| Adaptive weighting from outcomes | EXISTS | Phase G `reputation`/`learn` adaptive factors | integrate retrieval signal quality |
| Counterfactual analysis ("what if another capability won") | PARTIAL | routing history + audit trail | counterfactual evaluation module |
| Self-improvement loop | PARTIAL | Phase G feedback loop | corpus-level feedback (index → retrieve → learn) |

## Phase E — Registry Federation

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| `RegistryProvider` contract | MISSING | `sources` (git/catalog) fetching | provider interface + registry protocol |
| Registry sync / provenance | PARTIAL | fetched sources with commit pinning, hash | federation sync |

## Phase F — Universal Capability Routing

| Requirement (PRD v2.0) | Status | Existing | Planned change |
| --- | --- | --- | --- |
| Routing across all capability types & agents | PARTIAL | multi-agent compatibility, type-aware ranking | corpus-informed universal ranking |
| Deterministic fallback when LLM/observability unavailable | IMPLEMENTED | deterministic router default | — |
| Full-body-aware ranking | PARTIAL | corpus now indexes full bodies | wire retrieval into ranking (D2–D3) |

## Commits

- `529945e` Phase D4 content fingerprinting & deduplication
- `4ad80e9` Phase D3 corpus-informed reranking
- `ef7bdba` Phase D1 capability corpus foundation
- `4be631d` Phase D2 hybrid retrieval
- `8b62290` docs: add master product requirements (repo baseline for PRD v2.0)