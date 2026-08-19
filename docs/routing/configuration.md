# Configuration Reference

`skillrouter.yaml` is the per-project config; a global `config.yaml` supplies defaults. Merging (in `src/config/config.ts`): `DEFAULT_CONFIG` ← global `~/.config/skillrouter/config.yaml` ← project `skillrouter.yaml` (deep merge, project wins). Project config is located by walking up to 10 parent directories.

Paths:

- Project: `<project>/skillrouter.yaml`
- Global: `~/.config/skillrouter/config.yaml` or `$XDG_CONFIG_HOME/skillrouter/config.yaml`
- State dir: `~/.local/state/skillrouter` or `$XDG_STATE_HOME/skillrouter` (DB `skillrouter.db`, `sources/` cache, `keys/`)

CLI access: `skillrouter config get|set|unset|path <key> [value]` (dot-separated keys), plus `skillrouter init` to scaffold.

## Keys

```yaml
project:
  name: my-project            # optional project name (default null)

router:
  mode: assisted              # manual | assisted | automatic | autonomous (default: assisted)
  always: []                  # capability ids forced into the plan
  never: []                   # capability ids excluded from the plan
  prefer: []                  # ids sorted first among activations
  avoid: []                   # ids explicitly kept inactive
  threshold: 40               # minimum score to activate (0–100; default 40)
  semantic: false             # enable the lexical semantic matcher (Level 2)
  model: null                 # LLM rerank model id (Level 3); default null
  maxActivations: 5           # max capabilities activated per plan (default 5)
  strategy: balanced          # balanced | quality | speed | cheap | minimal | safe (default: balanced)
  context:
    enabled: true             # collect normalized workspace context (default true)
    timeoutMs: 1000           # per-provider timeout in ms, 1–30000 (default 1000)

capabilities:
  autoInstall: false          # install on demand during routing (default false)
  autoActivate: true          # expose to agents after install (default true)

security:
  requireConsent: true        # ask for consent on high/critical risk (default true)
  blocked: []                 # capability ids that may never activate
  policy:                     # permission policy per kind; see below
    # filesystem:
    #   read:  { allow: ["*"], default: allow }   # shape: allow/deny lists + default
    #   write: { deny: ["**/secrets/*"], default: ask }
    # network: { allow: ["api.example.com"], deny: ["*."] }
    # shell:  { default: ask }
    # environment: {}
    # credentials: { default: ask }
    # hooks:  {}
    # processes: { default: deny }

learning:                     # self-learning (Phase G, PRD §22–23)
  enabled: true               # observed reputation/latency reach scoring (default true)
  reputationWeight: 8         # max points verification/rating may nudge `historical` (0–50)
  latencyWeight: 5            # penalty points per 1000 ms of observed average latency (0–50)
  maxOutcomes: 1000           # bounded outcome history kept per capability (10–100000)

agents:                       # enable adapters by agent id
  opencode: true              # default true
  gemini: true                # default true
  claude: true                # default true
  codex: false                # default false (no dedicated adapter in v0.1)
  mcp: false                  # default false
  generic: true               # default true

sources:                      # capability sources (also managed via `skillrouter source add`)
  - name: my-skills
    type: directory           # git | catalog | directory
    path: ./skills            # required for directory/catalog
    # url: https://github.com/user/skills   # required for git
    enabled: true             # optional (default true)
```

## Defaults (`DEFAULT_CONFIG` in `src/config/config.ts`)

```text
project.name:      null
router.mode:       assisted      router.threshold:    40
router.semantic:   false         router.model:        null
router.maxActivations: 5         router.always/never/prefer/avoid: []
capabilities.autoInstall: false  capabilities.autoActivate: true
security.requireConsent: true    security.blocked: []   security.policy: {}
learning.enabled: true           learning.reputationWeight: 8   learning.latencyWeight: 5   learning.maxOutcomes: 1000
agents: opencode/gemini/claude/generic true; codex/mcp false
sources: []
```

## Policy shapes — `src/security/policy.ts`

Each policy key (`filesystem.read`, `filesystem.write`, `network`, `shell`, `environment`, `credentials`, `hooks`, `processes`, `mcp`) accepts a rule set:

```yaml
security:
  policy:
    network:
      allow: ["api.example.com", "*.example.com"]   # exact, wildcard prefix "*.", or full "*"
      deny: ["internal.local"]
      default: ask            # allow | ask | deny
```

Resolution order in `resolvePolicy` (per permission request): blocked capability → `deny`; matching `deny` rule → `deny`; matching `allow` rule → `allow`; credentials → always `ask`; shell/processes → auto-allow only for low/medium risk; network `*` → `ask`; high/critical risk → `ask` when `requireConsent` (else allow); otherwise the rule's `default` action, or `allow`.

Wildcard matching: `*` matches anything; `*.domain` matches the domain or any subdomain suffix; a bare rule matches exactly or any path ending in `/rule`.

## Validation

`validateConfig` rejects: unknown `router.mode`; `threshold` outside 0–100; negative `maxActivations`; non-boolean `learning.enabled`; `learning.reputationWeight`/`latencyWeight` outside 0–50; `learning.maxOutcomes` outside 10–100000; sources missing `name`/`type` or missing `url` (git) / `path` (directory). Errors are surfaced as `ConfigError`s by `skillrouter config` and `doctor`.