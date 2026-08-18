# Current Architecture — State as of this milestone

An honest audit of the SkillRouter codebase before the next engineering phase.
Unfinished features are marked as such; nothing here overstates what exists.

## 1. What exists and works

### Layering (src/ domain division)

- `core/` — canonical `Capability` model, ids, lifecycle transitions,
  typed events. The capability model is provider-agnostic.
- `manifest/` — YAML parsing, `skillrouter/v1` validation, normalization
  into the canonical `Capability` model, schema file under `schemas/`.
- `registry/` — discovery (local + git), indexing into storage, search
  scoring (`rankCapabilities`), fuzzy id matching.
- `router/` — task analyzer, scoring factors, conflict resolution,
  activation planner, explainer, dependency resolver, optional semantic
  and LLM scoring interfaces (deterministic lexical fallback).
- `security/` — risk model, policy resolver (allow/ask/deny rule sets),
  permission declarations, secret scanning, trust levels, audit log,
  key pairs + manifest signing/verification (ECDSA, WebCrypto).
- `storage/` — `Storage` interface + SQLite implementation (`node:sqlite`).
- `adapters/` — opencode, claude, gemini, generic, mcp, env detection.
- `installer/` — atomic install (prepare → validate → backup → install →
  verify → commit/rollback), update, remove.
- `git/` — repo/branch/status context, change-signal inference.
- `project/` — project type detection (package.json, etc.).
- `config/` — global + per-project YAML config with validation.
- `cli/` — command framework, registry of ~35 commands, output helpers.
- `logging/`, `lockfile/`, `runtime/`, `export/`, `verify/`, `utils/`.

### Verified behavior (tests green: 117 tests, tsc clean, Node 22.14)

- Routing: task analysis → scoring → planning → activation order,
  explainable decisions, dry-run and JSON output, missing-dependency
  reporting, cycle detection in dependency resolution.
- Security: secret scanning (incl. multi-line PEM keys), policy
  resolution for filesystem/network/shell/processes/credentials,
  signature chains, risk + trust.
- Storage: SQLite CRUD for capabilities, installed rows, history,
  preferences, trust, audit, cache; snake_case → camelCase mapping fixed.
- Git: repo detection, branch, changed/staged files, signals.
- CLI end-to-end: version/help/errors/route --json (transform-types suite).

### Key invariants

- Zero runtime dependencies beyond `yaml` (Node built-ins everywhere else).
- Routing never requires an LLM (deterministic default; pluggable levels).
- Provider logic lives in adapters; no `if provider === "opencode"` in core.

## 2. What is incomplete

- **Capability graph** — only a flat registry exists. Dependencies and
  conflicts are declared per-capability but there is no graph abstraction
  (traversal, clustering, prerequisite resolution, replacement discovery,
  validation). This is the first gap this milestone closes.
- **Context engine** — context is assembled ad hoc per command
  (`route.ts` gathers task/cwd/project/git/storage pieces inline). There
  is no normalized `ContextSnapshot`, no modular collectors, no shared
  pipeline for future routing decisions.
- **Intent model** — `analyzeTask` produces scoring signals, but there is
  no structured intent (domain/operation/risk/urgency/likely capabilities).
- **Feedback/learning** — history rows are recorded; nothing consumes
  them to adjust rankings (success/override rates absent).
- **Lifecycle manager** — state constants + transition table exist, but no
  dedicated lifecycle service or `lifecycle <capability>` command.
- **Sessions** — none.
- **Routing modes** — config has a `mode` field (manual/assisted/autonomous)
  but no fast/balanced/deep/secure presets.
- **Capability quality score** — ad hoc factors + trust/risk only; no
  single explainable `CapabilityScore`.
- **Registry abstraction** — hardcoded discovery paths, no provider
  interface for remote registries.
- **Lockfile** — exists as `src/lockfile/`, but no integrity-hash or
  permissions snapshot (reproducibility incomplete).
- **Observability** — structured logging exists; typed domain events
  (`router.started`, `capability.selected`, …) do not.
- **Offline mode** — no global `--offline` flag semantics.
- **MCP server mode, programmatic router API, benchmark dataset,
  graph command, auto command** — not implemented.
- **Adapt a `skillrouter init`** — exists as a command; detection depth is
  basic (agents + project type).

## 3. What is poorly abstracted / duplicated / fragile

- **Context assembly** is duplicated across `cli/commands/route.ts` and
  `git/context.ts` consumers; a shared collector pipeline removes it.
- **Snake_case→camelCase row mapping** (storage) was recently fixed but
  lives as ad hoc helpers; keep them local to storage.
- **Search vs router scoring** duplicate normalization logic (both
  `prepareCapability`-style term preparation).
- **`runtime/` and `cli/commands/state.ts`** both manipulate active state;
  boundaries could be cleaner once lifecycle becomes a service.
- **Signal inference** is now centralized (`git/signals.ts`) — good;
  still only used by the git context path.
- **Planner** has grown several option paths (always/never/avoid,
  dry-run, mode); watch for option-drift as modes are added.

## 4. Missing for production use

1. Capability graph with validation (deps/conflicts/clusters).
2. Normalized context snapshot feeding routing.
3. Structured intent (deterministic).
4. Explainable quality scoring per capability.
5. Feedback statistics (success/override rates) consumed by ranking.
6. Realistic benchmark dataset (50 tasks) with top-1/top-3 metrics.
7. Full JSON surface for every major command (many have it; some don't).
8. CI workflow running typecheck + tests on Node 22.
9. MCP server mode and programmatic API for agent consumption.
10. Route modes (fast/balanced/deep/secure) with locked behavior.

## 5. Roadmap (milestones — deliberate order)

- **M1 (this milestone):** Capability graph + context engine (+ manifest
  relation fields: enhances/replaces/compatibleWith). Audit doc.
- **M2:** Structured intent engine; wire context+graph into the router
  pipeline; routing modes presets.
- **M3:** Quality scoring (`CapabilityScore`), feedback statistics,
  consumption of history in ranking.
- **M4:** Lifecycle service + `lifecycle` command; task sessions.
- **M5:** Adapter SDK surface; adapter health checks in `doctor`.
- **M6:** Registry provider interface.
- **M7:** Feedback API + `--json` everywhere; observability events.
- **M8:** MCP server mode; programmatic `SkillRouter` API.
- **M9:** CLI upgrade (graph/auto/history/adapters/registry commands),
  offline flag semantics.
- **M10:** Benchmark suite (50 tasks) + `skillrouter benchmark`.
- **M11:** Performance measurement + caching.
- **M12:** Documentation completion per doc-tree layout.

Nothing in this document assumes work that does not exist yet.