import type { CommandDef } from "../framework.ts";
import { withApp, repoRootOf } from "../context.ts";
import { line, info, ok, jsonOut, dim, fail } from "../output.ts";
import { indexCorpus } from "../../corpus/indexer.ts";
import { refreshEmbeddings } from "../../retrieval/index.ts";

export const indexCommand: CommandDef = {
  name: "index",
  category: "Registry",
  description: "Index the capability corpus: extract full bodies, fingerprint, persist canonical records, and refresh dense embeddings when enabled",
  flags: [
    { name: "changed", description: "only reindex capabilities whose content changed since the last index" },
    { name: "capability", short: "c", type: "string", description: "only index this capability" },
    { name: "json", description: "machine-readable output" },
  ],
  examples: ["skillrouter index", "skillrouter index --changed", "skillrouter index --capability docker-deployer"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const capability = typeof ctx.flags["capability"] === "string" ? ctx.flags["capability"] : null;
      const result = await indexCorpus(app.storage, repoRootOf(app), app.cwd, {
        changedOnly: Boolean(ctx.flags["changed"]),
        capabilityIds: capability ? [capability] : [],
      });

      const embedResult =
        capability === null && app.config.retrieval.embeddings.enabled
          ? await refreshEmbeddings(app.storage, app.config.retrieval)
          : { enabled: false, embedded: 0, skipped: 0, failed: 0, errors: [] as Array<{ id: string; message: string }> };

      if (ctx.json) {
        jsonOut({
          indexed: result.indexed,
          skipped: result.skipped,
          failed: result.failed,
          removed: result.removed,
          errors: result.errors,
          embeddings: {
            enabled: embedResult.enabled,
            embedded: embedResult.embedded,
            skipped: embedResult.skipped,
            failed: embedResult.failed,
            errors: embedResult.errors,
          },
        });
        return 0;
      }

      if (result.failed > 0) {
        for (const err of result.errors) fail(`${err.id}: ${err.message}`);
      }
      if (embedResult.enabled) {
        for (const err of embedResult.errors) fail(`embeddings ${err.id}: ${err.message}`);
      }
      ok(`Indexed ${result.indexed} · skipped ${result.skipped} · removed ${result.removed}${result.failed > 0 ? ` · failed ${result.failed}` : ""}`);
      if (embedResult.enabled) {
        line(dim(`embeddings: ${embedResult.embedded} embedded · ${embedResult.skipped} cached${embedResult.failed > 0 ? ` · ${embedResult.failed} failed` : ""}`));
      } else {
        line(dim("dense embeddings disabled (set retrieval.embeddings.enabled: true)"));
      }
      if (result.indexed === 0 && result.skipped === 0 && result.failed === 0) {
        info("No capabilities to index. Discover them first with `skillrouter status` / `skillrouter refresh` or install some.");
      } else if (ctx.flags["changed"]) {
        line(dim("Incremental mode: only changed capabilities were reindexed."));
      }
      return 0;
    });
  },
};