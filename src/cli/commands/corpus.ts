import type { CommandDef } from "../framework.ts";
import { withApp, repoRootOf } from "../context.ts";
import { line, info, ok, jsonOut, dim, fail } from "../output.ts";
import { indexCorpus } from "../../corpus/indexer.ts";

export const indexCommand: CommandDef = {
  name: "index",
  category: "Registry",
  description: "Index the capability corpus: extract full bodies, fingerprint and persist canonical records",
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

      if (ctx.json) {
        jsonOut({
          indexed: result.indexed,
          skipped: result.skipped,
          failed: result.failed,
          removed: result.removed,
          errors: result.errors,
        });
        return 0;
      }

      if (result.failed > 0) {
        for (const err of result.errors) fail(`${err.id}: ${err.message}`);
      }
      ok(`Indexed ${result.indexed} · skipped ${result.skipped} · removed ${result.removed}${result.failed > 0 ? ` · failed ${result.failed}` : ""}`);
      if (result.indexed === 0 && result.skipped === 0 && result.failed === 0) {
        info("No capabilities to index. Discover them first with `skillrouter status` / `skillrouter refresh` or install some.");
      } else if (ctx.flags["changed"]) {
        line(dim("Incremental mode: only changed capabilities were reindexed."));
      }
      return 0;
    });
  },
};