import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { section, line, info, jsonOut, dim, bold } from "../output.ts";
import { classifyIntent } from "../../intent/classifier.ts";
import { collectContext } from "../../context/collect.ts";

export const classifyCommand: CommandDef = {
  name: "classify",
  category: "Intent",
  description: "Classify the intent of a task (deterministic, no LLM required)",
  usage: "\"<task>\"",
  args: [{ name: "task", required: true, variadic: true, description: "task description" }],
  examples: ["skillrouter classify \"fix this React error\"", "skillrouter classify \"deploy the app\" --json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const task = ctx.positionals.join(" ");
      if (!task.trim()) throw new Error("Usage: skillrouter classify \"<task>\"");
      const context = await collectContext(app.cwd, {
        enabled: app.config.router.context.enabled,
        timeoutMs: app.config.router.context.timeoutMs,
      });
      const result = classifyIntent(task, context);

      if (ctx.json) {
        jsonOut({ task, intent: result.intent, confidence: result.confidence, domain: result.domain, language: result.language, signals: result.signals, operations: result.operations });
        return 0;
      }

      section("Intent classification");
      line(`  intent:      ${bold(result.intent)}`);
      line(`  confidence:  ${(result.confidence * 100).toFixed(0)}%`);
      if (result.domain) line(`  domain:      ${result.domain}`);
      if (result.language.length > 0) line(`  language:    ${result.language.join(", ")}`);
      if (result.operations.length > 0) line(`  operations:  ${result.operations.join(", ")}`);
      if (result.signals.length > 0) {
        line("");
        line(`  signals: ${result.signals.map((s) => dim(s)).join(", ")}`);
      } else {
        line("");
        info("No intent keywords matched; intent defaults to analysis with low confidence.");
      }
      return 0;
    });
  },
};