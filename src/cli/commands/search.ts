import type { CliContext, CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { section, line, ok, info, table, jsonOut, dim, bold, riskColor, compatColor, trustColor, emoji } from "../output.ts";
import { rankCapabilities } from "../../registry/search.ts";
import { refreshAll } from "../../registry/indexer.ts";
import { resolveCapability } from "../helpers.ts";
import { computeRisk } from "../../security/risk.ts";
import { analyzeProject } from "../../project/analyzer.ts";
import { Router } from "../../router/index.ts";
import { getGitContext } from "../../git/context.ts";
import type { RouteContext } from "../../router/types.ts";
import type { AppContext } from "../context.ts";
import { existsSync, statSync } from "node:fs";
import type { AgentId } from "../../core/types.ts";

export const searchCommand: CommandDef = {
  name: "search",
  category: "Discovery",
  description: "Search the capability registry",
  usage: "<query>",
  args: [{ name: "query", required: true, variadic: true, description: "search query" }],
  flags: [
    { name: "limit", short: "n", type: "number", description: "max results (default 20)" },
    { name: "type", description: "filter by capability type (skill, plugin, mcp-server, ...)" },
  ],
  examples: ["skillrouter search stripe", "skillrouter search \"security audit\" --limit 5"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const query = ctx.positionals.join(" ");
      const limit = typeof ctx.flags["limit"] === "number" ? ctx.flags["limit"] : 20;
      const typeFilter = typeof ctx.flags["type"] === "string" ? ctx.flags["type"] : null;

      await refreshAll(app.storage, app.config, findRepoRoot(app.cwd), app.cwd);
      const capabilities = await app.storage.allCapabilities();
      const filtered = typeFilter ? capabilities.filter((c) => c.type === typeFilter || (typeFilter === "mcp" && c.type === "mcp-server")) : capabilities;
      const hits = rankCapabilities(query, filtered, { limit });

      if (ctx.json) {
        jsonOut({ query, hits: hits.map((h) => ({ id: h.id, name: h.name, version: h.version, type: h.type, score: h.score, signals: h.signals })) });
        return 0;
      }
      if (hits.length === 0) {
        line(`No capabilities found for "${query}".`);
        info("Try different terms, or add a source: `skillrouter source add <url|path>`");
        return 0;
      }
      section(`Search results for: ${query}`);
      table(
        ["Score", "ID", "Type", "Risk", "Trust", "Compatibility"],
        hits.map((h) => {
          const risk = computeRisk(h.capability);
          return [
            String(h.score).padStart(3),
            bold(h.id),
            h.type,
            riskColor(risk.level),
            trustColor(h.capability.trust ?? "unknown"),
            compatLevel(h.capability),
          ];
        }),
      );
      line("");
      info(`${hits.length} result(s). Run \`skillrouter info <id>\` for details.`);
      return 0;
    });
  },
};

export const infoCommand: CommandDef = {
  name: "info",
  category: "Discovery",
  description: "Show detailed information about a capability",
  usage: "<capability>",
  args: [{ name: "capability", required: true, description: "capability id" }],
  examples: ["skillrouter info security-audit"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const capability = await resolveCapability(app.storage, ctx.positionals[0]!);
      const risk = computeRisk(capability);
      if (ctx.json) {
        jsonOut({ capability, risk });
        return 0;
      }
      section(bold(capability.name));
      line(`  ${capability.description}`);
      line("");
      const kv: Array<[string, string]> = [
        ["ID", bold(capability.id)],
        ["Version", capability.version],
        ["Type", capability.type],
        ["Trust", trustColor(capability.trust ?? "unknown")],
        ["Risk", `${riskColor(risk.level)} (${risk.score}/100)`],
        ["Source", `${capability.source?.type ?? "unknown"} @ ${capability.source?.location ?? "-"}`],
        ["Schema", capability.schema ?? "skillrouter/v1"],
        ["Author", capability.metadata?.author ?? "-"],
        ["License", capability.metadata?.license ?? "-"],
        ["Repository", capability.metadata?.repository ?? "-"],
      ];
      for (const [k, v] of kv) line(`${" ".repeat(2)}${dim(k.padEnd(12))}${v}`);
      const sections: Array<[string, string[] | undefined]> = [
        ["Capabilities", capability.capabilities],
        ["Keywords", capability.triggers?.keywords],
        ["Intents", capability.triggers?.intents],
        ["Technologies", capability.triggers?.technologies],
        ["Dependencies", capability.dependencies?.map((d) => (d.version ? `${d.id}@${d.version}` : d.id))],
        ["Conflicts", capability.conflicts],
        ["Categories", capability.metadata?.categories],
      ];
      for (const [name, values] of sections) {
        if (values && values.length > 0) {
          line("");
          line(`  ${bold(name)}: ${values.join(", ")}`);
        }
      }
      if (risk.breakdown.length > 0) {
        line("");
        line(`  ${bold("Risk breakdown")}`);
        for (const b of risk.breakdown) {
          const icon = b.permission.includes("wildcard") || b.permission.includes("shell") || b.permission.includes("credential") ? "high" : "medium";
          line(`    ${emoji(icon)} ${b.permission} (+${b.points}) — ${b.detail}`);
        }
      }
      if (capability.permissions) {
        line("");
        line(`  ${bold("Permissions")}`);
        line(`    ${JSON.stringify(capability.permissions)}`);
      }
      return 0;
    });
  },
};

export const findCommand: CommandDef = {
  name: "find",
  aliases: ["recommend"],
  category: "Discovery",
  description: "Recommend capabilities for a task in natural language",
  usage: "<task>",
  args: [{ name: "task", required: true, variadic: true, description: "task description" }],
  examples: ["skillrouter find \"I need to implement Stripe subscriptions\""],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const task = ctx.positionals.join(" ");
      const project = await analyzeProject(app.cwd);
      const git = await getGitContext(app.cwd);
      const capabilities = await app.storage.allCapabilities();
      const installed = new Map((await app.storage.allInstalled()).map((i) => [i.id, i]));
      const agents = await detectAgents(app);
      const routeCtx: RouteContext = {
        task,
        cwd: app.cwd,
        project,
        git,
        capabilities,
        installed,
        agents,
        config: app.config,
        metrics: new Map((await app.storage.allMetrics()).map((m) => [m.capabilityId, m])),
      };
      const decision = await new Router().route(routeCtx);
      const top = decision.scores.filter((s) => s.score >= 20).slice(0, 10);
      if (ctx.json) {
        jsonOut({ task, analysis: decision.analysis, recommended: top.map((s) => ({ id: s.capability.id, score: s.score })) });
        return 0;
      }
      section(`Recommended capability set`);
      for (const score of top) {
        ok(`${score.capability.id} — ${score.score}/100`);
      }
      line("");
      info(`Routed in ${decision.latencyMs}ms (deterministic).`);
      return 0;
    });
  },
};

export async function detectAgents(app: AppContext): Promise<AgentId[]> {
  const { detectAll } = await import("../../adapters/env.ts");
  const agents = await detectAll(app.cwd);
  return agents.filter((a) => a.detected).map((a) => a.id);
}

function compatLevel(capability: { compatibility: Record<string, string> }): string {
  const entries = Object.entries(capability.compatibility ?? {});
  if (entries.length === 0) return dim("universal");
  const levels = entries.map(([, level]) => level);
  const best = levels.includes("native") ? "native" : levels.includes("compatible") ? "compatible" : levels.includes("adaptable") ? "adaptable" : "unsupported";
  return compatColor(best);
}

export function findRepoRoot(start: string): string {
  let current = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(joinPath(current, ".git"))) return current;
    const index = current.lastIndexOf("/");
    if (index <= 0) return start;
    current = current.slice(0, index);
  }
  return start;
}

function joinPath(dir: string, name: string): string {
  return `${dir}/${name}`;
}

export function safeExists(p: string): boolean {
  try {
    return statSync(p).isFile() || existsSync(p);
  } catch {
    return false;
  }
}