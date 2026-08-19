# Scoring

Every capability is scored deterministically as a weighted sum of independent factors (`scoreSingleCapability`, `src/router/factors.ts`). Weights live in a single `const W` object so the formula can evolve without touching the rest of the router (D-009).

## Factor weights (`const W` in `src/router/factors.ts`)

| Factor | Weight |
| --- | ---: |
| `keyword` | 12 |
| `technology` | 14 |
| `intent` | 16 |
| `nameOrId` | 20 |
| `description` | 0.5 |
| `projectFramework` | 15 |
| `projectDependency` | 18 |
| `projectLanguage` | 6 |
| `gitPattern` | 18 |
| `filePattern` | 18 |
| `native` | 8 |
| `compatible` | 4 |
| `adaptable` | 1 |
| `unsupported` | -30 |
| `trustVerified` | 8 |
| `trustTrusted` | 5 |
| `trustCommunity` | 2 |
| `trustUnknown` | -6 |
| `qualityFactor` | 8 |
| `historicalFactor` | 8 |
| `reliabilityFactor` | 8 |
| `costFactor` | 5 |
| `latencyFactor` | 5 |
| `contextPenaltyPerK` | 3 |
| `contextPenaltyCap` | 9 |
| `permissionPenalty` | 12 |
| `contextLanguage` | 8 |
| `contextFramework` | 8 |
| `contextRuntime` | 6 |
| `contextMismatchRuntime` | -20 |
| `intentMatch` | 16 |

`MAX_SCORE = 100`; the raw sum is clamped to `[0, 100]`.

## Strategies (`router.strategy`, PRD §13/§50)

`weightsFor(strategy)` in `src/router/factors.ts` returns preset weight overrides. **Balanced is the identity** — it reproduces the pre-strategy weights exactly, so existing deployments are unaffected. `skillrouter route --strategy <s>` overrides the config for one run; the effective strategy is reported in the decision (`strategy` field, JSON mode).

| Strategy | Purpose | Adjusts |
| --- | --- | --- |
| `balanced` | default; no override | — |
| `quality` | best output quality | `qualityFactor` 8→24, `historicalFactor` 8→16, `reliabilityFactor` 8→16, `trustUnknown` -6→-9, `permissionPenalty` 12→14, `costFactor`/`latencyFactor` 5→3 |
| `speed` | lowest latency | `latencyFactor` →14, `contextPenaltyPerK`→6, `contextPenaltyCap`→14, quality/history factors halved, `permissionPenalty`→10 |
| `cheap` | lowest cost | `costFactor`→14, `contextPenaltyPerK`→8, `contextPenaltyCap`→18, quality/history halved, `permissionPenalty`→10 |
| `minimal` | context-conscious activation | Level-1 match weights reduced (keyword 8, technology 10, intent 12, nameOrId 14, description 0.3), quality/history halved, cost/latency/token penalties raised |
| `safe` | minimum risk | `permissionPenalty`→30, `trustUnknown`→-9, verified 10/trusted 7, quality/history 6, `costFactor`/`latencyFactor`→8 |

## How factor hits are accumulated

- **Task text (Level 1):** each matched keyword/technology/intent token adds the weight, capped at 3 hits each (e.g. `min(3, hits) * 12`). Description-only matches add `min(8, hits * 0.5)`. A task token matching the capability name or id adds the full `nameOrId` (20) once.
- **Project:** a project language hit adds `projectLanguage` (6); framework/database/cloud/testing matches add `projectFramework` (15) each, capped at 3 (2 for cloud/testing).
- **Dependencies:** project deps matching capability phrases/technologies (or a cleaned substring of the capability id) add `projectDependency` (18) each, capped at 2.
- **Git:** changed/staged files matching `gitPatterns` add `gitPattern` (18) each, capped at 2. `filePatterns` matching project config files add `filePattern` (18) once.
- **Compatibility** against the first enabled agent (fallback `generic`): native 8, compatible 4, adaptable 1, unsupported -30.
- **Trust:** verified 8, trusted 5, community 2, unknown -6. A **blocked** capability gets -100 and is dropped from ranking entirely.

## Penalties

- **Context cost:** `min(contextPenaltyCap, estimatedTokens / 1000 * contextPenaltyPerK)` — i.e. 3 points per 1000 estimated tokens, capped at 9 (weights change per strategy).
- **Cost / latency:** declared `metadata.cost` (1–5) subtracts `cost * costFactor`; declared `metadata.latency` (1–5) subtracts `latency * latencyFactor`. Accepted at the manifest root or in `metadata` (PRD §9), `metadata` wins.
- **Permission cost:** `(risk.score / 100) * permissionPenalty` — the risk engine's 0–100 score scales 12 points (30 under `safe`). Only positive scores penalize.
- **Quality/history:** declared `metadata.quality` adds its fraction of 8 points. History: **fresh reliability observations** (storage `skill_metrics`, recorded via `skillrouter learn` or the ReliabilityEngine) override declared `metadata.successRate`, which in turn overrides declared `metadata.reliability` (0–1). Each factor is the rate/fraction × its weight; a capability with none of the three contributes nothing to `historical`. Observations are bounded (see learning/metrics.ts), so a few executions cannot distort ranking. **Phase G:** when `learning.enabled` and outcome history exists, verification pass-rate and user ratings add a bounded reputation nudge (`learning.reputationWeight`, default 8) to the same factor; observed average latency (`learning.latencyWeight` per 1000 ms) replaces the declared latency penalty. Disabling learning reproduces the pre-Phase-G scoring exactly.
- **Intent match (Phase E/F):** when a capability declares `capabilities` (categories) that include the classified intent, `intentMatch` (16) is added under `taskSimilarity`. The router computes the intent from the task text when the caller did not supply one.
- **Context match (Phase D/F):** a normalized workspace context is matched against declared `requirements`: each `language` hit adds `contextLanguage` (8, capped 2 hits), each `framework` hit `contextFramework` (8, capped 3), a `runtime` hit adds `contextRuntime` (6), and a mismatched runtime subtracts `contextMismatchRuntime` (-20). Without a context or without declared requirements this factor stays 0.
- **Soft preferences (Phase E/F):** constraints `requiredLanguage`/`requiredFramework` add +6 each to a matching candidate's `preference` factor after the hard check.

Signals are kept per factor (`Signal {type, text, weight}`) and feed `skillrouter explain`, so every point in a score is attributable.

## Phase F breakdown (`scoreBreakdownV2`)

Every scored candidate carries a normalized 0–1 breakdown (`src/scoring/breakdown.ts`), surfaced per activation in `skillrouter route --json`:

| Dimension | Signals included |
| --- | --- |
| `capability` | keyword, technology, taskSimilarity, project, git, file, dependency, compatibility, trust, quality, preference |
| `context` | context (language/framework/runtime match) |
| `intent` | taskSimilarity signals tagged with the intent category |
| `historical` | historical success |
| `strategy` | cost, latency, contextCost penalties |
| `exploration` | reserved for Phase G |
| `riskPenalty` | permissionCost magnitude |

Each dimension is `clamp01(sum / cap)` with group caps (capability 120, context 30, intent 16, historical 10, strategy 30, exploration 10, riskPenalty 30); `total = clamp01(score / 100)`. The breakdown describes *why* a score landed where it did — dimensions are normalized groups, not additive components.

## Risk floor — `src/security/risk.ts`

Risk is computed from declared permissions, never from the manifest's self-declared level (D-008):

| Permission | Points |
| --- | ---: |
| filesystem.read | 10 |
| filesystem.write | 20 |
| filesystem.paths (scoped) | 5 |
| network scoped (non-`*`) | 10 |
| network wildcard (`*`) | 35 |
| shell enabled | 30 (allowlist -15, denylist +5) |
| environment.read | 10 (+10 per sensitive variable) |
| credentials explicit / requested | 15 / 20 |
| hooks enabled | 20 |
| mcp servers | 10 per count |
| processes enabled | 25 |

`RISK_FLOOR` (declared level floor): low 0, medium 30, high 55, critical 80. The final score is `max(computed, declaredFloor)`, clamped to 100, and the level is the highest bucket the score reaches. A manifest-declared level only raises the floor — it can never lower a computed score (reasons include `Manifest declared risk level … (score floor …)`).

The risk score feeds both the routing penalty above and runtime consent gating (high/critical → ask when `security.requireConsent` is on).