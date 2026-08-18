import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { line, ok, warning, info, dim, fail } from "../output.ts";
import { ReliabilityEngine } from "../../learning/metrics.ts";
import { resolveFallbackChains, selectFallback } from "../../router/fallback.ts";
import { globalBus } from "../../core/events.ts";

export const learnCommand: CommandDef = {
  name: "learn",
  category: "Reliability",
  description: "Record the outcome of a capability execution; failures suggest a declared fallback",
  args: [{ name: "capability", required: true }],
  flags: [
    { name: "success", description: "record a success (default)" },
    { name: "failure", description: "record a failure" },
    { name: "task", short: "t", type: "string", description: "task description for context" },
  ],
  examples: ["skillrouter learn cap:test-writer --success", "skillrouter learn cap:web-search --failure --task \"research pricing\""],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const capabilityId = ctx.positionals[0]!;
      const isSuccess = ctx.flags["failure"] ? false : true;

      const capabilities = await app.storage.allCapabilities();
      const known = new Set(capabilities.map((c) => c.id));
      if (!known.has(capabilityId)) {
        warning(`"${capabilityId}" is not a registered capability; the outcome is still recorded but no fallback can be suggested.`);
      }

      const engine = new ReliabilityEngine(app.storage);
      const next = await engine.record(capabilityId, isSuccess, typeof ctx.flags["task"] === "string" ? ctx.flags["task"] : undefined);
      const rate = Math.round((next.successes / next.tasks) * 1000) / 10;
      if (isSuccess) {
        ok(`Recorded success for ${capabilityId} (${next.tasks} observations, ${rate}% success).`);
      } else {
        fail(`Recorded failure for ${capabilityId} (${next.tasks} observations, ${rate}% success).`);
        globalBus.emit({ event: "capability.failed", id: capabilityId, error: "recorded through skillrouter learn" });

        const chains = resolveFallbackChains(capabilities);
        const selection = selectFallback(capabilityId, chains, []);
        if (selection) {
          globalBus.emit({ event: "capability.fallback", capability: capabilityId, fallback: selection.id, reason: "declared fallback chain" });
          line("");
          info(`Declared fallback chain: ${chains.get(capabilityId)!.join(" -> ")}`);
          ok(`Fallback suggested: ${selection.id}`);
          info(dim("Re-run the failed task with this capability, e.g. `skillrouter route \"<task>\"` after enabling it."));
        } else {
          info("No declared fallbacks for this capability; reliability metrics are updated regardless.");
        }
      }
      await app.storage.addAudit("user", isSuccess ? "learn-success" : "learn-failure", capabilityId, typeof ctx.flags["task"] === "string" ? ctx.flags["task"] : null);
      return 0;
    });
  },
};