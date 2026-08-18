# SkillRouter

The universal capability router for AI agents: discover, install, enable, activate, and manage skills, plugins, tools, and MCP capabilities across agent setups.

> **Status: early development (v0.1.0).** The CLI, routing engine, and security tooling are functional and typecheck-clean; the automated test suite and the full manifest schema are still being completed. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the live tracker.

## What it does

- **Universal capability model** — one canonical `Capability` model (manifest schema `skillrouter/v1`); agent-specific details stay in adapters.
- **Multi-agent adapters** — `opencode`, `gemini`, `claude`, `codex`, `aider`, `mcp`, and `generic` with detection, install, and lifecycle integration.
- **Deterministic routing** — routes tasks to the right capability by default (Level 1); semantic (Level 2) and LLM (Level 3) layers are pluggable interfaces and degrade gracefully when unconfigured. Routing never requires an LLM.
- **Lifecycle management** — `discovered → installed → available → enabled → active` state machine with explicit transitions, forcing, and audit-able actions.
- **Security built in** — manifest signature verification (ECDSA P-256 keys), source trust list, permission overrides, hardcoded-secret scanning, and a tamper-evident audit trail.
- **Local-first storage** — `node:sqlite` behind a replaceable storage interface; per-project lockfile (`skillrouter.lock`) and YAML config (`skillrouter.yaml`).
- **Verification & reporting** — `verify` health checks, `self-test` diagnostics, and a static HTML decision dashboard export.

## Requirements

- **Node.js >= 22.5** (uses `node:sqlite`, built-in test runner, and native TypeScript execution)
- Recommended: Node 24 or Node >= 22.18 (stable type stripping). On older 22.x, run dev commands with `--experimental-transform-types`.

## Install from source

```sh
npm install
npm run typecheck            # strict TS check, must pass
node --experimental-transform-types src/cli/index.ts doctor   # sanity check
```

## Usage

```sh
# bootstrap
skillrouter init             # create project config
skillrouter doctor           # check environment + project health
skillrouter status           # system + project status

# capabilities
skillrouter search <query>   # search the capability catalog
skillrouter install <cap>    # install a capability
skillrouter uninstall <cap>
skillrouter source add <url> --type git

# state
skillrouter enable <cap>     # state chain: installed → available → enabled
skillrouter activate <cap>
skillrouter active

# routing
skillrouter route "write unit tests for the CLI"
skillrouter explain

# security
skillrouter scan [capability|project]
skillrouter audit
skillrouter keys --generate
skillrouter signatures
skillrouter permissions <cap>
skillrouter trust <source> --add

# misc
skillrouter verify --full
skillrouter logs
skillrouter export            # static HTML dashboard
skillrouter self-test
```

Run `skillrouter --help` for the full command list.

## How it works

`src/` is divided by domain — `cli`, `core`, `manifest`, `router`, `registry`, `security`, `runtime`, `adapters`, `storage`, `config`, `logging`, `project`, `git`, `utils`. A routing request goes: task → project analysis → git context → router decision (planner + risk computation) → runtime execution (consent gating + lifecycle transitions) → audit + history.

Design rationale and trade-offs: [DECISIONS.md](DECISIONS.md). Implementation progress: [IMPLEMENTATION.md](IMPLEMENTATION.md).

## License

[MIT License](LICENSE) — Copyright (c) 2026 Mayank Bhaskar