import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { line, ok, warning, info, dim, fail } from "../output.ts";
import { OutcomeStore } from "../../learning/outcomes.ts";
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
    { name: "latency-ms", type: "string", description: "observed execution latency in milliseconds" },
    { name: "verification", type: "string", description: "output verification result: pass|fail" },
    { name: "rating", type: "string", description: "user rating from -2 (poor) to +2 (excellent)" },
    { name: "execution-id", type: "string", description: "stable execution id; generated when omitted" },
  ],
  examples: [
    "skillrouter learn cap:test-writer --success",
    "skillrouter learn cap:web-search --failure --task \"research pricing\"",
    "skillrouter learn cap:web-search --success --latency-ms 1200 --verification pass --rating 1",
  ],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const capabilityId = ctx.positionals[0]!;
      const isSuccess = ctx.flags["failure"] ? false : true;

      const capabilities = await app.storage.allCapabilities();
      const known = new Set(capabilities.map((c) => c.id));
      if (!known.has(capabilityId)) {
        warning(`"${capabilityId}" is not a registered capability; the outcome is still recorded but no fallback can be suggested.`);
      }

      const latencyMs = parseOptionalInt(ctx.flags["latency-ms"], "--latency-ms");
      const rating = parseOptionalInt(ctx.flags["rating"], "--rating");
      if (rating !== null && (rating < -2 || rating > 2)) throw new Error("--rating must be an integer between -2 and +2");
      const verification = parseVerification(ctx.flags["verification"]);
      const executionId = typeof ctx.flags["execution-id"] === "string" && ctx.flags["execution-id"].length > 0 ? ctx.flags["execution-id"] : undefined;
      const task = typeof ctx.flags["task"] === "string" ? ctx.flags["task"] : undefined;

      const store = new OutcomeStore(app.storage, app.config.learning?.maxOutcomes ?? 1000);
      const outcome = await store.record({
        capabilityId,
        task,
        success: isSuccess,
        latencyMs,
        verification,
        rating,
        executionId,
      });

      if (isSuccess) {
        ok(`Recorded success for ${capabilityId} (${outcome.executionId}).`);
      } else {
        fail(`Recorded failure for ${capabilityId} (${outcome.executionId}).`);
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
      if (latencyMs !== null || verification !== null || rating !== null) {
        line("");
        info(dim(`latency ${latencyMs ?? "—"}ms · verification ${verification ?? "—"} · rating ${rating ?? "—"}`));
      }
      await app.storage.addAudit("user", isSuccess ? "learn-success" : "learn-failure", capabilityId, task ?? null);
      return 0;
    });
  },
};

function parseOptionalInt(value: unknown, flag: string): number | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^-?\d+$/.test(value.trim())) throw new Error(`${flag} must be an integer, got "${String(value)}"`);
  return parseInt(value.trim(), 10);
}

function parseVerification(value: unknown): "pass" | "fail" | null {
  if (value === undefined) return null;
  const normalized = String(value).toLowerCase();
  if (normalized !== "pass" && normalized !== "fail") throw new Error("--verification must be either 'pass' or 'fail'");
  return normalized;
}