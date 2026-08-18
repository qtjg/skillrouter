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
| `contextPenaltyPerK` | 3 |
| `contextPenaltyCap` | 9 |
| `permissionPenalty` | 12 |

`MAX_SCORE = 100`; the raw sum is clamped to `[0, 100]`.

## How factor hits are accumulated

- **Task text (Level 1):** each matched keyword/technology/intent token adds the weight, capped at 3 hits each (e.g. `min(3, hits) * 12`). Description-only matches add `min(8, hits * 0.5)`. A task token matching the capability name or id adds the full `nameOrId` (20) once.
- **Project:** a project language hit adds `projectLanguage` (6); framework/database/cloud/testing matches add `projectFramework` (15) each, capped at 3 (2 for cloud/testing).
- **Dependencies:** project deps matching capability phrases/technologies (or a cleaned substring of the capability id) add `projectDependency` (18) each, capped at 2.
- **Git:** changed/staged files matching `gitPatterns` add `gitPattern` (18) each, capped at 2. `filePatterns` matching project config files add `filePattern` (18) once.
- **Compatibility** against the first enabled agent (fallback `generic`): native 8, compatible 4, adaptable 1, unsupported -30.
- **Trust:** verified 8, trusted 5, community 2, unknown -6. A **blocked** capability gets -100 and is dropped from ranking entirely.

## Penalties

- **Context cost:** `min(contextPenaltyCap, estimatedTokens / 1000 * contextPenaltyPerK)` — i.e. 3 points per 1000 estimated tokens, capped at 9.
- **Permission cost:** `(risk.score / 100) * permissionPenalty` — the risk engine's 0–100 score scales 12 points. Only positive scores penalize.
- **Quality/history:** declared `metadata.quality` adds its fraction of 8 points. History: **fresh reliability observations** (storage `skill_metrics`, recorded via `skillrouter learn` or the ReliabilityEngine) override declared `metadata.successRate`. The factor is the observed success rate × 8; a capability without observations falls back to the declared rate, and to zero when neither exists. Observations are bounded (see learning/metrics.ts), so a few executions cannot distort ranking.

Signals are kept per factor (`Signal {type, text, weight}`) and feed `skillrouter explain`, so every point in a score is attributable.

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