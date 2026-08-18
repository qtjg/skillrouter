# How Routing Works

A walkthrough from `skillrouter route "…"` to an applied plan.

## 1. Bootstrapping

The CLI (`src/cli/commands/route.ts`) builds an `AppContext` (SQLite at `<stateDir>/skillrouter.db`, config merged from defaults ← global ← project), then refreshes the capability catalog with `refreshAll` (built-in catalog + configured sources; `src/registry/indexer.ts`).

## 2. Project analysis — `src/project/analyzer.ts`

`analyzeProject(cwd)` reads package.json (dependencies/devDependencies, packageManager from lockfiles: pnpm/yarn/npm/bun), pyproject.toml, requirements.txt, Cargo.toml, go.mod, Dockerfile/docker-compose, tsconfig files, and a candidate config-file list (next/vite/nuxt/vitest/jest/playwright/cypress/eslint/prisma/drizzle/supabase/.github/.env/turbo/nx). It detects:

- `languages` (typescript, javascript via package.json, python, rust, go)
- `frameworks` (nextjs, react, vue, svelte, express, fastify, nestjs, supabase, stripe, nextauth, graphql, tailwind, opencode, …)
- `packageManager`, `dependencies`, `devDependencies`
- `databases` (postgresql, mysql, mongodb, redis, prisma, drizzle), `cloudProviders` (aws, gcp, azure, vercel, supabase, docker)
- `testingFrameworks` (vitest, jest, playwright, cypress), `configFiles`, `docker` flag, `signals`

## 3. Git context — `src/git/context.ts`, `src/git/signals.ts`

`getGitContext(cwd)` shells out to `git` (15 s timeout): repo root, branch, porcelain status (changed/staged), `--cached` diff, commit count. `.skillrouter/` entries are skipped. `inferGitSignals` then maps file paths to coarse signal names (authentication, security, database, testing, frontend, api, deployment, documentation, typescript, ui, payments, webhook, subscription, workflow, refactoring) purely as a function of file path — using the `GIT_SIGNAL_PATTERNS` glob table (e.g. `**/auth/**` → authentication, `**/*.test.*` → testing).

## 4. Task analysis — `src/router/analyzer.ts`

`analyzeTask` returns `TaskAnalysis` with `domains`, `operations` (defaults to implementation), canonicalized `technologies` (alias table, e.g. next.js/next → nextjs), and a `riskEstimate` (low/medium/high). Lists live in tables at the top of the file.

## 5. Scoring and ranking — `src/router/index.ts` + `factors.ts`

Every capability in the catalog is scored (weighted sum of factors; see [scoring.md](scoring.md)). Blocked capabilities drop out. Optionally, the lexical semantic matcher (if `router.semantic: true`) adds up to a 25% bonus; the LLM reranker is an interface only in v0.1 and returns `null`. Scores are sorted descending (id as tiebreak).

## 6. Conflict and dependency resolution

- `resolveConflicts` keeps the higher-scoring capability of each declared conflict pair (ties: lower risk wins); losers get `conflictWith` set.
- `expandDependencies` (on the plan's activation ids) computes the deterministic activation order (deps first), plus `missing` required deps and tolerated `optionalMiss`es. Missing deps are reported with a hint to `skillrouter install` them first.

## 7. Planning output — `src/router/planner.ts`

Ranked scores become a plan (`PlanAction[]`) with action types, ordered `activate → keep → deactivate → suspend → keep-inactive`:

- `activate` — selected (score ≥ `threshold` or in `router.always`), not currently active; budgeted by `maxActivations`.
- `keep` — already ACTIVE/CANDIDATE and still selected.
- `deactivate` — active but below threshold / not selected.
- `keep-inactive` — everything else; reason notes explicit `avoid` ids.

Each action carries `confidence` (high ≥ 70, medium ≥ 50), the per-factor `reason` signals, a permission-requirement description, and the target state. `createDecision` sums context tokens (activated+kept) against the 12000-token budget.

## 8. Application and consent gating

- Depending on mode: `manual` → dry run only; `assisted` (default) → prompt "Apply plan?" unless `--yes` or `--apply`; `automatic`/`autonomous` → apply automatically (also `--apply`).
- `Runtime.executePlan` (src/runtime/runtime.ts) iterates plan actions. For each activation it computes risk, builds `PermissionRequest`s (filesystem.write, network `"*"`, shell, credentials, processes), and runs each through `resolvePolicy` (src/security/policy.ts). If any resolves to `ask`:
  - interactive consent is required; denial → `skipped` with "consent denied" (audited);
  - no consent function available (e.g. `--json`) → failure.
- The runtime then calls `adapter.activate(capability, installRoot)` on every enabled agent adapter (per `config.agents`), transitions state, and audits: `runtime activate … agents=… decision=…`.
- Deactivations call `adapter.deactivate` and transition to ENABLED.

## 9. Recording

- `storage.addHistory({ task, project, decisionId, activations, deactivations, selected, mode })` writes the decision row.
- `audit(storage, "user", "route", null, "decision=… activated=… deactivated=… failed=…")` plus per-capability lifecycle audit entries.
- The lockfile (`skillrouter.lock`) is rewritten, and `globalBus` emits `router.decided`, `capability.activated`/`capability.deactivated`/`capability.failed`, `permission.requested`, and `task.changed`.

`skillrouter explain` re-renders the last decision from history with signals, permissions, risk badges, and context budget usage.

## Lifecycle state chain — `src/core/lifecycle.ts`

```
DISCOVERED → INSTALLED → AVAILABLE → ENABLED → CANDIDATE/ACTIVE
```

A single transition table enforces every allowed move (`canTransition`/`transition`, `SkillRouterError("E_STATE")` on illegal moves). Supporting states: `SUSPENDED`, `BLOCKED` (security violation), `DISABLED`, `FAILED`, `OUTDATED`. The router only proposes transitions; the runtime executes them through adapters and records each one in the audit log (D-007). If a requested transition has no direct edge (e.g. DISCOVERED → ACTIVE), the runtime walks the legal path INSTALLED → AVAILABLE → ENABLED → ACTIVE.