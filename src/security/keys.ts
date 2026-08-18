import { join } from "node:path";
import { ensureDir, pathExists } from "../utils/fs.ts";
import type { Storage } from "../storage/types.ts";
import { sha256 } from "../utils/hash.ts";

const KEY_DIR = "keys";

function keyDirOf(storage: Storage): string {
  return join(storage.dataDir, KEY_DIR);
}

export async function generateKeyPair(storage: Storage): Promise<{ publicKey: string; fingerprint: string }> {
  const dir = keyDirOf(storage);
  await ensureDir(dir);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is not available in this runtime");
  const keyPair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const rawPublic = await subtle.exportKey("raw", keyPair.publicKey);
  const rawPrivate = await subtle.exportKey("pkcs8", keyPair.privateKey);
  const publicKey = toBase64(new Uint8Array(rawPublic));
  const privateKey = toBase64(new Uint8Array(rawPrivate));

  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "public.pem"), `-----BEGIN PUBLIC KEY-----\n${wrapBase64(publicKey)}\n-----END PUBLIC KEY-----\n`, "utf8");
  await writeFile(join(dir, "private.pem"), `-----BEGIN PRIVATE KEY-----\n${wrapBase64(privateKey)}\n-----END PRIVATE KEY-----\n`, "utf8");

  const fingerprint = sha256(publicKey).slice(0, 16).match(/.{1,4}/g)?.join(":") ?? sha256(publicKey).slice(0, 16);
  return { publicKey, fingerprint };
}

export async function publicKeyFrom(storage: Storage): Promise<string | null> {
  const { readFile } = await import("node:fs/promises");
  try {
    const content = await readFile(join(keyDirOf(storage), "public.pem"), "utf8");
    return content.trim();
  } catch {
    return null;
  }
}

export async function keyPairExists(storage: Storage): Promise<boolean> {
  return await pathExists(join(keyDirOf(storage), "private.pem"));
}

/** Verify a Tink-style raw signature over JSON payload using WebCrypto ECDSA. */
export async function verifySignature(publicKeyBase64: string, payload: string, signatureBase64: string): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return false;
  try {
    const raw = fromBase64(publicKeyBase64);
    const key = await subtle.importKey(
      "raw",
      raw as unknown as Uint8Array,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const data = new TextEncoder().encode(payload);
    return await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromBase64(signatureBase64) as unknown as Uint8Array, data);
  } catch {
    return false;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function wrapBase64(value: string): string {
  return value.match(/.{1,64}/g)?.join("\n") ?? value;
}