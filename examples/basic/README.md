# SkillRouter quick start

This guide walks a beginner through their first SkillRouter project: create a
config, install a capability, and route a task to it. Everything below runs
from the repository root of an existing project (for example, SkillRouter
itself).

## 0. Prerequisites

- Node.js 22.x
- The `skillrouter` CLI, run as `node bin/skillrouter.js` from the repo root,
  or installed globally via `npm link` so `skillrouter` is on your PATH.
- If you want git-enabled discovery, `git` installed and your project
  initialized as a repository.

## 1. Create the project config

Copy `examples/basic/skillrouter.yaml` into your project root:

```sh
cp examples/basic/skillrouter.yaml ./skillrouter.yaml
```

Open it and read the comments: each section maps to a part of the default
config (`src/config/config.ts`). The defaults are sensible for a first run,
so you can leave everything as-is. Once a `skillrouter.yaml` exists,
SkillRouter recognizes your project.

## 2. Check your environment

```sh
skillrouter doctor
```

`doctor` validates Node, storage, config, and the router scripts. Fix
anything it flags before continuing.

## 3. See where you stand

```sh
skillrouter status
```

`status` shows detected agents, installed capabilities, and the current
router state. Expect mostly empty lists on a fresh install.

## 4. Find capabilities

```sh
skillrouter search stripe
skillrouter search "security audit" --limit 5
```

`search` ranks capabilities already known to the registry. If nothing is
found yet, you first need a source of manifests.

## 5. Add a source

Sources tell SkillRouter where capability manifests live. Git sources are
cloned and indexed; directory sources are walked on disk.

```sh
skillrouter source add my-skills /path/to/my/skills
skillrouter source add community-skills https://github.com/example/community-skills
skillrouter source list
```

You can also hand-edit the `sources` list in `skillrouter.yaml` (see the
commented examples there). Note that `source add` writes to your project
config automatically.

## 6. Install a capability

This repository ships example capability manifests in `examples/manifests/`.
Install one from disk:

```sh
skillrouter install ./examples/manifests/stripe.yaml
skillrouter install ./examples/manifests/security-auditor.yaml
skillrouter install ./examples/mcp/example.yaml
```

`install` resolves the manifest, runs a security audit, asks for consent
(`security.requireConsent` is on by default), and writes the capability to
storage plus any adapter state (for example, MCP servers). `--dry-run`
shows what would happen without changing anything.

## 7. Enable

Installed capabilities must be enabled before the router may select them:

```sh
skillrouter enable stripe-billing-expert
```

## 8. Activate

Activation exposes the capability to your connected agents:

```sh
skillrouter activate stripe-billing-expert
```

Activation requires the agent to exist in your config, otherwise the
capability is marked active locally only. Run `skillrouter status` to check.

## 9. Route a task

Routing is the core of SkillRouter: it scores the enabled capabilities
against your task and decides what to activate and deactivate.

```sh
skillrouter route "set up subscription billing with Stripe"
skillrouter route "scan dependencies for known CVEs"
```

The decision lists activations with their scores and confidence, plus
deactivations for capabilities that are no longer relevant. With
`router.mode` set to `assisted`, actions are proposed for approval.

## 10. Explain a decision

```sh
skillrouter explain "set up subscription billing with Stripe"
```

`explain` prints why each capability would be active for the task - the
signals, keywords, and technologies that matched.

## 11. Scan for issues

```sh
skillrouter scan            # scan the current project
skillrouter scan project --fix   # project scan, applying safe fixes
```

`scan` runs the security audit across your project, installed capabilities,
and registry sources.

## 12. Review the audit trail and logs

```sh
skillrouter audit                 # security audit trail
skillrouter logs -n 100           # recent logs
skillrouter logs --follow         # stream new log lines
```

## 13. Verify your installation

```sh
skillrouter verify
skillrouter verify --full
```

`verify` checks installation integrity, config health, and environment
connectivity.

## 14. Export a dashboard

```sh
skillrouter export
skillrouter export --out docs/decisions.html
```

`export` writes a static HTML dashboard of your routing history.

## Next steps

- The example manifests in `examples/manifests/` show realistic manifests
  you can adapt (`examples/mcp/example.yaml` is an MCP server example).
- The full capability-authoring tutorial lives in
  `docs/guides/first-capability.md`.
- To wire capabilities into an MCP client, see the MCP example in
  `examples/mcp/README.md`.
- For the programmatic API (routing without the CLI), see
  `examples/routing/README.md`.