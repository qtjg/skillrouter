import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { section, line, ok, warning, info, jsonOut, dim } from "../output.ts";
import { collectContext } from "../../context/collect.ts";

export const contextCommand: CommandDef = {
  name: "context",
  category: "Context",
  description: "Show the normalized context detected in the current directory",
  usage: "",
  examples: ["skillrouter context", "skillrouter context --json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const collected = await collectContext(app.cwd, {
        enabled: app.config.router.context.enabled,
        timeoutMs: app.config.router.context.timeoutMs,
      });

      if (ctx.json) {
        jsonOut({ fields: collected.fields, warnings: collected.warnings, timeline: collected.timeline });
        return 0;
      }

      section("Context");
      const keys = Object.keys(collected.fields).sort();
      if (keys.length === 0) {
        info("No context detected. Run inside a project directory with source files.");
      }
      for (const key of keys) {
        const value = collected.fields[key];
        const display = Array.isArray(value) ? value.join(", ") : String(value);
        line(`  ${dim(key)} = ${display}`);
      }
      if (collected.warnings.length > 0) {
        line("");
        warning(`${collected.warnings.length} provider warning(s):`);
        for (const w of collected.warnings) line(`    ${w}`);
      }
      line("");
      ok(`Collected from ${collected.timeline.filter((t) => t.ok).length}/${collected.timeline.length} providers.`);
      for (const slow of collected.timeline.filter((t) => !t.ok && t.timedOut)) {
        line(`    ${dim(`${slow.provider}: timed out after ${slow.elapsedMs}ms`)}`);
      }
      return 0;
    });
  },
};