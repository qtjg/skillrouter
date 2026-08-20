import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { line, table, jsonOut, info, dim } from "../output.ts";
import { retrieve } from "../../retrieval/index.ts";

export const retrieveCommand: CommandDef = {
  name: "retrieve",
  category: "Registry",
  description: "Hybrid retrieval over the capability corpus (BM25 sparse + dense embeddings, RRF fusion)",
  args: [{ name: "query", required: true, description: "free-form search query" }],
  flags: [
    { name: "top-k", type: "number", description: "number of results (default: retrieval.topK in config)" },
    { name: "json", description: "machine-readable output" },
  ],
  examples: ["skillrouter retrieve \"deploy a docker container\"", "skillrouter retrieve \"rollback stripe refund\" --top-k 5 --json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const query = String(ctx.positionals[0] ?? "");
      if (!query.trim()) {
        info("Usage: skillrouter retrieve <query> [--top-k N]");
        return 1;
      }
      const topK = typeof ctx.flags["top-k"] === "number" ? ctx.flags["top-k"] : undefined;
      const result = await retrieve(app.storage, app.config.retrieval, { query, topK });

      if (ctx.json) {
        jsonOut({
          query: result.query,
          provider: result.provider,
          latencyMs: result.latencyMs,
          hits: result.hits.map((h) => ({
            capabilityId: h.capabilityId,
            sectionId: h.sectionId,
            sectionKind: h.sectionKind,
            matchedSections: h.matchedSections.map((m) => ({ id: m.id, title: m.title })),
            score: Math.round(h.score * 1e6) / 1e6,
            rank: h.rank,
            sources: h.sources,
          })),
        });
        return 0;
      }

      if (result.hits.length === 0) {
        if (result.total === 0) info("Corpus is empty. Run `skillrouter index` first.");
        else info(`No matches for "${result.query}". Try different terms.`);
        return 0;
      }

      line("");
      table(
        ["#", "Capability", "Section", "Score", "Sources"],
        result.hits.map((h) => [
          String(h.rank + 1),
          h.capabilityId,
          h.sectionId ? `${h.matchedSections[0]?.title ?? h.sectionId}` : "—",
          String(Math.round(h.score * 1e6) / 1e6),
          h.sources.join("+"),
        ]),
      );
      line("\n" + dim(`${result.hits.length} result(s) · dense: ${result.provider} · ${result.latencyMs}ms`));
      return 0;
    });
  },
};