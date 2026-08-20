import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { line, jsonOut, table, info, dim, ok } from "../output.ts";
import { analyzeHistoryGaps } from "../../gaps/index.ts";

export const gapsCommand: CommandDef = {
  name: "gaps",
  category: "Registry",
  description: "Detect capability gaps from weakly-answered routing history vs corpus coverage",
  flags: [
    { name: "limit", short: "n", type: "number", description: "max gaps to report (default 20)" },
    { name: "min-frequency", type: "number", description: "only terms in >= N gap queries (default 2)" },
    { name: "history-limit", type: "number", description: "routing history rows to inspect (default 500)" },
    { name: "json", description: "machine-readable output" },
  ],
  examples: ["skillrouter gaps", "skillrouter gaps --limit 10 --json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const analysis = await analyzeHistoryGaps(app.storage, {
        historyLimit: typeof ctx.flags["history-limit"] === "number" ? ctx.flags["history-limit"] : 500,
        minFrequency: typeof ctx.flags["min-frequency"] === "number" ? ctx.flags["min-frequency"] : 2,
        maxGaps: typeof ctx.flags["limit"] === "number" ? ctx.flags["limit"] : 20,
      });

      if (ctx.json) {
        jsonOut({
          totalQueries: analysis.totalQueries,
          corpusSections: analysis.corpusSections,
          suggestedQuery: analysis.suggestedQuery,
          gaps: analysis.gaps.map((g) => ({ term: g.term, frequency: g.frequency, coverage: g.coverage, score: Math.round(g.score * 1000) / 1000 })),
        });
        return 0;
      }

      if (analysis.totalQueries === 0) {
        ok("No weakly-answered routing history to analyze. Route tasks first, then re-run.");
        return 0;
      }
      if (analysis.gaps.length === 0) {
        ok(`No significant gaps after ${analysis.totalQueries} query(ies) across ${analysis.corpusSections} corpus section(s).`);
        return 0;
      }

      line("");
      table(
        ["Term", "Queries", "Coverage", "Score"],
        analysis.gaps.map((g) => [g.term, String(g.frequency), String(g.coverage), g.score.toFixed(2)]),
      );
      line("");
      info(`Analyzed ${analysis.totalQueries} weakly-answered quer${analysis.totalQueries === 1 ? "y" : "ies"} against ${analysis.corpusSections} corpus section(s).`);
      line(dim(`Suggested acquisition query: \`skillrouter search ${analysis.suggestedQuery}\``));
      return 0;
    });
  },
};