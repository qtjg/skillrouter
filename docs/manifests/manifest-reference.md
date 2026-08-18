# Manifest Reference (skillrouter/v1)

A capability manifest is a single universal description of a skill, plugin, tool, or MCP server — one canonical model (`Capability` in `src/core/types.ts`) that any agent adapter can consume (D-004). The machine-readable contract is `schemas/skillrouter-v1.schema.json`; runtime validation is implemented in `src/manifest/validate.ts` (parse → validate → normalize) and loaded via `loadManifestFile` in `src/manifest/index.ts`.

## Required fields

```yaml
schema: skillrouter/v1      # string; only skillrouter/v1 is supported
id: stripe-expert           # ^[a-z0-9][a-z0-9-]*$ , max 64 chars
name: Stripe Expert         # string (min 1 char)
version: 1.2.0              # semver (v-prefix tolerated)
description: Help with Stripe integration, billing and webhooks   # string
type: skill                 # one of the 14 types below
```

- `id` regex: `^[a-z0-9][a-z0-9-]*$`, max 64 (see `src/core/ids.ts`).
- `version`: SemVer per the schema pattern `^v?[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-.]+)?$` (validated by `isValidSemVer`).
- `type` enum (14): `skill`, `plugin`, `mcp-server`, `command`, `hook`, `agent`, `sub-agent`, `context`, `template`, `script`, `extension`, `tool`, `workflow`, `adapter`.

## Optional fields

| Field | Type | Notes |
| --- | --- | --- |
| `capabilities` | string or string[] | Actions/sub-capabilities provided. |
| `triggers` | object | When the router should pay attention: `keywords`, `intents`, `technologies`, `filePatterns`, `gitPatterns` — string arrays each (string coerced to array). |
| `compatibility` | object | Per-agent map, values `native` \| `compatible` \| `adaptable` \| `unsupported`; unknown agents treated as `adaptable`. |
| `dependencies` | array | Entries as strings (`{ id }`) or objects `{ id, version?, optional? }` (id must be a valid capability id; `optional: true` tolerates absence). |
| `conflicts` | string[] | Capability ids this capability conflicts with; resolved by the router. |
| `enhances` / `replaces` / `compatibleWith` | string[] | Relationship metadata used by the capability graph: augmented capabilities, superseded capabilities, and compatibility tags (environments/tools). |
| `fallbacks` | string[] | **Ordered** fallback capability ids to activate if this capability fails at runtime; used by `skillrouter learn --failure` and the fallback resolver (loops are prevented — see [routing](../routing/how-routing-works.md)). |
| `permissions` | object | Declared permission surface — see [security/permissions.md](../security/permissions.md). |
| `risk` | object | Declared hint: `level` (`low`\|`medium`\|`high`\|`critical`), `score` (0–100), `reasons` (string[]). The engine only uses it as a **floor**; risk is computed from permissions. |
| `context` | object | `estimatedTokens` (number), `activationLevel` (0–5), `resources` (string[]). |
| `metadata` | object | `categories`, `tags` (string arrays), `license`, `author`, `repository`, `homepage` (strings), `quality`, `popularity`, `successRate` (numbers 0–100). |
| `resources` | string[] | Payload directories/files shipped with the capability. |
| `trust` | string | `verified` \| `trusted` \| `community` \| `unknown` (default) \| `blocked`. |
| `signature` | object | Added by `skillrouter sign`; see [security/signing.md](../security/signing.md). |

## Validation pipeline (`src/manifest/validate.ts`)

`parseManifestYaml` (YAML via the `yaml` package; root must be a mapping) → `validateManifest` collects `problems`, splits into `errors` (blocking paths: `schema`, `id`, `version`, `description`, `type`, `name`) and `warnings` → `normalizeManifest` produces the canonical `Capability` (defaults: `type` → `skill`, `trust` → `unknown`, `schema` → `skillrouter/v1`).

**Non-blocking warnings:** e.g. no `capabilities` and no `triggers` declared → "the capability will only match by description", and (in non-strict mode) other non-blocking problems. `loadManifestFromContent` throws `ManifestError` only on fatal problems (or any problem when `strict: true`).

## Complete example

```yaml
schema: skillrouter/v1
id: stripe-expert
name: Stripe Expert
version: 1.2.0
description: Help with Stripe integration, billing, and webhooks
type: skill
capabilities: [create-checkout, manage-refunds, list-invoices]
triggers:
  keywords: [stripe, checkout, billing, invoice]
  intents: [set-up-payments, process-refunds]
  technologies: [stripe, node, javascript]
  filePatterns: ["**/*stripe*", "**/*checkout*"]
  gitPatterns: ["**/*payment*"]
compatibility:
  opencode: native
  claude: compatible
  gemini: adaptable
dependencies:
  - id: payment-utils
    version: ">=1.0.0"
  - id: metrics-hook
    optional: true
conflicts: [billing-helper]
permissions:
  filesystem:
    read: true
    write: false
    paths: ["src/stripe/**"]
  network:
    allowed: ["api.stripe.com"]
  environment:
    read: true
    variables: ["STRIPE_SECRET_KEY"]
  credentials:
    access: explicit
    allowed: ["stripe"]
risk:
  level: medium
context:
  estimatedTokens: 1500
  activationLevel: 2
metadata:
  categories: [payments, ecommerce]
  tags: [stripe, billing]
  license: MIT
  author: Acme
  repository: https://github.com/acme/stripe-expert
  quality: 85
resources: [instructions/, templates/]
```

## YAML vs JSON and signing

- The **loader accepts YAML or JSON** (anything the `yaml` package parses) via `skillrouter.yaml`/`manifest.yaml`/JSON files.
- **Signing operates on JSON manifests only**: `skillrouter sign <manifest.json>` parses with `JSON.parse` and writes back JSON. Sign a JSON copy of your manifest before publishing.
- `trust` and `risk.level` declared in the manifest are treated as hints; the source of truth for trust is the local trust store, and for risk it is the computed engine score.