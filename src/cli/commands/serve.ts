import { readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { CliContext, CommandDef } from "../framework.ts";
import { createAppContext } from "../context.ts";
import { Router } from "../../router/index.ts";
import { analyzeProject } from "../../project/analyzer.ts";
import { getGitContext } from "../../git/context.ts";
import { refreshAll } from "../../registry/indexer.ts";
import { rankCapabilities } from "../../registry/search.ts";
import { collectContext } from "../../context/collect.ts";
import { OutcomeStore } from "../../learning/outcomes.ts";
import { detectAgentIds } from "./route.ts";
import { startMcpStdioServer, type McpServerDeps } from "../../mcp/server.ts";
import { ROUTER_STRATEGIES, type RouterStrategy } from "../../config/config.ts";
import type { RouteContext } from "../../router/types.ts";

function packageVersion(): string {
  // Walk up from this module (works from src/ and dist/ layouts alike).
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const raw = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
        return raw.version ?? "0.0.0";
      } catch {
        break;
      }
    }
    dir = dirname(dir);
  }
  return "0.0.0";
}

export const serveMcpCommand: CommandDef = {
  name: "serve-mcp",
  category: "Connect",
  description: "Expose SkillRouter as an MCP server on stdio (connect any MCP client: Claude, Cline, Cursor, Codex, …)",
  usage: "",
  flags: [],
  examples: [
    "claude mcp add skillrouter -- skillrouter serve-mcp",
    "skillrouter serve-mcp   # newline-delimited JSON-RPC 2.0 on stdin/stdout",
  ],
  handler: async (ctx: CliContext) => {
    const app = await createAppContext(ctx);

    const buildRouteContext = async (task: string, strategy?: string): Promise<RouteContext> => {
      await refreshAll(app.storage, app.config, app.cwd, app.cwd);
      const project = await analyzeProject(app.cwd);
      const git = await getGitContext(app.cwd);
      const capabilities = await app.storage.allCapabilities();
      const installed = new Map((await app.storage.allInstalled()).map((i) => [i.id, i]));
      const agents = await detectAgentIds(app);
      let config = app.config;
      if (strategy && ROUTER_STRATEGIES.includes(strategy as RouterStrategy)) {
        config = { ...app.config, router: { ...app.config.router, strategy: strategy as RouterStrategy } };
      }
      const context = await collectContext(app.cwd, {
        enabled: app.config.router.context.enabled,
        timeoutMs: app.config.router.context.timeoutMs,
      });
      const outcomes = app.config.learning?.enabled
        ? await new OutcomeStore(app.storage, app.config.learning.maxOutcomes).summaries()
        : undefined;
      return {
        task,
        cwd: app.cwd,
        project,
        git,
        capabilities,
        installed,
        agents,
        config,
        context,
        constraints: undefined,
        metrics: new Map((await app.storage.allMetrics()).map((m) => [m.capabilityId, m])),
        outcomes,
      };
    };

    const deps: McpServerDeps = {
      serverInfo: { name: "skillrouter", version: packageVersion() },
      tools: [
        {
          name: "route_task",
          description:
            "Route a task through SkillRouter: ranks available capabilities and returns the activation plan with scores and reasons.",
          inputSchema: {
            type: "object",
            properties: {
              task: { type: "string", description: "The task to route, in natural language." },
              strategy: { type: "string", enum: [...ROUTER_STRATEGIES], description: "Optional routing strategy override." },
            },
            required: ["task"],
          },
          handler: async (args) => {
            const task = typeof args["task"] === "string" ? args["task"] : "";
            if (!task.trim()) throw new Error("task is required");
            const strategy = typeof args["strategy"] === "string" ? args["strategy"] : undefined;
            const decision = await new Router().route(await buildRouteContext(task, strategy));
            return {
              decisionId: decision.decisionId,
              classification: decision.classification,
              confidence: decision.confidence,
              strategy: decision.strategy,
              activate: decision.plan
                .filter((p) => p.action === "activate")
                .map((p) => ({ id: p.capabilityId, score: p.score, confidence: p.confidence, reasons: p.reasons })),
              deactivate: decision.plan.filter((p) => p.action === "deactivate").map((p) => p.capabilityId),
            };
          },
        },
        {
          name: "search_capabilities",
          description: "Search the SkillRouter capability registry by natural-language query.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query." },
              topK: { type: "number", description: "Maximum results to return (default 8)." },
            },
            required: ["query"],
          },
          handler: async (args) => {
            const query = typeof args["query"] === "string" ? args["query"] : "";
            if (!query.trim()) throw new Error("query is required");
            const topK = typeof args["topK"] === "number" && args["topK"] > 0 ? Math.floor(args["topK"]) : 8;
            const capabilities = await app.storage.allCapabilities();
            return rankCapabilities(query, capabilities)
              .slice(0, topK)
              .map((hit) => ({
                id: hit.capability.id,
                name: hit.capability.name,
                description: hit.capability.description,
                score: hit.score,
              }));
          },
        },
        {
          name: "router_stats",
          description: "Reliability stats: capability counts, observed success rates, and recent routing volume.",
          inputSchema: { type: "object", properties: {} },
          handler: async () => {
            const [capabilities, installed, metrics, history] = await Promise.all([
              app.storage.allCapabilities(),
              app.storage.allInstalled(),
              app.storage.allMetrics(),
              app.storage.getHistory({ limit: 20 }).catch(() => []),
            ]);
            return {
              capabilities: capabilities.length,
              installed: installed.length,
              observedMetrics: metrics.map((m) => ({ id: m.capabilityId, successRate: (m as unknown as { successRate?: number }).successRate ?? null })),
              recentDecisions: history.length,
            };
          },
        },
      ],
    };

    if (!ctx.json) {
      // MCP stdio transport: stdout carries protocol messages ONLY.
      // Human-facing banner goes to stderr so real clients never see it.
      process.stderr.write(`SkillRouter MCP server ${packageVersion()} (stdio, JSON-RPC 2.0)\n`);
      process.stderr.write(`tools: ${deps.tools.map((t) => t.name).join(", ")}\n`);
      process.stderr.write("connect: claude mcp add skillrouter -- skillrouter serve-mcp\n");
      process.stderr.write("listening on stdio\n");
    }
    try {
      await startMcpStdioServer(deps);
    } finally {
      app.storage.close();
    }
    return 0;
  },
};
