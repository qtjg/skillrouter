# Self-Learning (Phase G)

SkillRouter records execution outcomes and uses them to make routing smarter over
time — without ever bypassing security policy, hard constraints, explicit user
restrictions, or deterministic mode.

## Feedback loop

```
Execution
   ↓
skillrouter learn <capability> [--success|--failure] [--latency-ms N] \
                  [--verification pass|fail] [--rating -2..2] [--execution-id ID]
   ↓
skill_outcomes (bounded) + skill_metrics (bounded aggregates)
   ↓
RouteContext.outcomes  →  factors.ts (reputation nudge + observed latency)
   ↓
ReputationEngine  →  skillrouter reputation
```

## What is recorded

| Field | Flag | Meaning |
| --- | --- | --- |
| outcome | `--success`/`--failure` | did execution succeed (default success) |
| task | `--task` | task context |
| latency | `--latency-ms N` | observed execution latency in ms |
| verification | `--verification pass\|fail` | output verification result |
| rating | `--rating -2..2` | explicit user feedback |
| execution id | `--execution-id` | idempotent re-recording of the same run |

Every recording:

- updates the bounded `skill_metrics` aggregates (Phase A halving policy keeps
  the success rate stable under churn);
- appends a row to `skill_outcomes` (per-execution detail for latency,
  verification and rating);
- prunes that capability's history to `learning.maxOutcomes` (default 1000);
- emits a `feedback.received` event on the global bus;
- writes an `audit_log` entry.

## Reputation model (`src/learning/reputation.ts`)

Per capability:

| Metric | Source |
| --- | --- |
| reliability | observed success rate → declared `metadata.successRate` → declared `metadata.reliability` → trust floor |
| success rate | outcome summary |
| avg / p95 latency | outcome latencies |
| verification rate | `--verification pass` ÷ recorded verifications |
| freshness | 30-day half-life decay since last outcome |
| user rating | mean of `--rating` values (−2..+2) |
| security score | `1 − risk.score/100` (deterministic risk engine) |
| trust | capability trust level |

## Scoring impact (`src/router/factors.ts`)

Gated by `learning.enabled` (default true; `false` reproduces pre-Phase-G
scoring exactly):

- **Reputation nudge**: verification rate and ratings add at most
  `learning.reputationWeight` (default 8) points to the `historical` factor.
- **Observed latency**: when outcome latency exists it replaces the declared
  `metadata.latency` penalty, at `learning.latencyWeight` points per 1000 ms.

Deterministic guarantees:

- scoring is a pure function of stored state — same inputs and state always
  produce the same scores;
- hard constraints, permission policy, trust levels and conflict resolution
  are untouched by learning;
- disabling learning (`learning.enabled: false` or `config set
  learning.enabled false`) removes reputation/latency effects entirely.

## CLI

```bash
skillrouter learn cap:web-search --success --task "research pricing" \
  --latency-ms 1200 --verification pass --rating 1
skillrouter reputation                 # table: reliability, success, p95, verify, rating, usage, trust
skillrouter reputation --json          # machine-readable
skillrouter stats                      # legacy aggregate view (Phase A)
```

## Storage

Migration 3 adds `skill_outcomes`:

```sql
CREATE TABLE skill_outcomes (
  execution_id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL,
  task TEXT NOT NULL DEFAULT '',
  success INTEGER NOT NULL DEFAULT 1,
  latency_ms INTEGER,
  verification TEXT,
  rating INTEGER,
  ts TEXT NOT NULL,
  context TEXT
);
CREATE INDEX idx_skill_outcomes_capability_ts ON skill_outcomes(capability_id, ts);
```

Records are idempotent by `execution_id`; the bounded prune keeps the table from
growing without limit.