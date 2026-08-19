# Context Engine (Phase D)

The context engine collects a normalized, bounded, sanitized view of the workspace and runtime that feeds routing and scoring.

## Architecture

- `src/context/types.ts` — `ContextProvider` interface, `ContextFragment`, `NormalizedContext`.
- `src/context/providers.ts` — built-in providers (pluggable; anything implementing `ContextProvider` can be injected).
- `src/context/normalize.ts` — flattening, bounding, and secret redaction.
- `src/context/collect.ts` — `collectContext(cwd, options)` orchestration with per-provider timeouts.
- `src/cli/commands/context.ts` — `skillrouter context` CLI command.

## Providers

| Provider | Priority | Fields (namespaced) |
| --- | --- | --- |
| `project` | 20 | `project.language`, `project.framework`, `project.packageManager`, `project.database`, `project.cloudProvider`, `project.testingFramework`, `project.docker`, `project.typescript`, `project.javascript`, `project.dependencyCount`, `project.configFiles` |
| `package-manager` | 35 | `package-manager.name`, `package-manager.lockfile` |
| `runtime` | 30 | `runtime.os`, `runtime.arch`, `runtime.node`, `runtime.shell`, `runtime.interactive`, `runtime.offline` |
| `filesystem` | 40 | `filesystem.isEmpty`, `filesystem.entryCount`, `filesystem.hasGitDir`, `filesystem.hasEnvFile`, `filesystem.entries` (≤ 50 top-level entries) |
| `git` | 10 | `git.branch`, `git.dirty`, `git.changed`, `git.staged`, `git.signals` |
| `environment` | 50 | `environment.ci`, `environment.nodeEnv`, `environment.sensitiveVarCount`, `environment.npm` |

Providers are sorted by `priority`; later providers win per-key when flattening.

## Normalization rules (`src/context/normalize.ts`)

- Nested objects flatten into dotted keys (`project.language`), max depth 3.
- Values are limited to strings (≤ 200 chars), finite numbers (`|v| < 1e9`), booleans, and arrays of ≤ 10 primitives.
- Anything else is dropped (`[dropped]`) — never persisted.
- Total field count is bounded (200).
- Secrets are redacted: keys matching `token|secret|password|passwd|api[_-]?key|private[_-]?key|access[_-]?key|auth|credential|cookie|session` are replaced with `[redacted]`, and values matching known secret shapes (Stripe/OpenAI/GitHub/AWS/npm/JWT/private keys) are redacted regardless of key.
- The `environment` provider never includes sensitive variable values — only a count of how many sensitive variables are set.

Sanitization is unit-tested (`tests/context/providers.test.ts`): setting `API_TOKEN`/`AWS_SECRET_ACCESS_KEY` in the process environment must never leak into collected or CLI output.

## Failure behavior

`collectContext` never throws because of a provider:

- A provider that rejects → recorded in `warnings` + timeline `ok: false`.
- A provider that exceeds `router.context.timeoutMs` → timeline entry with `timedOut: true`.
- Context collection disabled (`router.context.enabled: false`) → empty `fields` and a warning.

## Configuration

```yaml
router:
  context:
    enabled: true
    timeoutMs: 1000     # per-provider timeout, 1–30000 ms
```

## CLI

```bash
skillrouter context          # human-readable
skillrouter context --json   # { fields, warnings, timeline }
```

## Public API

```ts
import { collectContext } from "./context/collect.ts";
const ctx = await collectContext(process.cwd(), { timeoutMs: 1000 });
// ctx.fields["project.language"], ctx.fields["git.branch"], ...
```