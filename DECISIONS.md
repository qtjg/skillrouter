# DECISIONS.md

Important architectural decisions for SkillRouter. Each entry records:
Decision, Context, Options, Chosen approach, Reason, Consequences.

---

## D-001: Single package with domain-divided `src/` instead of a packages monorepo

- **Decision:** Ship V0.1 as one npm package (`skillrouter`) with `src/` divided by domain (cli, core, manifest, router, registry, security, runtime, adapters, storage, config, logging, project, git, utils).
- **Context:** PRD §37 recommends a `packages/` monorepo; PRD §69 sanctions the `src/` domain layout. The repo starts empty; a monorepo adds workspace tooling, build coordination and versioning overhead without functional benefit at this stage.
- **Options:** (a) npm/pnpm workspaces monorepo, (b) single package with `src/` domains, (c) single flat `src/` tree.
- **Chosen approach:** (b).
- **Reason:** Option (a) buys nothing until third-party adapters/SDK consumers exist; the PRD explicitly permits deviation when architecture quality is preserved. Every `src/<domain>/` directory is a package-sized boundary with an explicit public surface, so extraction into `packages/*` later is mechanical.
- **Consequences:** One dependency graph; `@skillrouter/*` package names are deferred to a future multi-package release.

## D-002: Runtime dependency set is `yaml` only; all else is Node built-ins

- **Decision:** Use `node:sqlite` for storage, `node:test` for tests, a hand-written recursive-walk for globbing, hand-rolled ANSI colors/tables, and Node's built-in type stripping instead of a bundler/ts-node.
- **Context:** The environment has Node 24 (native TS type stripping, stable `node:sqlite`); native modules (`better-sqlite3`) require toolchain builds. Engineering Rule 2: no unnecessary dependencies.
- **Options:** better-sqlite3 + vitest + chalk + commander + fast-glob + tsx; versus built-ins.
- **Chosen approach:** built-ins + `yaml` (required for YAML parsing, per PRD "Manifest: YAML").
- **Reason:** Fewer supply-chain and build risks; faster installs; `node:sqlite` is real SQLite wrapped by a replaceable storage interface (PRD §29 satisfied).
- **Consequences:** CLI needs Node >=22.5; embedding-based semantics and LLM routing remain pluggable interfaces without client libraries.

## D-003: Routing must not require an LLM

- **Decision:** The routing engine is deterministic by default (Level 1). Semantic (Level 2) and LLM (Level 3) layers are pluggable interfaces; absent a configured model, the router silently degrades to Level 1 and notes it in explanations.
- **Context:** PRD §§11, 28, 156: the model is a routing *component*, never the product.
- **Options:** LLM-first routing; hybrid.
- **Chosen approach:** hybrid with deterministic default.
- **Reason:** Offline/instant routing, testable decisions, no vendor lock-in, and PRD's explicit requirement.
- **Consequences:** Benchmark can assert deterministic accuracy without network; LLM integration is opt-in configuration.

## D-004: Manifest schema `skillrouter/v1` with normalized canonical capability model

- **Decision:** One canonical `Capability` model in `src/core/types.ts`. Manifests (YAML) validate against `schemas/skillrouter-v1.schema.json` semantics, then normalize into the canonical model. Agent-specific fields never leak into the canonical model.
- **Context:** PRD §§6-7, 70. Provider-specific logic must stay out of core (Rule 5).
- **Options:** per-agent models + converters; single universal model + per-adapter mapping.
- **Chosen approach:** single universal model; adapters translate.
- **Reason:** Keeps the router, registry and security subsystems provider-agnostic.
- **Consequences:** New agent support = new adapter only.

## D-005: Classification of agent integration is adapter-translation, not wholesale conversion

- **Decision:** Adapters reuse a capability's native files (SKILL.md, resources) when the target agent supports the standard Agent Skills layout; they only generate agent-specific wrappers (e.g. Gemini extension.yaml, MCP config) when required.
- **Context:** PRD §§21-22, 33-35, 74: prefer universal `.agents/skills`; don't create vendor-specific duplicates.
- **Options:** always convert; reuse when possible.
- **Chosen approach:** reuse when possible.
- **Reason:** Interop wins and avoids drift between copies.
- **Consequences:** Install for OpenCode/Gemini/Claude may share files via one install root (`.skillrouter/installed/<id>`), with per-agent activation wrappers.

## D-006: Install root under the project (`.skillrouter/installed/`) with per-user cache

- **Decision:** Installed capability payloads live under the project's `.skillrouter/installed/<id>@<version>`, tracked by `skillrouter.lock`, with the shared config data directory `~/.local/share/skillrouter` holding the registry DB, logs and global state.
- **Context:** Reproducibility (lockfile), team mode (§85), atomic installs (§28, §96), local-first (§57).
- **Options:** user-global installs only; project-level installs + global DB.
- **Chosen approach:** project-level installs + global DB.
- **Reason:** Lockfile-per-project reproducibility; DB remains personal/global (routing history, trust, events).
- **Consequences:** `skillrouter install` requires a project context (or `--global` for user-level installation).

## D-007: Activation state machine with explicit transitions

- **Decision:** A single state machine (DISCOVERED → INSTALLED → AVAILABLE → ENABLED → CANDIDATE → ACTIVE → …) governs all lifecycle transitions; the router only proposes transitions, the runtime executes them through adapters, and every transition is written to the audit log.
- **Context:** PRD §§14, 21, 55.
- **Options:** free-form boolean flags; formal state machine.
- **Chosen approach:** formal state machine with permitted-transition table.
- **Reason:** Prevents illegal transitions, makes dynamic switching testable, gives auditability.
- **Consequences:** Adapters become dumb executors; policy lives in core.

## D-008: Risk scores are computed from declared permissions, not freeform

- **Decision:** Risk level (LOW/MEDIUM/HIGH/CRITICAL) and a 0–100 score are derived deterministically from the declared permission set (filesystem, network, shell, environment, credentials, hooks, processes), with capability-provided `risk.level` accepted only as a ceiling override. Third-party capabilities are untrusted by default.
- **Context:** PRD §§24-25, 39-41, 78, 80, 124.
- **Options:** trust the manifest's declared risk; compute from permissions.
- **Chosen approach:** compute from permissions + declared ceiling.
- **Reason:** Declared risk is attacker-controlled; derived risk can be verified and tested.
- **Consequences:** Malformed/overbroad permission declarations are flagged and corrected at install time.

## D-009: Deterministic scoring with modular, documented factors

- **Decision:** Capability relevance is a weighted sum of independent factors (keyword match, technology match, project match, git match, dependency match, compatibility, trust, quality, historical success; penalties for context cost, permission cost, conflicts). Weights live in one module and are config-overridable.
- **Context:** PRD §§10-13, 17, 71-72.
- **Options:** single opaque score; modular factors.
- **Chosen approach:** modular factors with per-factor signals retained.
- **Reason:** Every decision is explainable (PRD §13) and the formula can evolve (PRD §12).
- **Consequences:** Router "why" output is generated directly from retained signal lists.

## D-010: CLI is a lightweight hand-rolled command framework

- **Decision:** No commander/oclif; a ~150-line command framework supporting flags, `--json`, help, and typed exit codes.
- **Context:** PRD §8 ("lightweight custom command framework" is an explicitly named option), Rule 2.
- **Options:** oclif; commander; hand-rolled.
- **Chosen approach:** hand-rolled, with `--json` output as a first-class rendering mode.
- **Reason:** Zero dependencies, full control over UX, easy to test.
- **Consequences:** Flag-parsing edge cases are covered by unit tests.

## D-011: SQLite schema versioned via PRAGMA user_version

- **Decision:** Storage migrations are applied in order on open, tracked by `PRAGMA user_version`.
- **Context:** PRD §29; replaceable storage layer.
- **Options:** ORM; raw sqlite with migrations.
- **Chosen approach:** raw prepared statements + ordered migrations.
- **Reason:** No ORM dependency; explicit, testable schema.
- **Consequences:** Future storage backends implement the same interface.

## D-012: Task-to-capability matching uses normalized text signals

- **Decision:** Tasks and capability triggers are both reduced to normalized token/phrase sets (keywords, intents, technologies, file patterns). Level 1 matching compares these directly with stemming aliases; project/git signals are separate factors.
- **Context:** PRD §16 (task understanding: domain/technologies/operations/risk).
- **Options:** regex rules per domain; normalized token matching.
- **Chosen approach:** normalized tokens with alias tables (e.g. "nextjs" ↔ "next.js" ↔ "next").
- **Reason:** Data-driven, extensible, and testable; no per-vendor rules in core.

## D-013: Consent gates follow declared risk, defaulting to prompt for HIGH/CRITICAL

- **Decision:** ACTIVE transitions for capabilities whose derived risk is HIGH or CRITICAL require interactie consent unless `security.require_consent: false` is configured; INSTALL requires consent for HIGH/CRITICAL too. Automatic mode never bypasses consent; it only skips per-item prompts for LOW/MEDIUM.
- **Context:** PRD §§51, 81, 144-145.
- **Options:** consent for everything; consent only for high risk.
- **Chosen approach:** risk-tiered consent, never auto-approve HIGH/CRITICAL.
- **Reason:** PRD 145: "the more dangerous the capability, the more explicit the consent."
- **Consequences:** `--yes` flags are honored for MEDIUM and below if configured; HIGH/CRITICAL always require an explicit choice in interactive mode.

## D-014: Logging is JSONL with an in-memory + file ring buffer

- **Decision:** Structured logs to `~/.local/share/skillrouter/logs.jsonl` with a bounded in-memory buffer for `--follow`; secret-shaped values are redacted at emission; `skillrouter logs` reads the file.
- **Context:** PRD §31.
- **Options:** console-only; JSONL file.
- **Chosen approach:** JSONL file + ring buffer + redaction.
- **Reason:** Auditable, machine-readable, and safe.
- **Consequences:** `--json` on logs re-emits entries without lossy re-parsing.

## D-015: MCP is configuration-based in V0.1

- **Decision:** MCP capabilities are represented as first-class capabilities (`type: mcp-server`) whose "installation" writes/updates MCP configuration (`.mcp.json` project file and `~/.config/mcp.json` global), enabling/disable toggles entries. No MCP client protocol is implemented in V0.1.
- **Context:** PRD §§23, 34; "Do not build a giant MCP implementation before the core capability system works."
- **Options:** full MCP client; config-level integration.
- **Chosen approach:** config-level integration.
- **Reason:** Matches PRD sequencing; core protocol work is future.
- **Consequences:** MCP server lifecycle is manage, not execute.

## D-016: Benchmark expects strict deterministic behavior

- **Decision:** The benchmark dataset (§33, §122) is asserted against the deterministic Level 1 router with explicit expected capability sets per task; latency and recall metrics are reported, and top-3 recall >= 90% is enforced as a regression gate.
- **Context:** PRD §33, §121-122.
- **Options:** report-only metrics; enforced gates.
- **Chosen approach:** enforced gates for recall, soft report for the rest.
- **Reason:** Routing correctness is the core product promise; gates prevent silent regressions.
```