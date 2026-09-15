import { createInterface } from "node:readline";

/**
 * Minimal MCP (Model Context Protocol) stdio server.
 *
 * Speaks newline-delimited JSON-RPC 2.0 over stdin/stdout per the MCP stdio
 * transport. Exposes the router to ANY MCP-capable client (Claude Desktop,
 * Cline, Cursor, Codex, Gemini CLI, …) so agents can ask SkillRouter which
 * capability fits a task, search the registry, and read reliability stats
 * mid-session.
 *
 * No runtime dependencies: hand-rolled JSON-RPC on node:readline.
 */

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerDeps {
  serverInfo: { name: string; version: string };
  tools: Array<McpToolDef & { handler: (args: Record<string, unknown>) => Promise<unknown> }>;
}

const PROTOCOL_VERSION = "2024-11-05";

function textResult(value: unknown, isError = false): Record<string, unknown> {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const result: Record<string, unknown> = { content: [{ type: "text", text }] };
  if (isError) result["isError"] = true;
  return result;
}

export function createMcpHandler(deps: McpServerDeps): (message: unknown) => Promise<Record<string, unknown> | null> {
  return async (message: unknown): Promise<Record<string, unknown> | null> => {
    if (typeof message !== "object" || message === null) return null;
    const msg = message as Record<string, unknown>;
    const method = typeof msg["method"] === "string" ? msg["method"] : null;
    if (!method) return null;
    const id = msg["id"];
    const isNotification = id === undefined || id === null;
    const params = (typeof msg["params"] === "object" && msg["params"] !== null ? msg["params"] : {}) as Record<string, unknown>;

    const respond = (result: unknown): Record<string, unknown> | null =>
      isNotification ? null : { jsonrpc: "2.0", id, result };
    const respondError = (code: number, message: string): Record<string, unknown> | null =>
      isNotification ? null : { jsonrpc: "2.0", id, error: { code, message } };

    try {
      switch (method) {
        case "initialize": {
          const requested = typeof params["protocolVersion"] === "string" ? params["protocolVersion"] : PROTOCOL_VERSION;
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: requested,
              capabilities: { tools: { listChanged: false } },
              serverInfo: deps.serverInfo,
            },
          };
        }
        case "ping":
          return respond({});
        case "tools/list":
          return respond({
            tools: deps.tools.map(({ handler, ...def }) => {
              void handler;
              return def;
            }),
          });
        case "tools/call": {
          const name = typeof params["name"] === "string" ? params["name"] : null;
          const tool = deps.tools.find((t) => t.name === name);
          if (!tool) return respondError(-32602, `Unknown tool: ${String(name)}`);
          const args = (typeof params["arguments"] === "object" && params["arguments"] !== null ? params["arguments"] : {}) as Record<string, unknown>;
          const output = await tool.handler(args);
          return respond(textResult(output));
        }
        default:
          if (method.startsWith("notifications/")) return null;
          return respondError(-32601, `Method not found: ${method}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (method === "tools/call") return respond(textResult({ error: message }, true));
      return respondError(-32603, message);
    }
  };
}

/**
 * Starts the stdio server; resolves when stdin closes (client disconnect).
 * Writes one JSON-RPC message per line to stdout, exactly one response line
 * per request line.
 */
export async function startMcpStdioServer(deps: McpServerDeps): Promise<void> {
  const handle = createMcpHandler(deps);
  const rl = createInterface({ input: process.stdin });
  const inflight = new Set<Promise<unknown>>();
  const closePromise = new Promise<void>((resolve) => rl.on("close", resolve));
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
      return;
    }
    const task = handle(message)
      .then((response) => {
        if (response) process.stdout.write(JSON.stringify(response) + "\n");
      })
      .catch(() => {})
      .finally(() => inflight.delete(task));
    inflight.add(task);
  });
  await closePromise;
  // stdin closed (client disconnect): let in-flight tool calls finish so
  // responses are flushed instead of being dropped by an early exit.
  while (inflight.size > 0) {
    await Promise.all([...inflight]);
  }
}
