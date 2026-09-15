import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, copyFile, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCapabilityRef } from "../../src/registry/indexer.ts";
import { DEFAULT_CONFIG } from "../../src/config/config.ts";

test("resolveCapabilityRef resolves a direct manifest file path (not just directories)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skillrouter-fileref-"));
  // Arbitrary manifest filename: discovery-by-directory-name cannot see this,
  // so resolution must load the file itself.
  const manifest = join(dir, "security-auditor.yaml");
  await copyFile(join(import.meta.dirname, "../../examples/manifests/security-auditor.yaml"), manifest);

  const resolved = await resolveCapabilityRef(manifest, dir, DEFAULT_CONFIG.sources);
  assert.ok(resolved, "expected the manifest file to resolve");
  assert.equal(resolved!.capability.id, "dependency-vulnerability-scanner");
  assert.equal(resolved!.capability.source?.type, "local");
  assert.ok(resolved!.capability.source?.hash);
  // Provenance points at the manifest's own directory; sourceDir is the
  // canonical-name staging dir the installer verifies against.
  assert.equal(resolved!.capability.source?.location, dir);
  assert.notEqual(resolved!.sourceDir, dir);
  const stagedManifest = await readFile(join(resolved!.sourceDir, "skillrouter.yaml"), "utf8");
  assert.ok(stagedManifest.includes("dependency-vulnerability-scanner"));
});

test("resolveCapabilityRef still returns null for a missing path", async () => {
  const resolved = await resolveCapabilityRef("/nonexistent/cap.yaml", tmpdir(), DEFAULT_CONFIG.sources);
  assert.equal(resolved, null);
});

test("resolveCapabilityRef throws a useful error for a path that is not a capability manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "skillrouter-fileref-"));
  const notManifest = join(dir, "not-a-manifest.yaml");
  await writeFile(notManifest, "just: some random yaml\n", "utf8");
  await assert.rejects(() => resolveCapabilityRef(notManifest, dir, DEFAULT_CONFIG.sources));
});
