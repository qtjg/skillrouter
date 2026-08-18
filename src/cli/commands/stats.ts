import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { line, info, table, jsonOut, dim } from "../output.ts";
import { ReliabilityEngine, successRate } from "../../learning/metrics.ts";

export const statsCommand: CommandDef = {
  name: "stats",
  category: "Misc",
  description: "Show reliability statistics for capabilities",
  flags: [
    { name: "json", description: "machine-readable output" },
    { name: "min-tasks", short: "m", description: "only show capabilities with at least this many observations (default 0)" },
  ],
  examples: ["skillrouter stats", "skillrouter stats --min-tasks 5", "skillrouter stats --json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const rows = await new ReliabilityEngine(app.storage).snapshot();
      const minTasks = typeof ctx.flags["min-tasks"] === "string" ? parseInt(ctx.flags["min-tasks"], 10) || 0 : 0;
      const visible = rows.filter((r) => r.tasks >= minTasks);

      if (ctx.json) {
        jsonOut({
          capabilities: visible.map((r) => ({
            id: r.capabilityId,
            tasks: r.tasks,
            successes: r.successes,
            failures: r.failures,
            successRate: Math.round(successRate(r) * 1000) / 1000,
            lastUpdated: r.lastUpdated,
          })),
        });
        return 0;
      }

      if (visible.length === 0) {
        info("No reliability statistics yet. Run `skillrouter learn <capability> --success|--failure` after tasks to build them.");
        return 0;
      }

      const total = visible.reduce((a, r) => a + r.tasks, 0);
      line("");
      table(
        ["Capability", "Tasks", "Successes", "Failures", "Success rate", "Last updated"],
        visible.map((r) => [
          r.capabilityId,
          String(r.tasks),
          String(r.successes),
          String(r.failures),
          `${(successRate(r) * 100).toFixed(0)}%`,
          r.lastUpdated.slice(0, 10),
        ]),
      );
      line(`\n${dim(`${visible.length} capabilities · ${total} observations`)}`);
      return 0;
    });
  },
};