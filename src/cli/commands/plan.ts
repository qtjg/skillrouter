import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { line, jsonOut, ok, info, dim } from "../output.ts";
import { composePlan } from "../../plan/index.ts";
import { renderTree } from "../../plan/graph.ts";
import { refreshAll } from "../../registry/indexer.ts";
import { findRepoRoot } from "./search.ts";

export const planCommand: CommandDef = {
  name: "plan",
  category: "Registry",
  description: "Compose and validate an execution plan (DAG) from capability composition",
  flags: [{ name: "json", description: "machine-readable output" }],
  examples: ["skillrouter plan", "skillrouter plan docker-deployer", "skillrouter plan docker-deployer --json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const ids = ctx.positionals;
      const repoRoot = findRepoRoot(app.cwd);
      await refreshAll(app.storage, app.config, repoRoot, app.cwd);
      const registry = await app.storage.allCapabilities();
      const byId = new Map(registry.map((c) => [c.id, c]));

      const missingRoots = ids.filter((id) => !byId.has(id));
      if (missingRoots.length > 0) {
        info(`Unknown capability id(s): ${missingRoots.join(", ")}`);
        return 1;
      }

      const plan = composePlan({ registry: byId, roots: ids });
      const v = plan.validation;

      const issues: string[] = [];
      for (const cycle of v.cycles) issues.push(`cycle: ${cycle.path.join(" -> ")}`);
      for (const miss of v.missing) issues.push(`missing: ${miss.capabilityId} (required by ${miss.requiredBy})`);
      for (const conf of v.conflicts) issues.push(`conflict: ${conf.a} <-> ${conf.b}`);
      for (const warning of v.warnings) issues.push(`warning: ${warning}`);

      if (ctx.json) {
        jsonOut({
          valid: v.valid,
          nodes: plan.dag.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label, depth: n.depth, status: n.status })),
          links: plan.dag.links.map((l) => ({ from: l.from, to: l.to, rel: l.rel })),
          steps: plan.steps.map((s) => ({ nodeId: s.nodeId, capabilityId: s.capabilityId, depth: s.depth })),
          issues,
        });
        return 0;
      }

      line("");
      for (const row of renderTree(plan.dag.root)) line("  " + row);
      line("");
      if (plan.steps.length > 0) {
        line("Execution order:");
        for (const step of plan.steps) line(`  ${String(step.depth).padStart(2)}. ${step.capabilityId}`);
      } else {
        line("Execution order: (empty)");
      }
      line("");
      if (v.valid) {
        ok(`Plan valid (${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}).`);
      } else {
        info(`Plan invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}).`);
        for (const issue of issues) line("  - " + dim(issue));
      }
      return v.valid ? 0 : 2;
    });
  },
};