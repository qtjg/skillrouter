# Intent & Constraints (Phase E)

## Intent classification

`src/intent/classifier.ts` provides a deterministic, rule-based classifier — no
LLM dependency. The `IntentClassifier` interface stays open for ML/LLM
implementations.

```ts
interface IntentClassifier {
  classify(task: string, context?: NormalizedContext): Promise<IntentResult> | IntentResult;
}
```

### Intents

| Intent | Description |
| --- | --- |
| `coding` | implement/build/create features |
| `debugging` | fix errors, crashes, hangs |
| `testing` | unit/integration/e2e tests, coverage |
| `research` | investigate, compare, understand |
| `documentation` | readme, changelog, docstrings |
| `refactoring` | restructure, rename, simplify, migrate |
| `security` | audit, vulnerabilities, hardening |
| `deployment` | deploy, release, pipeline |
| `analysis` | review, profile, verify, monitor |
| `generation` | design, scaffold, boilerplate |

### Confidence

- Each intent scores by keyword hits; discriminating keywords (`fix`, `refactor`,
  `audit`, `deploy`, …) count ×3 so they break ties.
- `confidence = min(0.95, (best / (best + second)) × min(1, best / 3))`.
- No keywords matched → `analysis` with confidence 0.05 (deterministic "unknown"
  handling).
- Ambiguous tasks land at medium confidence; output is fully deterministic.

The classifier consumes `analyzeTask` for domain/technology detection and can
be enriched with a normalized context (e.g. project languages feed the
`language` result field).

## Constraints

`src/constraints/constraints.ts`. Hard constraints eliminate candidates
**before** ranking; soft preferences (`softPreferenceDelta`) only adjust scores.

```ts
interface RouteConstraints {
  network?: "allowed" | "forbidden";
  maxCost?: number;        // declared metadata.cost (1–5)
  maxLatency?: number;     // declared metadata.latency (1–5)
  maxLatencyMs?: number;   // declared metadata.latencyMs
  permissions?: string[];  // allowed permission boundary
  requiredCapabilities?: string[];
  requiredFramework?: string[];
  requiredLanguage?: string[];
}
```

### Permission kinds

`permissionKinds(capability)` derives canonical kinds from the permission set:

`filesystem.read`, `filesystem.write`, `network.read`, `network.write`,
`process.execute`, `shell.execute`, `git.write` (via `metadata.gitWrites`),
`environment.read`, `credentials`, `hooks`, `mcp`.

Network access (`network.allowed` non-empty) implies both `network.read` and
`network.write`. A candidate requiring any kind outside the configured boundary
is rejected.

### Manifest additions

```yaml
requirements:
  language: [typescript, javascript]
  framework: [react, nextjs]
  runtime: [linux]
  network: false
metadata:
  latencyMs: 900        # exact ms for maxLatencyMs constraints
  gitWrites: true       # adds the git.write permission kind
```

## CLI

```bash
skillrouter classify "<task>"          # human-readable
skillrouter classify "<task>" --json   # { intent, confidence, domain, language, signals, operations }
```

## Router integration (Phase F)

- The router auto-classifies intent when none is supplied (`classifyIntent`),
  and the decision carries it: `decision.intent = { type, confidence }`.
- Hard constraints are applied in `rank()` **before** scoring; eliminated
  candidates never appear in `decision.scores`.
- `requiredCapabilities` are merged into the planner's `always` list, forcing
  them into the activation set for that route.
- Matching `requiredLanguage`/`requiredFramework` add a soft preference signal
  (`preference`, +6 per match) on top of the hard requirement.

```bash
skillrouter route "<task>" --constraints '{"network":"forbidden","requiredCapabilities":["web-search"]}'
skillrouter route "<task>" --json        # activate[].breakdown, intent, context fields
```

`--constraints` accepts a JSON object; unknown keys or malformed JSON are
rejected. Every activation in `--json` output now includes a normalized 0–1
`breakdown` (see `docs/routing/scoring.md` §Phase F breakdown).