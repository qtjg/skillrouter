import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { line, table, jsonOut, ok, info, dim } from "../output.ts";
import { findDuplicates } from "../../fingerprint/shingle.ts";

export const duplicatesCommand: CommandDef = {
  name: "duplicates",
  category: "Registry",
  description: "Detect near-duplicate capabilities from corpus shingle fingerprints (Dice similarity)",
  flags: [
    { name: "threshold", type: "number", description: "similarity threshold in [0,1] (default 0.85)" },
    { name: "capability", short: "c", type: "string", description: "only report pairs involving this capability" },
    { name: "json", description: "machine-readable output" },
  ],
  examples: ["skillrouter duplicates", "skillrouter duplicates --threshold 0.85 --json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const records = await app.storage.allCorpusRecords();
      const threshold = typeof ctx.flags["threshold"] === "number" ? ctx.flags["threshold"] : 0.85;
      if (threshold < 0 || threshold > 1) {
        info("--threshold must be between 0 and 1.");
        return 1;
      }
      const only = typeof ctx.flags["capability"] === "string" ? ctx.flags["capability"] : null;

      let { pairs, clusters } = findDuplicates(records, threshold);
      if (only) {
        pairs = pairs.filter((p) => p.a === only || p.b === only);
        clusters = clusters.filter((c) => c.members.includes(only));
      }

      if (ctx.json) {
        jsonOut({
          threshold,
          pairs: pairs.map((p) => ({
            a: p.a,
            b: p.b,
            similarity: Math.round(p.similarity * 1000) / 1000,
          })),
          clusters: clusters.map((c) => ({ rep: c.rep, members: c.members })),
        });
        return 0;
      }

      if (records.length === 0) {
        info("Corpus is empty. Run `skillrouter index` first.");
        return 0;
      }
      if (pairs.length === 0) {
        ok(`No near-duplicates above ${threshold.toFixed(2)} across ${records.length} capabilities.`);
        return 0;
      }

      line("");
      table(
        ["A", "B", "Similarity"],
        pairs.map((p) => [p.a, p.b, `${(p.similarity * 100).toFixed(0)}%`]),
      );
      line("\n" + dim(`${pairs.length} pair(s) · ${clusters.length} cluster(s) at threshold ${threshold.toFixed(2)}`));
      return 0;
    });
  },
};