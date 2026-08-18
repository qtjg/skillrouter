# Security Policy

## Security model

SkillRouter is a local-first CLI that installs and activates third-party capabilities (skills, plugins, tools, MCP servers) on behalf of AI agents. Its security surface is:

- **Manifest signatures** — capability manifests can be signed with ECDSA P-256 keypairs (`skillrouter keys --generate`, `skillrouter sign`). Installation chains are verified with `skillrouter signatures` / `skillrouter verify --full`.
- **Source trust** — registries and forges must be explicitly trusted (`skillrouter trust <source> --add`) before their capability sources can be used.
- **Permission overrides** — per-capability permission reviews and overrides (`skillrouter permissions`) constrain what an installed capability may access (filesystem, network, shell, processes, credentials, MCP servers).
- **Secret scanning** — `skillrouter scan` detects hardcoded secrets (API keys, tokens, private keys) in capability installs and project files using a 64 KB chunked reader; never read more of a file than needed.
- **Audit trail** — all lifecycle actions (install, enable, activate, route, scan findings, fixes) are recorded with actor, action, capability, and timestamp, and can be reviewed with `skillrouter audit`.
- **Consent gating** — runtime execution requests explicit consent for high-risk actions before activating capabilities (assisted/automatic modes).
- **Log redaction** — structured logs redact credentials before writing.

## Supported versions

Security fixes are applied to the current development line on `main`. There are no formal releases yet (v0.1.0, pre-release).

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Instead:

1. Report via [GitHub Security Advisories](https://github.com/qtjg/skillrouter/security/advisories/new) ("Report a vulnerability"), or
2. Open a private issue if the advisory form is unavailable.

Include, where possible: the affected command/flag, a minimal reproduction, the version or commit, and the impact. You will receive an acknowledgment within 7 days.