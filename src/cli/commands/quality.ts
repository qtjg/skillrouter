import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { line, jsonOut, info, dim, bold } from "../output.ts";
import { analyzeCapabilityQuality, analyzeRegistry } from "../../quality/analyzer.ts";
import { findNeighbors, analyzePool } from "../../registry/neighbors.ts";
import { OutcomeStore } from "../../learning/outcomes.ts";

export const qualityCommand: CommandDef = {
  name: "quality",
  category: "Registry",
  description: "Analyze capability quality: completeness, reliability, outcome history (PRD §8)",
  usage: "[id]",
  args: [{ name: "id", required: false, description: "capability id (default: whole registry ranked)" }],
  flags: [
    { name: "json", description: "machine-readable output" },
    { name: "min-quality", short: "q", type: "number", description: "only show capabilities at or above this quality (default 0)" },
  ],
  examples: ["skillrouter quality", "skillrouter quality docker-helper", "skillrouter quality --min-quality 65"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const capabilities = await app.storage.allCapabilities();
      if (capabilities.length === 0) {
        info("No capabilities in the registry yet. Run `skillrouter install <file|url>` first.");
        return 1;
      }
      const summaries = await new OutcomeStore(app.storage, app.config.learning?.maxOutcomes ?? 1000).summaries();
      const only = typeof ctx.positionals[0] === "string" ? ctx.positionals[0] : null;
      const minQuality = typeof ctx.flags["min-quality"] === "number" ? ctx.flags["min-quality"] : 0;

      const { ranking } = analyzeRegistry(capabilities, summaries);
      const shown = ranking
        .filter((r) => r.quality >= minQuality)
        .filter((r) => !only || r.id === only);

      if (only && shown.length === 0) {
        info(`No capability "${only}" in the registry.`);
        return 1;
      }

      if (ctx.json) {
        jsonOut({
          registry: capabilities.length,
          capabilities: shown.map((r) => ({
            id: r.id,
            quality: r.quality,
            verdict: r.verdict,
            source: r.source,
            dimensions: r.dimensions,
            notes: r.notes,
          })),
        });
        return 0;
      }

      for (const r of shown) {
        line(`  ${bold(r.id)} — ${verdictLabel(r.verdict)} quality ${r.quality}/100 (${r.source})`);
        line(`    completeness ${r.dimensions.completeness}/100 · reliability ${r.dimensions.reliability}/100${r.dimensions.history !== null ? ` · history ${r.dimensions.history}/100` : ""}`);
        for (const note of r.notes) line(`    ${dim(note)}`);
        line("");
      }

      if (!only) {
        const avg = Math.round(ranking.reduce((a, r) => a + r.quality, 0) / Math.max(1, ranking.length));
        line(`  Registry: ${ranking.length} capabilities · mean quality ${avg}/100 · best ${ranking[0]?.id} (${ranking[0]?.quality}/100) · weakest ${ranking.at(-1)?.id} (${ranking.at(-1)?.quality}/100)`);
      }
      return 0;
    });
  },
};

export const neighborsCommand: CommandDef = {
  name: "neighbors",
  category: "Registry",
  description: "Show area coverage: capabilities whose triggers/description overlap a given capability (PRD §4.4)",
  usage: "<id>",
  args: [{ name: "id", required: true, description: "capability id" }],
  flags: [
    { name: "json", description: "machine-readable output" },
    { name: "min-similarity", type: "number", description: "similarity threshold in [0,1] (default 0.08)" },
  ],
  examples: ["skillrouter neighbors docker-helper", "skillrouter neighbors docker-helper --min-similarity 0.2 --json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const capabilities = await app.storage.allCapabilities();
      const id = String(ctx.positionals[0] ?? "").trim();
      if (!capabilities.some((c) => c.id === id)) {
        info(`No capability "${id}" in the registry.`);
        return 1;
      }
      const min = typeof ctx.flags["min-similarity"] === "number" ? ctx.flags["min-similarity"] : 0.08;
      const neighbors = findNeighbors(capabilities, id, { minSimilarity: min });
      const pool = analyzePool(capabilities);
      const mine = pool.get(id)!;

      if (ctx.json) {
        jsonOut({
          id,
          distinctiveness: mine.distinctiveness,
          registrySize: capabilities.length,
          neighbors: neighbors.map((n) => ({ id: n.id, similarity: n.similarity, fields: n.fields, shared: n.shared })),
        });
        return 0;
      }

      line(`  ${bold(id)} — distinctiveness ${Math.round(mine.distinctiveness * 1000) / 10}% (registry of ${capabilities.length})`);
      if (neighbors.length === 0) {
        line(`    ${dim("no overlapping capabilities — unique in this area")}`);
        return 0;
      }
      for (const n of neighbors) {
        const mark = n.similarity >= 0.5 ? "!!" : "  ";
        line(`    ${mark} ${n.id} — ${Math.round(n.similarity * 100)}% overlay (${n.fields.join(", ")})`);
        if (n.shared.length > 0) line(`      ${dim(`shared: ${n.shared.join(", ")}`)}`);
      }
      return 0;
    });
  },
};

function verdictLabel(verdict: string): string {
  const colors: Record<string, string> = { excellent: "green", good: "cyan", adequate: "yellow", weak: "red", minimal: "red" };
  return (colors[verdict] ?? "white") === "red" ? verdict.toUpperCase() : verdict;
}