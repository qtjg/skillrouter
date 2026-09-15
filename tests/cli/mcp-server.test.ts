import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_TS = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));

interface Rpc {
  id: number;
  write: (obj: unknown) => void;
  stdout: string;
  child: ReturnType<typeof spawn>;
  pending: Map<number, (value: unknown) => void>;
  done: Promise<void>;
}

async function startServer(cwd: string): Promise<Rpc> {
  const stateDir = await mkdtemp(join(tmpdir(), "skillrouter-mcp-state-"));
  const configDir = await mkdtemp(join(tmpdir(), "skillrouter-mcp-config-"));
  const child = spawn(process.execPath, ["--experimental-transform-types", CLI_TS, "serve-mcp"], {
    cwd,
    env: {
      ...process.env,
      XDG_STATE_HOME: stateDir,
      XDG_CONFIG_HOME: configDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rpc: Rpc = {
    id: 0,
    write: (obj: unknown) => child.stdin.write(JSON.stringify(obj) + "\n"),
    stdout: "",
    child,
    pending: new Map(),
    done: new Promise((resolve) => child.on("close", resolve)),
  };
  let buffer = "";
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const id = parsed["id"];
      const resolve = rpc.pending.get(id as number);
      if (resolve) {
        rpc.pending.delete(id as number);
        resolve(parsed);
      }
    }
  });
  child.stderr.on("data", () => {});
  return rpc;
}

function request(rpc: Rpc, method: string, params?: unknown): Promise<Record<string, unknown>> {
  const id = ++rpc.id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      rpc.pending.delete(id);
      reject(new Error(`no response for ${method} within 15s`));
    }, 15000);
    rpc.pending.set(id, (value) => {
      clearTimeout(timer);
      resolve(value as Record<string, unknown>);
    });
    rpc.write({ jsonrpc: "2.0", id, method, params: params ?? {} });
  });
}

test("serve-mcp: initialize → tools/list → tools/call round-trip", { timeout: 30000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "skillrouter-mcp-cwd-"));
  const rpc = await startServer(cwd);
  try {
    // small settle window for module load; the server answers whenever ready
    const init = await request(rpc, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "skillrouter-test", version: "0.0.0" },
    });
    const result = init["result"] as Record<string, unknown>;
    assert.equal(init["jsonrpc"], "2.0");
    assert.equal((result["serverInfo"] as Record<string, unknown>)["name"], "skillrouter");
    assert.ok(result["protocolVersion"]);

    rpc.write({ jsonrpc: "2.0", method: "notifications/initialized" });

    const listed = await request(rpc, "tools/list");
    const tools = (listed["result"] as Record<string, unknown>)["tools"] as Array<Record<string, unknown>>;
    const names = tools.map((t) => t["name"]).sort();
    assert.deepEqual(names, ["route_task", "router_stats", "search_capabilities"]);

    const search = await request(rpc, "tools/call", {
      name: "search_capabilities",
      arguments: { query: "testing" },
    });
    const searchContent = ((search["result"] as Record<string, unknown>)["content"] as Array<Record<string, unknown>>)[0];
    assert.ok(searchContent, "search result content present");
    const searchPayload = JSON.parse(searchContent["text"] as string);
    assert.ok(Array.isArray(searchPayload));

    const route = await request(rpc, "tools/call", {
      name: "route_task",
      arguments: { task: "scan dependencies for vulnerabilities" },
    });
    const routeContent = ((route["result"] as Record<string, unknown>)["content"] as Array<Record<string, unknown>>)[0];
    assert.ok(routeContent, "route result content present");
    const decision = JSON.parse(routeContent["text"] as string) as Record<string, unknown>;
    assert.ok(typeof decision["decisionId"] === "string");
    assert.ok(typeof decision["classification"] === "string");
    assert.ok(Array.isArray(decision["activate"]));

    const unknown = await request(rpc, "tools/call", { name: "nope", arguments: {} });
    const err = unknown["error"] as Record<string, unknown> | undefined;
    assert.ok(err && typeof err["message"] === "string" && err["message"].includes("Unknown tool"));

    assert.ok(rpc.child.stdin, "child stdin available");
    rpc.child.stdin.end();
  } finally {
    await Promise.race([rpc.done, new Promise((r) => setTimeout(r, 8000))]);
  }
});
