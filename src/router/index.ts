import type { RouterDecision, RouteContext, TaskAnalysis, CapabilityScore, SemanticMatcher, LlmReRanker } from "./types.ts";
import type { InstalledCapabilityRow } from "../storage/types.ts";
import type { Capability } from "../core/types.ts";
import { analyzeTask } from "./analyzer.ts";
import { prepareCapability, scoreSingleCapability, weightsFor } from "./factors.ts";
import { scoreBreakdown } from "../scoring/breakdown.ts";
import { evaluateConstraints } from "../constraints/constraints.ts";
import { classifyIntent } from "../intent/classifier.ts";
import { resolveConflicts } from "./conflicts.ts";
import { buildPlan, createDecision, defaultPlannerOptions, type PlannerOptions } from "./planner.ts";
import { defaultSemanticMatcher, defaultLlmReranker } from "./semantic.ts";
import { RouterError } from "../utils/errors.ts";
import { globalBus } from "../core/events.ts";
import { analyzePool, type NeighborAnalysis } from "../registry/neighbors.ts";

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

const DILUTION = new WeakMap<Capability[], Map<string, NeighborAnalysis>>();

function dilutionCache(capabilities: Capability[]): Map<string, NeighborAnalysis> {
  let cached = DILUTION.get(capabilities);
  if (!cached) {
    cached = analyzePool(capabilities);
    DILUTION.set(capabilities, cached);
  }
  return cached;
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

    const intent = ctx.intent ?? classifyIntent(task, ctx.context);
    ctx = { ...ctx, intent };

    const options = this.optionsFrom(ctx);
    let scores = this.rank(ctx, analysis);

    // PRD §4.4: near-duplicate capabilities compete for the same tasks. The
    // weaker of a similar pair pays a dilution penalty so the stronger,
    // better-evidenced pick stays ahead. Disabled below two candidates.
    if (ctx.config.router.distinctiveness && scores.length > 1) {
      this.dilute(ctx, scores);
    }

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
    const weights = weightsFor(ctx.config.router.strategy);
    for (const score of resolved) {
      score.scoreBreakdownV2 = scoreBreakdown(score, weights);
    }
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

  /**
   * Dilution pass (PRD §4.4). For each candidate that has a neighbor with a
   * strictly higher score, scale the candidate down by up to 35% proportional
   * to the overlay — the attention a duplicated area can pay out is shared.
   * Neighbor similarity comes from the registry overlay (deterministic).
   */
  private dilute(ctx: RouteContext, scores: CapabilityScore[]): void {
    const cache = dilutionCache(ctx.capabilities);
    for (const score of scores) {
      if (score.score <= 0) continue;
      const analysis = cache.get(score.capability.id);
      if (!analysis?.best) continue;
      const winner = scores.find((s) => s.capability.id === analysis.best!.id);
      if (!winner || winner.score <= score.score) continue;
      const dilution = Math.round(score.score * (1 - 0.35 * analysis.best.similarity));
      if (dilution < score.score) {
        score.signals.push({
          type: "neighbor",
          text: `area shared with ${analysis.best.id} (${Math.round(analysis.best.similarity * 100)}% overlay, ${winner.score} vs ${score.score}); attention diluted`,
          weight: -Math.round(score.score - dilution),
        });
        score.score = dilution;
      }
    }
  }

  private rank(ctx: RouteContext, analysis: TaskAnalysis): CapabilityScore[] {
    const weights = weightsFor(ctx.config.router.strategy);
    const scores: CapabilityScore[] = [];
    for (const capability of ctx.capabilities) {
      // Phase E: hard constraints eliminate candidates before scoring.
      if (ctx.constraints) {
        const constraint = evaluateConstraints(capability, ctx.constraints);
        if (!constraint.allowed) continue;
      }
      const score = scoreSingleCapability(capability, analysis, ctx, preparedFor(capability), weights, ctx.constraints);
      if (score.breakdown.trust <= -100) continue; // blocked capability
      scores.push(score);
    }
    scores.sort((a, b) => b.score - a.score || a.capability.id.localeCompare(b.capability.id));
    return scores;
  }

  private optionsFrom(ctx: RouteContext): PlannerOptions {
    const config = ctx.config.router;
    // Phase E: requiredCapabilities are forced into the activation set,
    // like an ephemeral `always` list scoped to this route.
    const always = [...(config.always ?? []), ...(ctx.constraints?.requiredCapabilities ?? [])];
    return defaultPlannerOptions({
      threshold: config.threshold,
      maxActivations: config.maxActivations,
      always,
      never: config.never,
      prefer: config.prefer,
      avoid: config.avoid,
      mode: config.mode,
    });
  }
}

export const router = new Router();