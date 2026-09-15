import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AdapterRegistry, getAdapterRegistry, resetAdapterRegistry } from "../../src/adapters/registry.ts";
import { McpAdapter } from "../../src/adapters/mcp.ts";
import { AdapterError } from "../../src/utils/errors.ts";
import type { AgentAdapter } from "../../src/adapters/types.ts";
import type { DetectionContext } from "../../src/adapters/env.ts";
import type { Capability, AgentId } from "../../src/core/types.ts";

function fakeAdapter(id: AgentId): AgentAdapter {
  const noop = async () => ({ agent: id, capabilityId: "x", ok: true, action: "noop" });
  return {
    id,
    detect: async () => ({ id, name: id, detected: false, binaryPath: null, version: null, notes: [] }),
    discoverInstalled: async () => [],
    install: noop,
    uninstall: noop,
    enable: noop,
    disable: noop,
    activate: noop,
    deactivate: noop,
  };
}

function mcpCapability(id: string, withServer: boolean, type = "mcp-server"): Capability {
  const cap = {
    id,
    name: id,
    description: id,
    version: "1.0.0",
    type,
    permissions: {},
  } as unknown as Capability;
  if (withServer) (cap as unknown as Record<string, unknown>)["mcp"] = { command: "uvx", args: ["demo-server"] };
  return cap;
}

async function tmpCtx(): Promise<DetectionContext> {
  return { cwd: await mkdtemp(join(tmpdir(), "skillrouter-adapters-")), binaryPaths: new Map() };
}

test("adapter registry round-trips register/get/has/ids/all", () => {
  const registry = new AdapterRegistry();
  registry.register(fakeAdapter("opencode"));
  registry.register(fakeAdapter("gemini"));
  assert.equal(registry.has("opencode"), true);
  assert.equal(registry.has("claude"), false);
  assert.deepEqual(registry.ids().sort(), ["gemini", "opencode"]);
  assert.equal(registry.all().length, 2);
  assert.equal(registry.get("opencode").id, "opencode");
});

test("adapter registry throws AdapterError for an unknown agent id", () => {
  const registry = new AdapterRegistry();
  assert.throws(() => registry.get("codex" as AgentId), AdapterError);
});

test("getAdapterRegistry resolves all built-in adapters and resets cleanly", async () => {
  resetAdapterRegistry();
  const registry = await getAdapterRegistry(await tmpCtx());
  assert.deepEqual(registry.ids().sort(), [
    "aider", "claude", "cline", "codex", "copilot", "cursor", "gemini", "generic", "mcp", "opencode", "windsurf",
  ]);
  resetAdapterRegistry();
});

test("mcp adapter detect reports undetected without config and detected with project .mcp.json", async () => {
  const ctx = await tmpCtx();
  const adapter = new McpAdapter(ctx);
  const before = await adapter.detect();
  assert.equal(before.detected, false);

  await writeFile(join(ctx.cwd, ".mcp.json"), JSON.stringify({ mcpServers: {} }), "utf8");
  const after = await adapter.detect();
  assert.equal(after.detected, true);
  assert.ok(after.notes.some((n) => n.includes(".mcp.json")));
});

test("mcp adapter install skips non-mcp capabilities and rejects mcp entries without a server", async () => {
  const ctx = await tmpCtx();
  const adapter = new McpAdapter(ctx);

  const plain = { id: "cap:plain", name: "plain", version: "1.0.0", type: "skill" } as unknown as Capability;
  const skipped = await adapter.install(plain, ctx.cwd);
  assert.equal(skipped.ok, true);
  assert.ok((skipped.detail ?? "").includes("skipped"));

  // MCP by id ("mcp") but typed "skill" with no server section -> rejected
  const noServer = mcpCapability("mcp", false, "skill");
  const rejected = await adapter.install(noServer, ctx.cwd);
  assert.equal(rejected.ok, false);
  assert.ok((rejected.detail ?? "").includes("mcp server entry"));
});

test("mcp adapter install writes .mcp.json, discovery lists it, disable toggles, uninstall removes", async () => {
  const ctx = await tmpCtx();
  const adapter = new McpAdapter(ctx);
  // Pre-create the project config so the adapter targets the project file
  // instead of falling back to the user-global ~/.config/mcp.json.
  const configPath = join(ctx.cwd, ".mcp.json");
  await writeFile(configPath, JSON.stringify({ mcpServers: {} }), "utf8");
  const capability = mcpCapability("cap:demo-server", true);

  const result = await adapter.install(capability, ctx.cwd);
  assert.equal(result.ok, true);

  const written = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(written.mcpServers["cap:demo-server"].command, "uvx");

  const discovered = await adapter.discoverInstalled();
  assert.ok(discovered.some((c) => c.capabilityId === "cap:demo-server" && c.state === "installed"));

  const disabled = await adapter.disable("cap:demo-server", null);
  assert.equal(disabled.ok, true);
  const afterDisable = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(afterDisable.mcpServers["cap:demo-server"].disabled, true);

  const removed = await adapter.uninstall("cap:demo-server", null);
  assert.equal(removed.ok, true);
  const afterRemove = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(afterRemove.mcpServers["cap:demo-server"], undefined);
});
