# Signing

Manifests can be signed with a local ECDSA P-256 keypair so installs can be verified later. The pipeline lives in `src/security/keys.ts` (keys), `src/security/sign.ts` (signing), and `src/security/verify.ts` (verification).

## Key management — `src/security/keys.ts`

```sh
skillrouter keys --generate   # writes public.pem + private.pem to <dataDir>/keys/
skillrouter keys --show       # prints the public key
```

- `generateKeyPair` uses `WebCrypto` (global `crypto.subtle`) with `{ name: "ECDSA", namedCurve: "P-256" }`, exporting a raw public key and PKCS#8 private key.
- The keys are written to `<dataDir>/keys/public.pem` and `<dataDir>/keys/private.pem`, where `dataDir` is the storage data directory — the state dir from configuration (`~/.local/state/skillrouter` by default, or `$XDG_STATE_HOME/skillrouter`; the DB lives next to it). PEM files use standard `-----BEGIN (PUBLIC|PRIVATE) KEY-----` armored base64 (wrapped at 64 chars).
- `keyPairExists` checks for `private.pem`; `publicKeyFrom` reads the public key for display. A shorter `fingerprint` is derived as the first 16 hex chars of the SHA-256 of the raw public key, formatted in 4-hex groups.

## Signing — `src/security/sign.ts`

```sh
skillrouter sign <manifest.json>
```

`signManifest` operates on **JSON manifests** (it `JSON.parse`s the file — an important constraint: it does not parse YAML; the loader accepts YAML, the signer does not):

1. Requires an existing keypair (returns `null` otherwise → CLI fails with "Ensure a keypair exists (skillrouter keys --generate)").
2. Reads and parses the manifest file, then computes the payload via `manifestHashPayload(manifest)`.
3. `manifestHashPayload` = `JSON.stringify(canonicalize(manifest))` where `canonicalize` recursively sorts object keys (**sorted-key canonicalization**), so equivalent manifests produce identical canonical JSON.
4. Signs the UTF-8 payload bytes with ECDSA P-256 + SHA-256 over the canonical JSON.
5. Adds a `signature` block to the manifest and writes the file back (pretty-printed JSON).

The hash payload feeds both the signature and the recorded `manifestHash`.

## The `SignatureBlock`

```json
{
  "signature": {
    "algorithm": "sr-v1-ecdsa-p256",
    "publicKey": "<PEM of the public key>",
    "fingerprint": "<sha256 of payload, first 8 hex>",
    "signature": "<base64 ECDSA signature>",
    "manifestHash": "<sha256(canonical JSON payload)>",
    "signedAt": "<ISO-8601 timestamp>"
  }
}
```

`verifyManifestSignature` forbids any other algorithm: `algorithm !== "sr-v1-ecdsa-p256"` → `reason: "mismatch"`. If there is no signature block → `reason: "unsigned"`. Otherwise it deletes the `signature` key from a copy, recomputes the canonical payload, imports the embedded public key (PEM or raw base64 accepted), and verifies with `verifySignature` (WebCrypto).

## Verifying — `src/security/verify.ts` and CLI

- `skillrouter signatures` — runs `verifyInstallChain` over all installed capabilities; each row reports `capability` + `status`:
  - `valid` — signature verified against the payload;
  - `unsigned` — no signature block (noted as "unsigned (no local keypair expected)" when a local key exists);
  - `invalid` — signature present but does not match ("signature mismatch").
  Exit code 1 if any row is `invalid`.
- `skillrouter verify --full` — the health check includes signature verification as one of its checks.
- Installation remains possible for unsigned manifests; signing is a publisher-stage feature (per ROW audit findings, high-risk unsigned capabilities are reported by `skillrouter scan registry`).

## Notes

- Keys, like the DB, are local to your machine's state directory — keep `private.pem` out of the repository (`.gitignore` already excludes `*.pem`).
- The signature covers only the manifest JSON, not the payload files; payload integrity is covered by hash checks elsewhere (manifest hash/install verification paths).
- Schema contract: `signature` is part of `schemas/skillrouter-v1.schema.json` (required fields: `algorithm`, `publicKey`, `fingerprint`, `signature`, `manifestHash`, `signedAt`).