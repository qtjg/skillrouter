# Router Architecture

The router (`src/router/index.ts`) is the deterministic decision engine. Its documented pipeline:

```
Task Input → Task Analyzer → Project Analyzer → Environment Detector →
Capability Discovery → Compatibility Filter → Security Filter →
Dependency Resolver → Relevance Ranking → Conflict Resolver →
Activation Planner → (User Consent) → (Adapter Execution)
```

The router itself performs no I/O: it consumes a `RouteContext` (task, project, git, capabilities, installed rows, agents, config) and returns a `RouterDecision`. Execution is the runtime's job.

## Task analyzer — `src/router/analyzer.ts`

`analyzeTask(task)` tokenizes and normalizes the task text (`normalizePhrases`, `tokenize`, `expandAliases`) and produces a `TaskAnalysis`:

- **domains** — matched against a static `DOMAIN_TABLE` (web-development, authentication, payments, database, devops, security, testing, frontend, backend, documentation, data, ai); technology hits also imply domains (e.g. nextjs → web-development, stripe → payments).
- **operations** — from `OPERATION_TABLE` (implementation, configuration, testing, debugging, refactoring, security-review, deployment, design, documentation, review, migration); defaults to `implementation` when nothing matches.
- **technologies** — canonicalized via `TECHNOLOGY_ALIASES` (e.g. "next" → "nextjs", "k8s" → "kubernetes").
- **riskEstimate** — `low`, raised to `medium` on risk terms (security/auth/credential/deploy/billing…), to `high` for security-review operations or payment/production terms.

## Factor scoring — `src/router/factors.ts`

Each capability is scored independently by `scoreSingleCapability`. The weighted factors (Level 1) are: keyword, technology, intent, name/id, description, project context (language/framework/dependency), git patterns, file patterns, compatibility, trust, quality, historical success, minus penalties for context cost, permission cost, and (via conflict resolution) conflicts. Every factor appends a human-readable `Signal` so the decision stays explainable.

- Weights and the formula: [routing/scoring.md](../routing/scoring.md).
- Preparations are cached per `Capability` object (a `WeakMap` in `src/router/index.ts`).
- Blocked capabilities (trust breakdown `<= -100`) are dropped before ranking.

## Semantic and LLM levels — `src/router/semantic.ts`

- **Level 2 (semantic):** `LexicalSemanticMatcher` — deterministic token overlap weighted by term specificity, scaled by domain/technology breadth; active only when `router.semantic: true`. A match adds up to a 25% score bonus (`score + result.score * 0.25`).
- **Level 3 (LLM rerank):** `ConfiguredLlmReranker` — configured when `router.model` is set, sends metadata only (never file contents or secrets). **Honest status: the HTTP transport is not wired in v0.1 — `rerank()` returns `null`, and the deterministic ranking stands.** No silent degradation: it never returns a partial rerank.

## Conflict resolution — `src/router/conflicts.ts`

`resolveConflicts` processes declared `conflicts` between ranked capabilities (sorted by score, then id):

- The higher-scoring capability wins; the loser is excluded and its `conflictWith` records the winner.
- Ties keep the capability with the lower risk level (`score.riskLevel` comparison).

## Dependency resolution — `src/router/dependency-resolver.ts`

Pure functions over capability metadata:

- `requiredDependencies` / `optionalDependencies` split declared deps on `optional`.
- `expandDependencies(ids, universe)` — transitive closure of required dependencies, reporting `missing` (required deps absent from the universe, with `requiredBy`), `optionalMiss` (tolerated), and a deterministic `ordered` activation order.
- `sortByDependencies` — Kahn topological sort, deps first, ties ordered by id; dependency **cycles are extracted, not fatal** (members emitted in id order).

`route` output renders this as the `dependencies` block (activationOrder/missing/optionalMiss/cycles).

## Planning — `src/router/planner.ts`

`buildPlan` turns ranked, conflict-resolved scores into `PlanAction`s:

- **Selection:** drop `never` ids; drop scores below `threshold` unless the id is in `always`; always-included ids are forced back in; then take the top `maxActivations` (default 5).
- **Ordering:** `prefer` ids sort first among the activated; final action order is `activate → keep → deactivate → suspend → keep-inactive`, then score.
- **Per capability** (over the full ranked list, not only selected), the plan emits one of:
  - `activate` — recommended, score ≥ threshold (or forced); state marked from current (`INSTALLED`…`DISCOVERED`).
  - `keep` — already ACTIVE/CANDIDATE and still selected.
  - `deactivate` — currently active but no longer relevant (below threshold).
  - `keep-inactive` — not selected; "explicitly avoided by configuration" if id is in `avoid`.
- Each action carries `confidence` (score ≥ 70 high, ≥ 50 medium, else low), reasons (signals), and a human-readable permission requirement list.
- `createDecision` also computes `contextEstimate` (sum of `estimatedTokens` of activated/kept capabilities) against the 12000-token `contextBudget` default.
- Each selected capability carries its declared `fallbacks` chain (only members that are routing candidates) in `decision.fallbacks`; the runtime can pick the next member when the capability fails — see `src/router/fallback.ts` (chain walk with `attempted`-set loop prevention and a step cap) and `skillrouter learn --failure`, which records the outcome and suggests the next fallback.

Modes (`router.mode`): `manual` forces a dry run at the CLI level; `automatic`/`autonomous` apply without the confirmation prompt; `assisted` (default) asks. Consent is separate from mode — the runtime never auto-approves what policy says to ask.

## Explainability — `src/router/explainer.ts`

`explainDecision(decision)` renders the `Why this decision` view: analysis summary (domains/technologies/operations/risk), activations with signals (top 7), permissions, risk badge, and conflict notes, deactivations with top-4 signals, kept ids, context estimate vs. budget, mode, and whether semantic/LLM layers were used (`semanticUsed`/`llmUsed`). It feeds both `skillrouter explain` and the `--json` output of `route`.