# System Architecture Overview

SkillRouter is a local-first TypeScript CLI (v0.1.0, Node >= 22.5, runtime dependency `yaml` only). It routes AI-agent task descriptions to locally installed capabilities — skills, plugins, tools, and MCP servers — using a deterministic, explainable pipeline.

## Layers

```
CLI (src/cli)                ← commands, flags, --json, config bootstrapping
  ↓
Router (src/router)          ← analysis, scoring, planning (pure; no I/O)
  ↓
Runtime (src/runtime)        ← consent gating, lifecycle transitions, audit
  ↓
Adapters (src/adapters)      ← expose capabilities to agents (opencode, claude, …)
Storage (src/storage)        ← node:sqlite behind the Storage interface
```

The layer rule: the **router only produces a plan** (a `RouterDecision`) and never touches the filesystem or agents; the **runtime executes** the plan through adapters. Adapters never mutate capability payloads — they expose/remove them (see [adapters.md](adapters.md)).

## Domain layout of `src/`

- `cli/` — command framework (`framework.ts`), command implementations, output rendering.
- `core/` — universal types (`types.ts`: `Capability`, `PermissionSet`, trust/risk/state enums), id rules (`ids.ts`), lifecycle state machine (`lifecycle.ts`), events (`events.ts`).
- `manifest/` — YAML parse → validate → normalize (`validate.ts`), file loading (`index.ts`).
- `registry/` — capability indexing, discovery, sources (`sources.ts`), search (`search.ts`).
- `router/` — task analyzer, factor scoring, conflicts, dependency resolution, planner, semantic/LLM interfaces, explainer.
- `runtime/` — plan execution with consent gating.
- `adapters/` — per-agent integration (`opencode`, `claude`, `gemini`, `mcp`, `generic`) plus `types.ts` and `registry.ts`.
- `security/` — keys, sign/verify, secrets scanning, audit, risk, permissions overrides, policy resolution.
- `storage/` — `types.ts` (the `Storage` interface) and `sqlite.ts` (`node:sqlite` implementation).
- `config/` — YAML config loading/merging, `DEFAULT_CONFIG`.
- `project/` — project analysis (`analyzer.ts`).
- `git/` — git context and signal inference (`context.ts`, `signals.ts`).
- `installer/` — transactional install (`installer.ts`), `lockfile/` — the project lockfile.
- `logging/`, `utils/`, `export/` — structured logging, shared utilities (glob, hashing, text normalization), dashboard export.

Each domain directory is a package-sized boundary; per D-001 this keeps the door open for mechanical extraction into `packages/*`.

## Data flow of a route request

1. User runs `skillrouter route "…"`. The CLI bootstraps an `AppContext` (state dir + SQLite + merged config).
2. `refreshAll` (registry indexer, `src/registry/indexer.ts`) refreshes the capability catalog from the built-in catalog, project sources, and git sources.
3. `analyzeProject(app.cwd)` (`src/project/analyzer.ts`) produces `ProjectAnalysis`: languages, frameworks, packageManager, dependencies, testing frameworks, docker, databases, cloud providers, signals.
4. `getGitContext(app.cwd)` (`src/git/context.ts`) produces `GitContext`: branch, changed/staged files, commitCount, and inferred signal list.
5. `new Router().route(routeCtx)` (`src/router/index.ts`) streams: `analyzeTask` → factor scoring per capability → semantic/LLM layers (if configured) → conflict resolution → `buildPlan` (the activation planner) → a `RouterDecision` with scores, plan, explanation signals, and latency.
6. `expandDependencies` computes the deterministic activation order and reports missing required dependencies.
7. `Runtime.executePlan(decision, ctx)` (`src/runtime/runtime.ts`) executes the plan: per-action consent gating via `resolvePolicy`, lifecycle transitions (`canTransition`/`transition`), adapter calls through the `AdapterRegistry` (only for IDs enabled in `config.agents`).
8. History row (`addHistory`) and audit entries (`audit`) are written; a lockfile update and the `task.changed`/`router.decided` events fire.

## Storage

- The `Storage` interface (`src/storage/types.ts`) covers capabilities, installed rows, routing history, audit log, preferences, trust rows, and router cache. It exposes `dataDir` (the directory holding the database, and therefore the `keys/` signing directory).
- `SqliteStorage` (`src/storage/sqlite.ts`) implements it with `node:sqlite` (`DatabaseSync`), WAL mode, and versioned migrations tracked via `PRAGMA user_version` (D-011). The DB lives at `<stateDir>/skillrouter.db`.
- Alternatives can implement the same interface; the core never depends on SQLite directly.

## Configuration

- Project config: `skillrouter.yaml` (searched up to 10 parent directories from the cwd, see `findProjectConfigPath`).
- Global config: `~/.config/skillrouter/config.yaml` (or `$XDG_CONFIG_HOME/skillrouter/config.yaml`).
- State: `~/.local/state/skillrouter` (or `$XDG_STATE_HOME/skillrouter`) — DB, `sources/` cache, `keys/`.
- Load order in `src/config/config.ts`: `DEFAULT_CONFIG` ← global YAML ← project YAML (deep-merged; project wins). `validateConfig` rejects invalid `router.mode`, out-of-range `threshold`, negative `maxActivations`, and malformed `sources[]` entries.
- Full key reference: [routing/configuration.md](../routing/configuration.md).

## Status notes (v0.1.0)

- The LLM reranker (`ConfiguredLlmReranker`) has an interface but no transport; it returns `null`, so ranking stays deterministic (D-003).
- The automated test suite is being built out (`npm test`); `npm run typecheck` is green. Smoke gates: `doctor`, `verify`, `self-test`.