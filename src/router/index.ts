import type { RouterDecision, RouteContext, TaskAnalysis, CapabilityScore, SemanticMatcher, LlmReRanker } from "./types.ts";
import type { InstalledCapabilityRow } from "../storage/types.ts";
import type { Capability } from "../core/types.ts";
import { analyzeTask } from "./analyzer.ts";
import { prepareCapability, scoreSingleCapability } from "./factors.ts";
import { resolveConflicts } from "./conflicts.ts";
import { buildPlan, createDecision, defaultPlannerOptions, type PlannerOptions } from "./planner.ts";
import { defaultSemanticMatcher, defaultLlmReranker } from "./semantic.ts";
import { RouterError } from "../utils/errors.ts";
import { globalBus } from "../core/events.ts";

export { expandDependencies, sortByDependencies, requiredDependencies } from "./dependency-resolver.ts";
export type { DependencyResolution, MissingDependency, OptionalMiss } from "./dependency-resolver.ts";

export interface RouterOptions {
  semanticMatcher?: SemanticMatcher;
  llmReranker?: LlmReRanker;
}

const PREPARED = new WeakMap<Capability, ReturnType<typeof prepareCapability>>();

function preparedFor(capability: Capability) {
  let prepared = PREPARED.get(capability);
  if (!prepared) {
    prepared = prepareCapability(capability);
    PREPARED.set(capability, prepared);
  }
  return prepared;
}

/**
 * The SkillRouter routing pipeline:
 * Task Input → Task Analyzer → Project Analyzer → Environment Detector →
 * Capability Discovery → Compatibility Filter → Security Filter →
 * Dependency Resolver → Relevance Ranking → Conflict Resolver →
 * Activation Planner → (User Consent) → (Adapter Execution)
 *
 * The router itself never touches the filesystem or agents: it produces
 * an explainable plan; the runtime executes it.
 */
export class Router {
  private readonly semantic: SemanticMatcher;
  private readonly llm: LlmReRanker;

  constructor(options: RouterOptions = {}) {
    this.semantic = options.semanticMatcher ?? defaultSemanticMatcher;
    this.llm = options.llmReranker ?? defaultLlmReranker;
  }

  async route(ctx: RouteContext): Promise<RouterDecision> {
    const started = performance.now();
    const task = ctx.task.trim();
    if (!task) throw new RouterError("Cannot route an empty task. Provide a task description: `skillrouter route \"write tests\"`.");

    this.semanticCheck(ctx);
    const analysis = analyzeTask(task);

    const options = this.optionsFrom(ctx);
    let scores = this.rank(ctx, analysis);

    const semanticUsed = this.semantic.isConfigured(ctx.config) && ctx.config.router.semantic;
    if (semanticUsed) {
      for (const score of scores) {
        const result = await this.semantic.similarity(score.capability, analysis);
        if (result) {
          score.score = Math.min(100, score.score + Math.round(result.score * 0.25));
        }
      }
      scores.sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id));
    }

    let llmUsed = false;
    if (this.llm.isConfigured(ctx.config)) {
      const reranked = await this.llm.rerank(analysis, scores, options.maxActivations);
      if (reranked) {
        scores = reranked;
        llmUsed = true;
      }
    }

    const resolved = resolveConflicts(scores);
    const installedStates = new Map<string, { state: InstalledCapabilityRow["state"]; installed: boolean }>();
    for (const row of ctx.installed.values()) {
      installedStates.set(row.id, { state: row.state, installed: true });
    }

    const plan = buildPlan({
      task: analysis,
      scores: resolved,
      installedStates,
      options,
    });

    const decision = createDecision(task, analysis, ctx, resolved, plan, options, { semanticUsed, llmUsed });

    globalBus.emit({
      event: "router.decided",
      decisionId: decision.decisionId,
      task,
      activations: plan.filter((p) => p.action === "activate").map((p) => p.capabilityId),
      deactivations: plan.filter((p) => p.action === "deactivate").map((p) => p.capabilityId),
    });

    const elapsed = performance.now() - started;
    decision.latencyMs = Math.round(elapsed);
    return decision;
  }

  private semanticCheck(ctx: RouteContext): void {
    if (typeof ctx.config.router.threshold !== "number") {
      throw new RouterError("router.threshold must be a number between 0 and 100");
    }
  }

  private rank(ctx: RouteContext, analysis: TaskAnalysis): CapabilityScore[] {
    const scores: CapabilityScore[] = [];
    for (const capability of ctx.capabilities) {
      const score = scoreSingleCapability(capability, analysis, ctx, preparedFor(capability));
      if (score.breakdown.trust <= -100) continue; // blocked capability
      scores.push(score);
    }
    scores.sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id));
    return scores;
  }

  private optionsFrom(ctx: RouteContext): PlannerOptions {
    const config = ctx.config.router;
    return defaultPlannerOptions({
      threshold: config.threshold,
      maxActivations: config.maxActivations,
      always: config.always,
      never: config.never,
      prefer: config.prefer,
      avoid: config.avoid,
      mode: config.mode,
    });
  }
}

export const router = new Router();