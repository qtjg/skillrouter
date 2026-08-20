import type { ComposedPlan, PlanInput, PlanStep } from "./types.ts";
import { buildPlanDag, classifyStatuses, linearize, validatePlan } from "./graph.ts";

/**
 * Compose an explicit plan (PRD v2.0 D5): build the DAG, validate it and
 * produce a topologically ordered execution sequence.
 */
export function composePlan(input: PlanInput): ComposedPlan {
  const dag = buildPlanDag(input);
  const known = new Set(input.registry.keys());
  const validation = validatePlan(dag, known);
  classifyStatuses(dag, validation);

  const order = linearize(dag);
  const byId = new Map(dag.nodes.map((n) => [n.id, n]));
  const steps: PlanStep[] = [];
  for (const id of order) {
    const node = byId.get(id);
    if (!node || node.kind !== "capability" || node.capabilityId === undefined) continue;
    if (node.status === "skipped" || node.status === "missing") continue;
    steps.push({
      nodeId: node.id,
      capabilityId: node.capabilityId,
      label: node.label,
      depth: node.depth,
    });
  }

  return { dag, validation, steps };
}