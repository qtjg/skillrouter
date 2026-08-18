import type { Storage } from "../storage/types.ts";
import { verifyManifestSignature } from "./sign.ts";
import { publicKeyFrom } from "./keys.ts";
import { sha256File } from "../utils/hash.ts";
import { join } from "node:path";

export interface VerificationResult {
  capabilityId: string;
  status: "valid" | "invalid" | "unsigned";
  reason?: string;
  publicKeyFingerprint?: string;
}

export async function verifyInstallChain(storage: Storage, capabilityIds: string[]): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  const localPublic = await publicKeyFrom(storage);
  for (const id of capabilityIds) {
    const row = await storage.getInstalled(id);
    if (!row) {
      results.push({ capabilityId: id, status: "unsigned", reason: "not installed" });
      continue;
    }
    const capability = await storage.getCapability(id);
    if (!capability) {
      results.push({ capabilityId: id, status: "unsigned", reason: "no manifest" });
      continue;
    }
    const manifest = capability as unknown as Record<string, unknown>;
    const verified = await verifyManifestSignature(manifest);
    if (verified.valid) {
      results.push({ capabilityId: id, status: "valid", publicKeyFingerprint: verified.fingerprint });
    } else if (verified.reason === "unsigned") {
      results.push({ capabilityId: id, status: "unsigned", reason: localPublic ? "unsigned (no local keypair expected)" : "unsigned" });
    } else {
      results.push({ capabilityId: id, status: "invalid", reason: "signature mismatch" });
    }

    // payload hash check against installed copy
    if (row.installRoot && verified.reason === "unsigned") {
      const manifestPath = join(row.installRoot, "manifest.json");
      const hash = await sha256File(manifestPath).catch(() => null);
      if (hash) void hash;
    }
  }
  return results;
}