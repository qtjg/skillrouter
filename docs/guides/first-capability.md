# First Capability: End to End

This tutorial takes you from a minimal manifest to a routed, explained, scanned, and signed capability.

## 1. Write a manifest

Create a directory with a `skillrouter.yaml` (the schema is `skillrouter/v1`; the loader accepts YAML):

```yaml
schema: skillrouter/v1
id: hello-cli
name: Hello CLI
version: 0.1.0
description: Prints a friendly greeting and checks your project's health
type: skill
capabilities: [greet, check]
triggers:
  keywords: [hello, greeting, greet]
  intents: [say-hello, greet-user]
  technologies: [node]
  filePatterns: ["package.json"]
compatibility:
  opencode: native
  claude: compatible
  generic: compatible
permissions:
  filesystem:
    read: true
    write: false
context:
  estimatedTokens: 300
metadata:
  categories: [utility]
  license: MIT
  author: You
```

Also add a `SKILL.md` (the universal skill payload; reused by opencode/claude/generic adapters, never rewritten — D-005):

```markdown
# Hello CLI

Prints a friendly greeting. Run the bundled `greet.js` with no arguments.
```

Conceptual validation — the id rule (`^[a-z0-9][a-z0-9-]*$`, max 64), `version` semver, `type` one of the 14 enum values, `schema: skillrouter/v1`, and non-empty `name`/`description` are the blocking fields. Missing `triggers`/`capabilities` only warns ("will only match by description"). Full reference: [manifests/manifest-reference.md](../manifests/manifest-reference.md).

## 2. Add a source and install

```sh
skillrouter init --yes          # create skillrouter.yaml (project config)
skillrouter source add local-skills ./path/to/capabilities --type directory
skillrouter search hello        # confirm it is indexed
skillrouter install hello-cli   # audit (risk, secrets), copy to .skillrouter/installed/, record in lockfile
```

`install` runs a security audit first: CRITICAL risk requires `--force`; HIGH requires consent (`--yes`); secrets/sensitive files abort unless `--force`. Use `--dry-run` to preview.

## 3. Enable and activate

```sh
skillrouter enable hello-cli    # state chain: INSTALLED → AVAILABLE → ENABLED
skillrouter activate hello-cli  # expose to enabled agents (opencode/claude/generic dirs)
skillrouter active              # list ACTIVE capabilities
skillrouter status              # states table
```

If you only want it ever routed (not always on), skip `enable` — routing proposes activation on demand.

## 4. Route a task against it

```sh
skillrouter route "greet the user with a hello message"
```

The output shows the task analysis (domains, technologies, operations, risk), the plan (`activate`/`keep`/`deactivate`/`keep-inactive` per capability), latency, and context budget. Then:

```sh
skillrouter explain             # why: per-factor signals, permissions, risk badges
```

`route` without `--apply`/automatic mode asks before applying. Manually apply with `--apply` (or `--yes` in assisted mode). With `router.mode: automatic` it applies automatically, but consent gating still applies for high-risk capabilities.

## 5. Scan it

```sh
skillrouter scan hello-cli      # capability scope: risk + installed-file secret walk
skillrouter scan project        # project scope: hardcoded secrets in your files
skillrouter scan registry       # registry scope: blocked/unsigned high-risk rows
```

## 6. Sign it (publisher flow)

Signing operates on **JSON** manifests:

```sh
skillrouter keys --generate     # ECDSA P-256 keypair → <stateDir>/keys/public.pem + private.pem
skillrouter keys --show         # public key
# convert your YAML manifest to JSON, then:
skillrouter sign dist/hello-cli.json    # adds the "signature" block, writes back JSON
```

Verify the chain:

```sh
skillrouter signatures          # valid | unsigned | invalid per installed capability
skillrouter verify --full       # health check including signature verification
```

## Next steps

- Route a real task in your project to see project analysis (languages/frameworks/deps) and git signals shape the scores: [routing/how-routing-works.md](../routing/how-routing-works.md).
- Declare permissions carefully — they drive the risk score and consent: [security/permissions.md](../security/permissions.md).
- Tune `router.threshold`, `maxActivations`, `always/never/prefer/avoid` in `skillrouter.yaml`: [routing/configuration.md](../routing/configuration.md).