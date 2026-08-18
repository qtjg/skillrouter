# PRD Gap Analysis (v2.0 · 2026-08-19)

Mapping of the current codebase against `docs/../prd.md` (Master PRD v2.0).
This is the working reference for the phased implementation plan; it is updated
as phases land.

Legend: `[x]` implemented + tested · `[~]` partial · `[ ]` missing

## Already implemented (verified, tests green)

- [x] §9 Capability model (id/name/version/type/compatibility/deps/conflicts/
  enhances/replaces/compatibleWith/permissions/risk/context/trust/metadata)
- [x] §11 Capability registry (discovery, indexer, search, git/catalog/directory sources)
- [x] §10 Taxonomy (categories, triggers: keywords/intents/technologies/file patterns)
- [x] §8 Task analyzer (domains, operations, technologies, risk estimate) — deterministic, rule-based
- [x] §18 Project context (languages, frameworks, databases, package manager, testing frameworks, cloud, dependencies)
- [x] §19 Git intelligence (changed/staged files, signals, branch)
- [x] §20 Change-aware routing (git/file pattern matching in scoring)
- [x] §13/§48 Routing core (modular factors, thresholds, semantic-matcher interface, LLM re-ranker interface)
- [x] §14 Explainable routing (evidence signals per score, `explain` command)
- [x] §16 Dependency resolution (transitive expansion, ordered activation, cycle detection)
- [x] §17 Conflict resolution (pair resolution, conflict-with-dependency detection)
- [x] §12 Skill lifecycle (full state machine, idempotent transitions)
- [x] §37–39 Security (risk model, permissions, secret redaction incl. multi-line keys, audit log, trust levels, signatures)
- [x] §44 SQLite persistence (migrations, capabilities/installed/routing_history/audit/preferences/trust/router_cache)
- [x] §29–31 Adapters (opencode, claude, gemini, generic, mcp env detection; provider logic outside core)
- [x] §30 Generic export (portable manifest)
- [x] §54 Event system (typed bus, router.decided, capability.* events)
- [x] §33 CLI (30 commands: init/doctor/status/config/search/find/info/install/uninstall/
  update/source/enable/disable/force-*/activate/deactivate/active/route/explain/audit/
  permissions/trust/keys/sign/signatures/logs/verify/export/scan)

## Gaps, by priority

### High

| PRD | Gap | Status |
|-----|-----|--------|
| §22–23 | Reliability metrics: no `skill_metrics` table; `historical` score factor reads only static declared `metadata.successRate`; no bounded updates | `[x]` Phase A |
| §21 | Failure recovery: no fallback chains (per-capability ordered fallbacks, loop prevention, fallback events) | `[x]` Phase B |
| §13/§50 | Routing strategies (balanced/quality/speed/cheap/minimal/safe); `cost`/`latency` metadata absent from model | `[ ]` Phase C |
| §7 | CapabilityGraph + ContextEngine exist but are not wired into the router pipeline | `[ ]` Phase D |
| §61 | `trace` command (observability of a routing decision) | `[ ]` Phase F |
| §34 | Interactive CLI | `[ ]` Phase F |

### Medium

- §28/§40 Plugin commands (`plugin install/remove`) with pre-install validation
- §33 `stats`/`learn`/`graph`/`plan` command surface (route has `--dry-run`; plan is an alias)
- §24 Skill bundles (`bundle` type + initial bundle catalog)
- §60 Import (`export` exists; `import` absent)
- §52 Workflow engine
- §46 Caching (router_cache table exists; no cache-backed project/graph layer)
- §55 Hooks (event bus exists; hook lifecycle absent)
- §42 Version constraints (`^2.0.0` parsing/`>=` support in dependency resolution)
- §43 Compatibility engine (per-agent `compatibility` map exists; OS/runtime checks absent)
- §63/§64 Evaluation framework + golden tests (router tests cover basics)

### Low / future

- §53 Multi-agent orchestration
- §49 Optional LLM router (interface exists, no provider)
- §48 Semantic matching (interface exists, lexical fallback)
- §56 HTTP API (`serve`), §62 Telemetry (default off, absent), §25 dynamic cleanup policies

## Phased plan

- **Phase A — Reliability engine**: `skill_metrics` storage + bounded updates +
  dynamic `historical` factor + `stats` command
- **Phase B — Failure recovery**: fallback chains (manifest/types/schema), fallback
  resolver with loop prevention, `learn` outcome recording, fallback events
- **Phase C — Routing strategies**: `router.strategy` config + weight presets +
  `cost`/`latency`/`reliability` metadata
- **Phase D — Context-aware routing**: wire CapabilityGraph (cluster discovery) and
  ContextEngine snapshots into the router
- **Phase E — Plugin ecosystem**: `plugin install/remove` + pre-install validation
- **Phase F — Observability & interaction**: `trace`/`graph`/`stats` output, interactive mode