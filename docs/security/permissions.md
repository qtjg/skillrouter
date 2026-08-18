# Permissions

Capabilities declare their permission surface in the manifest (`permissions` in the `skillrouter/v1` schema, modeled as `PermissionSet` in `src/core/types.ts`). The declaration drives risk scoring, consent gating, and per-capability review. Runtime enforcement happens through policy resolution (`src/security/policy.ts`) and per-capability overrides (`src/security/permissions.ts`).

## `PermissionSet` reference

```yaml
permissions:
  filesystem:
    read: true                 # boolean
    write: false               # boolean
    paths: ["src/**"]          # optional scope; adds +5 to risk score
  network:
    allowed: ["api.example.com", "*.example.com"]   # hostnames or "*"
    deny: ["internal.local"]
  shell:
    enabled: true              # boolean
    allow: ["git", "npm"]      # allowlist (-15 risk points)
    deny: ["rm", "curl"]       # denylist (+5 risk points)
  environment:
    read: true
    variables: ["DATABASE_URL", "API_KEY"]
  credentials:
    access: explicit           # none | explicit | requested
    allowed: ["stripe"]
  hooks:
    enabled: true
    events: ["task.after"]
  mcp:
    servers: ["local-db"]      # server names
  processes:
    enabled: true
    allow: ["node"]
```

Validation (`src/manifest/validate.ts`) rejects unknown fields per kind and malformed shapes; `network.allowed: ["*"]` must not be combined with other entries and requires explicit review.

## Risk points (quote from `src/security/risk.ts`)

Permissions map to risk points as follows (`computeRisk`):

| Permission | Points |
| --- | ---: |
| `filesystem.read` | 10 — "Can read project files" |
| `filesystem.write` | 20 — "Can modify project files" |
| `filesystem.paths` (scoped) | 5 — "Scoped to N path(s)" |
| network scoped (non-`*`) | 10 — "Network access to N domain(s)" |
| network wildcard `*` | 35 — "Unrestricted network access" |
| shell enabled | 30 — "Can execute shell commands"; allowlist **-15**; denylist **+5** |
| environment.read | 10 — "Can read environment variables" |
| sensitive env vars (KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL/PRIVATE) | 10 |
| credentials `explicit` | 15 — "Requires explicit credential access" |
| credentials `requested` | 20 — "Requests credential access at runtime" |
| hooks enabled | 20 — "Registers execution hooks" |
| mcp servers | 10 — "Connects to N MCP server(s)" |
| processes enabled | 25 — "Can spawn processes" |

The declared risk floor table (`RISK_FLOOR`): `low 0, medium 30, high 55, critical 80`. Final score = `max(permission points, declared floor)`, capped at 100. Declared `risk.level` never lowers a computed score.

## Constraints for review

- **Network `"*"`** — unrestricted network access requires an explicit flag or user review at activation/policy time: the manifest validator warns unless the entry is explicit, the risk engine charges 35 points, `resolvePolicy` returns `ask` for target `*`, and the runtime requests consent.
- **Credentials always ask** — `resolvePolicy` returns `ask` for the credentials kind regardless of risk level; there is no auto-allow path in v0.1.
- **High/critical risk** — activation with risk high/critical requires consent when `security.requireConsent: true` (the default); `--yes`/automatic mode never bypasses an `ask`/`deny` result.
- **Review command** — `skillrouter permissions <cap> [--add fs:write,net:…] [--remove …]` shows/edits the effective permission descriptor list (e.g. `fs:read`, `fs:write`, `fs:path:src/**`, `net:api.example.com`, `shell:exec`, `process:spawn`, `env-secrets`, `mcp:<server>`) and persists per-capability overrides (`permissions.overrides` preference). Edits are only allowed on installed capabilities.
- **Policy overrides** — `security.policy` in config (`allow`/`deny` lists, `default: allow|ask|deny`, wildcard `*` and `*.domain` matching) applies before the risk-based defaults.

## Enforced at runtime

`Runtime.permissionRequestsFor` maps manifests to requests for `filesystem.write`, network `*`, `shell`, `credentials`, and `processes`; each goes through `resolvePolicy`, and any `ask` result gates activation on interactive consent. Deactivation and install-time checks (`CapabilityInstaller.auditInstall`) follow the same risk rules (critical installs require `--force`).