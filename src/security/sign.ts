import { join, dirname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { Storage } from "../storage/types.ts";
import { sha256 } from "../utils/hash.ts";
import { keyPairExists, verifySignature } from "./keys.ts";
import { SecurityError } from "../utils/errors.ts";

export interface SignatureBlock {
  algorithm: "sr-v1-ecdsa-p256";
  publicKey: string;
  fingerprint: string;
  signature: string;
  manifestHash: string;
  signedAt: string;
}

/** Computes the canonical hash of a manifest's canonical JSON. */
export function manifestHashPayload(capability: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(capability));
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return out;
}

/**
 * Signs a manifest file in place (adds a `signature` block). Requires a
 * keypair to have been generated via `skillrouter keys --generate`.
 */
export async function signManifest(manifestPath: string, storage: Storage): Promise<{ publicKeyFingerprint: string } | null> {
  const hasKeys = await keyPairExists(storage);
  if (!hasKeys) return null;
  const { readFile: readKeys } = await import("node:fs/promises");
  const privatePem = await readKeys(join(storage.dataDir, "keys", "private.pem"), "utf8");
  const publicPem = await readKeys(join(storage.dataDir, "keys", "public.pem"), "utf8");

  const content = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(content) as Record<string, unknown>;
  const payload = manifestHashPayload(manifest);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const key = await subtle.importKey(
    "pkcs8",
    pemToBytes(privatePem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(payload));
  const block: SignatureBlock = {
    algorithm: "sr-v1-ecdsa-p256",
    publicKey: pemToBytes(publicPem).size === 0 ? "" : publicPem,
    fingerprint: sha256(payload).slice(0, 8),
    signature: bytesToBase64(new Uint8Array(signature)),
    manifestHash: sha256(payload),
    signedAt: new Date().toISOString(),
  };
  manifest["signature"] = block;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { publicKeyFingerprint: block.fingerprint };
}

/** Verify `verify.ts` import to avoid node:buffer at module scope for bun compat. */
export async function verifyManifestSignature(manifest: Record<string, unknown>): Promise<{ valid: boolean; reason?: "unsigned" | "mismatch"; fingerprint?: string }> {
  const block = manifest["signature"] as SignatureBlock | undefined;
  if (!block) return { valid: false, reason: "unsigned" };
  if (block.algorithm !== "sr-v1-ecdsa-p256") return { valid: false, reason: "mismatch" };
  const withoutSignature = { ...manifest };
  delete withoutSignature["signature"];
  const payload = manifestHashPayload(withoutSignature);
  const ok = await verifySignature(extractBase64(block.publicKey), payload, block.signature);
  return ok ? { valid: true, fingerprint: block.fingerprint } : { valid: false, reason: "mismatch" };
}

function pemToBytes(pem: string): ArrayBuffer & { size: number } {
  const base64 = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes as unknown as ArrayBuffer & { size: number };
}

function extractBase64(pemOrBase64: string): string {
  if (pemOrBase64.includes("BEGIN")) {
    return pemOrBase64.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  }
  return pemOrBase64;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function isSecurityError(err: unknown): err is SecurityError {
  return err instanceof SecurityError;
}