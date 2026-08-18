# SkillRouter Documentation

Documentation for SkillRouter v0.1.0 (pre-release). The CLI, routing engine, and security tooling are functional and typecheck-clean; the automated test suite is being built out (`npm test`), and the LLM reranker transport is intentionally not wired (returns `null`).

## Root documents

- [DECISIONS.md](../DECISIONS.md) — architectural decision log (D-001..D-016), each entry recording decision, context, options, chosen approach, reason, and consequences.
- [IMPLEMENTATION.md](../IMPLEMENTATION.md) — live implementation tracker with per-phase status.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — setup, conventions (Conventional Commits), and submission checklist.
- [SECURITY.md](../SECURITY.md) — security policy and vulnerability reporting.
- [README.md](../README.md) — project overview and quick start.
- [schemas/skillrouter-v1.schema.json](../schemas/skillrouter-v1.schema.json) — machine-readable contract for manifests.

## Architecture

- [architecture/overview.md](architecture/overview.md) — system layers, `src/` domain layout, request data flow, storage, and configuration.
- [architecture/router.md](architecture/router.md) — the routing pipeline: analysis, scoring, conflict/dependency resolution, planning, semantic levels, explainability.
- [architecture/adapters.md](architecture/adapters.md) — the `AgentAdapter` interface, `AdapterRegistry`, built-in adapters, and the portable `.agents/skills` standard.

## Routing

- [routing/how-routing-works.md](routing/how-routing-works.md) — end-to-end walkthrough from `skillrouter route "…"` to an applied plan.
- [routing/scoring.md](routing/scoring.md) — factor weights, penalties, and the risk floor.
- [routing/configuration.md](routing/configuration.md) — full reference of `skillrouter.yaml` keys and locations.

## Security

- [security/security-model.md](security/security-model.md) — threat model, trust, signatures, secret scanning, audit trail, risk engine, policy resolution.
- [security/permissions.md](security/permissions.md) — the `PermissionSet` reference and risk-point mapping.
- [security/signing.md](security/signing.md) — key management, signing, verification, and the signature block.

## Manifests and adapters

- [manifests/manifest-reference.md](manifests/manifest-reference.md) — full field reference for `skillrouter/v1` manifests.
- [adapters/creating-an-adapter.md](adapters/creating-an-adapter.md) — how to implement and register a new `AgentAdapter`.

## Guides

- [guides/first-capability.md](guides/first-capability.md) — end-to-end tutorial: write, install, route, explain, scan, and sign your first capability.