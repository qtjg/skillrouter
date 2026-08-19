import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { line, info, table, jsonOut, dim } from "../output.ts";
import { OutcomeStore } from "../../learning/outcomes.ts";
import { buildReports } from "../../learning/reputation.ts";

export const reputationCommand: CommandDef = {
  name: "reputation",
  category: "Reliability",
  description: "Show capability reputation: reliability, latency, verification and ratings",
  flags: [
    { name: "json", description: "machine-readable output" },
    { name: "min-usage", short: "u", description: "only show capabilities with at least this many observations (default 0)" },
    { name: "capability", short: "c", type: "string", description: "only show this capability" },
  ],
  examples: ["skillrouter reputation", "skillrouter reputation --min-usage 3", "skillrouter reputation --json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const metricsRows = await app.storage.allMetrics();
      const summaries = await new OutcomeStore(app.storage, app.config.learning?.maxOutcomes ?? 1000).summaries();
      const capabilities = await app.storage.allCapabilities();
      const byId = new Map(capabilities.map((c) => [c.id, c]));

      const minUsage = typeof ctx.flags["min-usage"] === "string" ? parseInt(ctx.flags["min-usage"], 10) || 0 : 0;
      const only = typeof ctx.flags["capability"] === "string" ? ctx.flags["capability"] : null;

      let reports = buildReports(metricsRows, summaries, byId).filter((r) => r.usage >= minUsage);
      if (only) reports = reports.filter((r) => r.capabilityId === only);

      if (ctx.json) {
        jsonOut({
          capabilities: reports.map((r) => ({
            id: r.capabilityId,
            usage: r.usage,
            reliability: Math.round(r.reliability * 1000) / 1000,
            successRate: Math.round(r.successRate * 1000) / 1000,
            avgLatencyMs: r.avgLatencyMs,
            p95LatencyMs: r.p95LatencyMs,
            verificationRate: r.verificationRate === null ? null : Math.round(r.verificationRate * 1000) / 1000,
            freshness: Math.round(r.freshness * 1000) / 1000,
            userRating: r.userRating,
            securityScore: Math.round(r.securityScore * 1000) / 1000,
            trust: r.trust,
          })),
        });
        return 0;
      }

      if (reports.length === 0) {
        info("No reputation data yet. Record outcomes with `skillrouter learn <capability> --success|--failure [--latency-ms N --verification pass --rating 1]`.");
        return 0;
      }

      line("");
      table(
        ["Capability", "Reliability", "Success", "P95 lat", "Verify", "Rating", "Usage", "Trust"],
        reports.map((r) => [
          r.capabilityId,
          `${(r.reliability * 100).toFixed(1)}%`,
          `${(r.successRate * 100).toFixed(0)}%`,
          r.p95LatencyMs === null ? "—" : `${Math.round(r.p95LatencyMs)}ms`,
          r.verificationRate === null ? "—" : `${(r.verificationRate * 100).toFixed(0)}%`,
          r.userRating === null ? "—" : (r.userRating > 0 ? "+" : "") + String(r.userRating),
          String(r.usage),
          r.trust,
        ]),
      );
      line(`\n${dim(`${reports.length} capabilities with observations · freshness ${(reports[0]!.freshness * 100).toFixed(0)}%`)}`);
      return 0;
    });
  },
};