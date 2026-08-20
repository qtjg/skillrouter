import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { line, jsonOut, ok, info, dim, bold, green } from "../output.ts";
import { decomposeTask } from "../../task/decompose.ts";
import { planWorkflow } from "../../workflow/planner.ts";
import { refreshAll } from "../../registry/indexer.ts";
import { analyzeProject } from "../../project/analyzer.ts";
import { getGitContext } from "../../git/context.ts";
import type { RouteContext } from "../../router/types.ts";
import { detectAgentIds } from "./route.ts";

export const decomposeCommand: CommandDef = {
  name: "decompose",
  category: "Planning",
  description: "Decompose a task into an ordered list of subtasks (PRD §14 cookbook recipes)",
  usage: "\"<task>\"",
  args: [{ name: "task", required: true, variadic: true, description: "task description" }],
  flags: [{ name: "json", description: "machine-readable output" }],
  examples: ["skillrouter decompose \"deploy the app\"", "skillrouter decompose \"write tests, then deploy\" --json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const task = ctx.positionals.join(" ");
      if (!task.trim()) throw new Error('Usage: skillrouter decompose "<task>"');

      const decomposition = decomposeTask(task);
      if (ctx.json) {
        jsonOut({
          task,
          confidence: decomposition.confidence,
          note: decomposition.note,
          subtasks: decomposition.subtasks.map((s) => ({ id: s.id, description: s.description, stage: s.stage, source: s.source, operations: s.operations, domains: s.domains, technologies: s.technologies })),
        });
        return 0;
      }

      line("");
      line(`  ${bold(task)} — ${decomposition.subtasks.length} subtask${decomposition.subtasks.length === 1 ? "" : "s"} (confidence ${Math.round(decomposition.confidence * 100)}%)`);
      if (decomposition.note) line(`  ${dim(decomposition.note)}`);
      line("");
      for (const subtask of decomposition.subtasks) {
        line(`  ${green(subtask.id)}  ${subtask.description}${subtask.stage ? dim(`  [${subtask.source}: ${subtask.stage}]`) : dim(`  [${subtask.source}]`)}`);
      }
      return 0;
    });
  },
};

export const workflowCommand: CommandDef = {
  name: "workflow",
  category: "Planning",
  description: "Decompose a task, route every subtask and compose a validated execution plan (PRD §14)",
  usage: "\"<task>\"",
  args: [{ name: "task", required: true, variadic: true, description: "task description" }],
  flags: [{ name: "json", description: "machine-readable output" }],
  examples: ["skillrouter workflow \"deploy the app\"", "skillrouter workflow \"migrate the database\" --json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const task = ctx.positionals.join(" ");
      if (!task.trim()) throw new Error('Usage: skillrouter workflow "<task>"');

      await refreshAll(app.storage, app.config, app.cwd, app.cwd);
      const project = await analyzeProject(app.cwd);
      const git = await getGitContext(app.cwd);
      const capabilities = await app.storage.allCapabilities();
      const installed = new Map((await app.storage.allInstalled()).map((i) => [i.id, i]));
      const agents = await detectAgentIds(app);

      const base: RouteContext = {
        task,
        cwd: app.cwd,
        project,
        git,
        capabilities,
        installed,
        agents,
        config: app.config,
      };

      const plan = await planWorkflow({ ctx: base });

      if (ctx.json) {
        jsonOut({
          task,
          note: plan.note,
          decomposition: {
            confidence: plan.decomposition.confidence,
            subtasks: plan.decomposition.subtasks.map((s) => ({ id: s.id, description: s.description, source: s.source })),
          },
          steps: plan.steps.map((s) => ({
            step: s.step,
            subtask: s.subtaskId,
            description: s.subtaskDescription,
            capability: s.capabilityId,
            score: s.score,
            confidence: s.confidence,
            dependencies: s.dependencies,
            source: s.source,
          })),
          composed: plan.composed ? { valid: plan.composed.validation.valid, steps: plan.composed.steps.map((st) => st.capabilityId), issues: [...plan.composed.validation.cycles.map((c) => `cycle: ${c.path.join(" -> ")}`), ...plan.composed.validation.missing.map((m) => `missing: ${m.capabilityId} (required by ${m.requiredBy})`)] } : null,
        });
        return 0;
      }

      line("");
      line(`  ${bold("Workflow:")} ${task}`);
      if (plan.note) line(`  ${dim(plan.note)}`);
      line("");
      for (const step of plan.steps) {
        const capability = step.capabilityId ? green(step.capabilityId) : dim("(no capability above threshold)");
        line(`  ${String(step.step).padStart(2)}. ${step.subtaskDescription}`);
        line(`     ${bold("→")} ${capability} — ${step.score}/100 (${step.confidence}, ${step.source})`);
        for (const signal of step.signals) line(`       ${dim(signal)}`);
        if (step.dependencies.length > 0) line(`       ${dim("depends on: " + step.dependencies.join(", "))}`);
      }
      line("");
      if (plan.composed?.validation.valid) ok("Composition valid — execution order above is dependency-safe.");
      else if (plan.composed) info("Composition has issues — see --json for details.");
      return 0;
    });
  },
};