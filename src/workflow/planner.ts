import { Router } from "../router/index.ts";
import type { RouteContext, CapabilityScore } from "../router/types.ts";
import { decomposeTask, type Decomposition, type Subtask } from "../task/decompose.ts";
import { composePlan } from "../plan/index.ts";
import type { ComposedPlan } from "../plan/types.ts";
import type { Capability } from "../core/types.ts";

/**
 * Workflow planner (PRD §14, "cookbook skills"): decomposes a task into
 * subtasks, routes each subtask through the router, then composes the chosen
 * capabilities into a validated DAG so the execution order honors declared
 * `requires` relationships between the selected capabilities.
 */

export type WorkflowStepSource = "routed" | "fallback" | "none";

export interface WorkflowStep {
  step: number;
  subtaskId: string;
  subtaskDescription: string;
  /** Best routed capability for this subtask; null when nothing matched. */
  capabilityId: string | null;
  score: number;
  confidence: string;
  signals: string[];
  /** Capability ids that must run before this step (from the composed DAG). */
  dependencies: string[];
  source: WorkflowStepSource;
}

export interface WorkflowPlan {
  task: string;
  decomposition: Decomposition;
  steps: WorkflowStep[];
  /** DAG validation of the joined capability set; null when nothing was routed. */
  composed: ComposedPlan | null;
  note: string | null;
}

export interface WorkflowInput {
  ctx: RouteContext;
  /** Pre-computed decomposition; computed from ctx.task when omitted. */
  decomposition?: Decomposition;
  /** Minimum per-subtask score to accept a routed capability (config router.threshold). */
  threshold?: number;
}

export async function planWorkflow(input: WorkflowInput): Promise<WorkflowPlan> {
  const { ctx, decomposition } = input;
  const workflow = decomposition ?? decomposeTask(ctx.task);
  const router = new Router();
  const chosen: Array<{ subtask: Subtask; capabilityId: string; score: number }> = [];

  const steps: WorkflowStep[] = [];
  for (const subtask of workflow.subtasks) {
    const decision = await router.route({ ...ctx, task: subtask.description });
    const best = decision.scores[0] as CapabilityScore | undefined;
    const minScore = input.threshold ?? ctx.config.router.threshold;
    const capabilityId = best && best.score >= minScore ? best.capability.id : null;

    if (capabilityId && best) chosen.push({ subtask, capabilityId, score: best.score });

    steps.push({
      step: steps.length + 1,
      subtaskId: subtask.id,
      subtaskDescription: subtask.description,
      capabilityId,
      score: best?.score ?? 0,
      confidence: decision.confidence.label,
      signals: best ? best.signals.map((s) => s.text).slice(0, 3) : [],
      dependencies: [],
      source: capabilityId ? "routed" : "none",
    });
  }

  let composed: ComposedPlan | null = null;
  if (chosen.length > 0) {
    const registry = new Map<string, Capability>(ctx.capabilities.map((c) => [c.id, c]));
    composed = composePlan({ registry, roots: [...new Set(chosen.map((c) => c.capabilityId))] });
    const order = composed.steps.map((s) => s.capabilityId);
    const position = new Map(order.map((id, i) => [id, i]));
    for (const step of steps) {
      if (!step.capabilityId) continue;
      const declared = ctx.capabilities.find((c) => c.id === step.capabilityId)?.capabilities ?? [];
      step.dependencies = declared
        .filter((id) => position.has(id))
        .sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
    }
  }

  const note =
    composed && !composed.validation.valid
      ? `composition issues: ${composed.validation.cycles.length} cycle(s), ${composed.validation.missing.length} missing, ${composed.validation.conflicts.length} conflict(s)`
      : null;

  return { task: ctx.task, decomposition: workflow, steps, composed, note };
}