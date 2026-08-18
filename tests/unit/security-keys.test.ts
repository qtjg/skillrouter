import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorage } from "../../src/storage/sqlite.ts";
import { generateKeyPair, keyPairExists, publicKeyFrom, verifySignature } from "../../src/security/keys.ts";
import { signManifest, verifyManifestSignature, manifestHashPayload } from "../../src/security/sign.ts";
import { verifyInstallChain } from "../../src/security/verify.ts";
import type { Capability } from "../../src/core/types.ts";

function tickCapability(id: string): Capability {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: "test",
    type: "skill",
    schema: "skillrouter/v1",
    manifestPath: "manifest.yaml",
    trust: "unknown",
    compatibility: { opencode: "native" },
    permissions: { filesystem: { read: false, write: false }, network: { allowed: [] }, shell: { enabled: false } },
  };
}

test("generateKeyPair writes PEM keys and verifies signatures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-keys-"));
  const storage = new SqliteStorage(join(dir, "state", "sr.db"));
  try {
    assert.equal(await keyPairExists(storage), false);
    const { fingerprint } = await generateKeyPair(storage);
    assert.equal(fingerprint.length >= 19, true);
    assert.equal(await keyPairExists(storage), true);
    const pub = await publicKeyFrom(storage);
    assert.ok(pub);
    assert.ok(pub.includes("-----BEGIN PUBLIC KEY-----"));

    const subtle = globalThis.crypto.subtle;
    const keyPair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const rawPublic = new Uint8Array(await subtle.exportKey("raw", keyPair.publicKey));
    const publicKeyBase64 = Buffer.from(rawPublic).toString("base64");
    const payload = "the quick brown fox";
    const signature = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, Buffer.from(payload)));
    const signatureBase64 = Buffer.from(signature).toString("base64");

    assert.equal(await verifySignature(publicKeyBase64, payload, signatureBase64), true);
    assert.equal(await verifySignature(publicKeyBase64, payload, "AAAA"), false);
    assert.equal(await verifySignature(publicKeyBase64, "different payload", signatureBase64), false);
    assert.equal(await verifySignature("not-base64!!", payload, signatureBase64), false);
  } finally {
    storage.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("signManifest signs a manifest in place and verify accepts it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-sign-"));
  const storage = new SqliteStorage(join(dir, "state", "sr.db"));
  try {
    await generateKeyPair(storage);
    const manifestPath = join(dir, "cap.json");
    const manifest = { schema: "skillrouter/v1", id: "signed-cap", name: "Signed", version: "1.0.0", description: "x", type: "skill" };
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    const result = await signManifest(manifestPath, storage);
    assert.ok(result);
    const signed = JSON.parse(await (await import("node:fs/promises")).readFile(manifestPath, "utf8")) as Record<string, unknown>;
    assert.ok(signed["signature"]);

    const verified = await verifyManifestSignature(signed);
    assert.equal(verified.valid, true);
    assert.equal(verified.fingerprint, result.publicKeyFingerprint);

    const tampered = { ...signed, description: "tampered" } as Record<string, unknown>;
    const tamperCheck = await verifyManifestSignature(tampered);
    assert.equal(tamperCheck.valid, false);
    assert.equal(tamperCheck.reason, "mismatch");

    const unsigned = { ...signed } as Record<string, unknown>;
    delete unsigned["signature"];
    const unsignedCheck = await verifyManifestSignature(unsigned);
    assert.equal(unsignedCheck.valid, false);
    assert.equal(unsignedCheck.reason, "unsigned");
  } finally {
    storage.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("manifestHashPayload is canonical and stable", () => {
  const a = manifestHashPayload({ b: 2, a: [3, 1], c: { y: 1, x: 2 } });
  const b = manifestHashPayload({ c: { x: 2, y: 1 }, b: 2, a: [3, 1] });
  assert.equal(a, b);
});

test("signManifest returns null when no keypair exists", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-nokeys-"));
  const storage = new SqliteStorage(join(dir, "state", "sr.db"));
  try {
    await storage.init();
    const manifestPath = join(dir, "cap.json");
    await writeFile(manifestPath, JSON.stringify({ id: "x" }), "utf8");
    assert.equal(await signManifest(manifestPath, storage), null);
  } finally {
    storage.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("verifyInstallChain reports valid, unsigned, and not-installed states", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-chain-"));
  const storage = new SqliteStorage(join(dir, "state", "sr.db"));
  try {
    await storage.init();
    const cap = tickCapability("chain-cap");
    await storage.upsertCapability(cap);

    const noKey = await verifyInstallChain(storage, ["chain-cap"]);
    assert.deepEqual(noKey[0], { capabilityId: "chain-cap", status: "unsigned", reason: "unsigned (no local keypair expected)" });

    await generateKeyPair(storage);
    const manifestPath = join(dir, "chain-cap.json");
    await writeFile(manifestPath, JSON.stringify(cap), "utf8");
    await signManifest(manifestPath, storage);
    const signed = JSON.parse(await (await import("node:fs/promises")).readFile(manifestPath, "utf8")) as Capability;
    await storage.upsertCapability(signed);
    await storage.setInstalledState("chain-cap", "ENABLED", { id: "chain-cap", version: "1.0.0", installRoot: dir, agents: [] });

    const results = await verifyInstallChain(storage, ["chain-cap"]);
    assert.equal(results[0]?.status, "valid");

    const notInstalled = await verifyInstallChain(storage, ["ghost-cap"]);
    assert.equal(notInstalled[0]?.status, "unsigned");
    assert.equal(notInstalled[0]?.reason, "not installed");
  } finally {
    storage.close();
    await rm(dir, { recursive: true, force: true });
  }
});