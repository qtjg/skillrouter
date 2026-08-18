# Security Model

SkillRouter installs and activates third-party capabilities on behalf of AI agents — the security model assumes capabilities are untrusted until proven otherwise.

## Threat model

- **Supply chain** — a source (git repo, directory, catalog) ships a malicious or tampered capability. Mitigations: explicit source trust list, manifest signatures, install-time secret scan, risky permissions surfaced before activation.
- **Tampering** — a manifest or payload is modified after signing. Mitigations: signature verification (`skillrouter signatures`, `verify --full`) and hash checks.
- **Secrets** — hardcoded credentials inside capability payloads or project files. Mitigations: `skillrouter scan` with pattern-based secret detection.
- **Consent abuse** — a capability activating with overly broad permissions without the user noticing. Mitigations: permission declarations, risk scoring, `resolvePolicy` consent gating, per-capability permission overrides.
- **Unverified publishers** — capabilities claiming quality/trust they don't have. Mitigations: declared `trust` is only a hint; risk is always *computed from permissions* (D-008); quality/history metadata is treated as declared, not measured, in v0.1.

## Trust levels (`TrustLevel` in `src/core/types.ts`)

`verified` | `trusted` | `community` | `unknown` (default) | `blocked`

- Capabilities default to `unknown` — the scoring factor `trustUnknown` (-6) reflects that, and `blocked` (-100) removes a capability from routing.
- Trust per capability can be set explicitly in the trust store (`storage` trust rows); per-source trust is managed via the source trust list.

## Source trust list — `src/security/permissions.ts`

`trustedSources(storage)`, `addTrustedSource`, `removeTrustedSource`, `isSourceTrusted` persist a JSON list under the `sources.trusted` preference.

CLI: `skillrouter trust <source> --add | --remove | list` and `skillrouter trust-check <source>`. Registries and forges must be explicitly trusted before their sources are used.

## Signature chain — `keys.ts` → `sign.ts` → `verify.ts`

- `skillrouter keys --generate` creates an ECDSA P-256 keypair (`WebCrypto`, `subtle.generateKey`) written as `public.pem`/`private.pem` under `<stateDir>/keys/` (the storage `dataDir`). `keys --show` prints the public key. A fingerprint is derived from the SHA-256 of the public key.
- `skillrouter sign <manifest.json>` adds a `signature` block to a **JSON** manifest, signed over its canonicalized JSON (recursively sorted keys). See [signing.md](signing.md).
- `skillrouter signatures` verifies the signature chain of installed capabilities (`verifyInstallChain`); `skillrouter verify --full` runs verification as part of the health check. Verification results: `valid` / `unsigned` / `invalid` (mismatch).

## Secret scanning — `src/security/secrets.ts`

`scanTextForSecrets` runs per-line regex rules over file content (skipping commented lines): stripe secret `sk_live_…`/restricted `rk_live_…`, openai `sk-…`/`sk-proj-…`, github `gh[pousr]_…`, google `AIza…`, aws `AKIA…` + `aws_secret_access_key=…`, private key blocks (`BEGIN … PRIVATE KEY`), npm tokens (`npm_…`), JWTs (`eyJ…`), and a generic `api_key|secret|token|password=…` assignment rule. Files above the **2 MB cap** are skipped; `isSensitiveFile` flags `.env*`, `id_rsa`/`id_ed25519`, `credentials.json`, `service-account.json`, `.npmrc`; `shouldWarnOnFile` adds `*.pem|key|p12|pfx|keystore`.

`skillrouter scan` runs three scopes (`src/security/audit.ts` `runAudit`): `capability` (risk + payload secret walk), `project` (project-file secret walk, blocked-capability note), `registry` (blocked rows, unsigned high-risk capabilities). `--fix` removes only safe reversible findings.

## Audit trail — `src/security/audit.ts`

Every lifecycle action is recorded: `init`, `doctor`, `install`, `uninstall`, `update`, `enable`, `disable`, `activate`, `deactivate`, `force-enable`, `force-disable`, `route`, `trust.set`, `trust.remove`, `source.add`, `source.remove`, `config.set`, `config.unset`, `block`, `unblock`, `verify`, `scan` — each row: actor, action, capability, detail, timestamp. Reviewed with `skillrouter audit`. `severityOf` marks install/uninstall/force/router actions `warn`.

## Risk engine — `src/security/risk.ts`

`computeRisk(capability)` derives a 0–100 score and `low|medium|high|critical` level from declared permissions (points table and floor in [scoring.md](../routing/scoring.md)). It feeds routing penalties and consent gating. The declared `risk.level` acts only as a floor (`RISK_FLOOR`: low 0 / medium 30 / high 55 / critical 80), never as a ceiling.

## Policy resolution — `src/security/policy.ts`

`resolvePolicy(request, ctx)` decides `allow | ask | deny` per permission request (kind, target, capability, risk level):

1. Capability in `security.blocked` → `deny`.
2. Matching `deny` rule → `deny`; matching `allow` rule → `allow` (rules support `*`, `*.domain` suffix wildcards, and path suffixes).
3. `credentials` → always `ask`.
4. `shell`/`processes` → `allow` only for low/medium risk, else `ask`.
5. `network` with target `*` → `ask` (never silently allowed).
6. `high`/`critical` risk → `ask` when `security.requireConsent` (default true), else `allow`.
7. Otherwise the rule's `default` action (if any), else `allow`.

The runtime (`src/runtime/runtime.ts`) builds permission requests for filesystem.write, network `*`, shell, credentials, and processes, and requires interactive consent for any `ask` result — `--yes` never overrides a `deny`, and in v0.1 `--json` mode has no consent path.

## Status notes (v0.1.0)

Manifest signing exists and works for JSON manifests (`keys`/`sign`/`signatures`); the IMPLEMENTATION.md tracker still lists fuller verification (ed25519 manifests) as future work. The LLM reranker transport is not wired; the test suite is being built out (`npm test`).