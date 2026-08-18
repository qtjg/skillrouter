# Routing with the programmatic API

`examples/routing/example.ts` is a runnable example of the SkillRouter
programmatic API. Run it with Node 22.x:

```sh
node --experimental-transform-types examples/routing/example.ts
```

The CLI equivalent of the routed task is:

```sh
skillrouter route "write unit tests for the CLI"
```

## What the example covers

1. **Context assembly** - a `RouteContext` is built from:
   - `analyzeProject(process.cwd())` - what languages, frameworks,
     dependencies, and testing tooling exist in the project
     (`src/project/analyzer.ts`).
   - `getGitContext(process.cwd())` - repo root, branch, staged/changed
     files, and signals derived from them (`src/git/context.ts`).
   - `mockCapabilities()` / `mockInstalled()` - a deterministic set of
     in-memory capabilities and their install states, so the example needs
     no storage or network (`src/utils/mockdata.ts`).
   - `DEFAULT_CONFIG` - the shipped default configuration
     (`src/config/config.ts`).
2. **Routing** - `new Router().route(ctx)` runs the full pipeline: task
   analysis, per-capability scoring, compatibility and security filtering,
   dependency resolution, conflict resolution, and the activation plan.
3. **Explaining** - `explainDecision(decision)` turns the raw
   `RouterDecision` into readable fields: task, analysis summary,
   activations (id, score, confidence, signals, permissions), kept and
   deactivated capabilities, context estimate vs budget, and `latencyMs`.

## The determinism guarantee

`Router.route` is dependency-free and deterministic: with the same task,
capabilities, installed state, project/git context, and config, it produces
the same scores and the same plan every time. The only inputs that can break
determinism are disabled by default:

- `router.semantic: true` enables a lexical similarity pass, which is still
  deterministic in its default `LexicalSemanticMatcher`.
- setting `router.model` enables LLM re-ranking, which is inherently
  non-deterministic. The example uses `DEFAULT_CONFIG`, so neither applies.

Everything else - keyword scoring, compatibility, trust, conflict
resolution, and planner ordering - is pure functions over the inputs. The
only non-deterministic fields on a decision are `decisionId` and
`createdAt`, which are metadata, not routing logic.

## Project and git context are optional

`RouteContext.project` and `RouteContext.git` are typed as nullable on
purpose. The router scores higher when the context matches (project
technology, changed files, git signals), but a minimal context with just a
task and capabilities works fine - the ranking simply relies on keywords,
intents, and technologies declared in capability manifests.

## Going further

- `src/router/types.ts` documents every field of `RouteContext`,
  `RouterDecision`, and `PlanAction`.
- `src/router/explainer.ts` exposes `findCapabilityScore` and
  `summarizeScores` for richer reporting.
- The CLI wraps the same API: `skillrouter route`, `skillrouter explain`,
  and `skillrouter active --explain` all use it.