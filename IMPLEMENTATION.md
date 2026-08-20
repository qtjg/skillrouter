# IMPLEMENTATION.md

Implementation tracker for SkillRouter. Updated as work progresses.

Legend: `[x]` done, `[~]` partial, `[ ]` pending.

## Phase 1 — Foundation

- [x] Project architecture (single package, domain-divided `src/`, see DECISIONS.md)
- [x] TypeScript configuration (strict, NodeNext, type-stripped execution)
- [x] Package structure + bin entry
- [x] CLI framework
- [x] Configuration system (project `skillrouter.yaml` + global config)
- [x] Logging (structured JSONL, redaction, `logs` command)
- [x] Error handling (typed error hierarchy, user-facing messages)
- [x] Storage abstraction + SQLite (`node:sqlite`, replaceable interface)
- [x] Testing infrastructure (`node:test`)
- [x] Universal capability types
- [ ] Manifest schema

## Phase 2 — Capability System

- [x] Manifest parser / validator / normalizer (`schema: skillrouter/v1`)
- [x] Capability registry (indexed catalog of capabilities)
- [x] Local capability discovery
- [x] Git capability discovery (git sources)
- [x] Search
- [x] Install
- [x] Uninstall
- [x] Enable / disable
- [x] Update
- [x] Capability metadata
- [x] Dependencies
- [x] Conflicts
- [x] Versioning (semver)
- [x] Lockfile
- [x] Atomic installation (prepare → validate → backup → install → verify → commit / rollback)

## Phase 3 — Routing Engine

- [x] Task analyzer
- [x] Project analyzer
- [x] Git analyzer
- [x] Deterministic matching (Level 1)
- [x] Semantic scoring interface (Level 2, lexical fallback)
- [x] Optional LLM reasoning interface (Level 3)
- [x] Scoring system (modular factors)
- [x] Conflict resolution
- [x] Activation planner (dry-run support)
- [x] Explainability
- [x] Manual override (`force-enable`, `force-disable`, router.always/never)
- [x] Dynamic activation / deactivation
- [ ] Benchmark dataset (in progress)

## Phase 3b — Adapters

- [~] Adapter interface
- [x] OpenCode adapter
- [x] Claude-compatible skill adapter (.claude/skills)
- [x] Generic Agent Skills adapter (.agents/skills)
- [x] Gemini CLI adapter (extensions)
- [x] MCP transport (configuration-based)
- [x] Agent environment detection (`doctor`)

## Phase 4 — Security

- [x] Risk model (LOW/MEDIUM/HIGH/CRITICAL)
- [x] Permission declarations
- [x] Untrusted-by-default policy
- [x] Secret detection
- [x] Audit log
- [x] Trust levels
- [ ] Signature verification (future: ed25519 manifests)

## Phase 5 — CLI

- [x] init / doctor / status / config
- [x] search / find / info / recommend
- [x] install / uninstall / update / source
- [x] enable / disable / activate / deactivate / active
- [x] force-enable / force-disable
- [x] route (incl. `--dry-run`) / explain
- [x] audit / permissions / trust
- [x] logs
- [x] verify
- [x] export (generic format)

## Phase 6 — Documentation & Examples

- [x] README.md
- [x] CONTRIBUTING.md
- [x] SECURITY.md
- [x] LICENSE (MIT)
- [~] docs/ (architecture, manifest, routing, adapters, security, cli-reference, configuration)
- [x] schemas/skillrouter-v1.schema.json
- [x] examples/catalog (out-of-the-box capabilities)
- [ ] Examples README

## V1.0 Definition of Done

- [~] Install SkillRouter
- [~] Detect AI tools
- [~] Search capabilities
- [~] Install capabilities
- [~] Use capabilities across multiple supported AI agents
- [~] Automatically route capabilities based on task
- [~] Dynamically change active capabilities
- [~] Explain why capabilities were selected
- [~] Audit permissions
- [~] Lock versions
- [~] Reproduce configuration on another machine

## M1 — Context & Graph Foundation

- [x] Capability graph (requires/conflicts/enhances/replaces/compatibleWith edges, transitive traversal, clustering, validation)
- [x] Context engine (normalized snapshot from parallel, fault-tolerant collectors)
- [x] Manifest relations (`enhances`, `replaces`, `compatibleWith`) in types, validator and schema

## Phase 7 — Reliability & Learning (PRD §22–23)

- [x] `skill_metrics` storage (bounded observations via halving beyond 1000)
- [x] ReliabilityEngine (record outcomes, fresh rates, typed events)
- [x] `historical` scoring factor consumes fresh metrics (declared rate as fallback)
- [x] `stats` CLI command (table + JSON)
- [x] Failure recovery & fallback chains (PRD §21)
- [x] `learn` outcome recording command (failures suggest a declared fallback)
- [x] Routing strategies (balanced/quality/speed/cheap/minimal/safe) + cost/latency metadata (route `--strategy`, `router.strategy` config, weight presets in `src/router/factors.ts`)
- [x] Phase D: pluggable context engine (`src/context/`) — providers git/project/runtime/filesystem/package-manager/environment, normalized dotted fields, secret redaction, per-provider timeouts, `skillrouter context`
- [x] Phase E: intent classifier (`src/intent/`, 10 intents, deterministic confidence) + constraints (`src/constraints/`, hard rejection + permission boundary + soft deltas) + `skillrouter classify`
- [x] Quality analyzer (PRD §8): `src/quality/analyzer.ts` — declared quality authoritative, else derived from completeness/reliability/outcome history; feeds the router `quality` factor; `skillrouter quality`
- [x] Area coverage & distinctiveness (PRD §4.4/§6.4): `src/registry/neighbors.ts` field-weighted overlay; router dilution of weaker near-duplicates (config `router.distinctiveness`); `skillrouter neighbors <id>`
- [ ] Cookbook skills: multi-step planning combining router + runtime observations (PRD §14)
- [ ] Timeline view of routing history (PRD §10, `--timeline`)

## Future (documented, not built in V0.1)

- Runtime daemon (`skillrouter daemon`)
- Embedding-based semantic matching (interface stubbed)
- Learning system (history storage exists; ranking signals stubbed)
- Publishing / registry API / marketplace
- Sandboxing
- Capability signing (ed25519)
- MCP server mode (`skillrouter mcp`)
- CI/CD (`verify` exists; GitHub Action future)