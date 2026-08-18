import type { SemanticMatcher, LlmReRanker, SemanticResult, TaskAnalysis, CapabilityScore, RouteContext } from "./types.ts";
import type { Capability } from "../core/types.ts";
import type { SkillRouterConfig } from "../config/config.ts";
import { analyzeTask, canonicalTechnology } from "./analyzer.ts";
import { prepareCapability } from "./factors.ts";

/**
 * Level 2: lexical semantic similarity without an external model.
 * Uses normalized token overlap weighted by term specificity.
 * Deterministic, offline, and always available.
 */
export class LexicalSemanticMatcher implements SemanticMatcher {
  readonly id = "lexical";

  isConfigured(): boolean {
    return true;
  }

  async similarity(capability: Capability, task: TaskAnalysis): Promise<SemanticResult | null> {
    const prepared = prepareCapability(capability);
    const taskTokens = [...task.normalized.tokens];
    if (taskTokens.length === 0) return null;

    const overlap = taskTokens.filter((t) => prepared.phrases.has(t)).length;
    const specificity = Math.log2(2 + (task.domains.length + task.technologies.length));
    const raw = overlap / Math.sqrt(Math.max(1, taskTokens.length) * Math.max(1, prepared.phrases.size));
    const score = Math.min(1, raw * 6 * specificity);
    if (score < 0.05) return null;
    return { score: Math.round(score * 100), used: true, note: "lexical semantic overlap" };
  }
}

/**
 * Level 3: optional LLM-assisted reranking.
 * Activated only when a model is configured in `router.model`.
 * The model receives capability metadata only — never file contents or secrets.
 */
export class ConfiguredLlmReranker implements LlmReRanker {
  readonly id = "http-llm";

  isConfigured(config: SkillRouterConfig): boolean {
    return typeof config.router.model === "string" && config.router.model.length > 0;
  }

  async rerank(task: TaskAnalysis, scores: CapabilityScore[], limit: number): Promise<CapabilityScore[] | null> {
    const candidateCount = Math.max(3, Math.ceil(scores.length / 2));
    if (scores.length < 2) return null;
    void task;
    void limit;
    // The LLM transport is intentionally not wired to any provider in V0.1.
    // When a model is configured (e.g. a local Ollama endpoint or an HTTP
    // gateway), this method sends { task: {technologies, domains, operations},
    // capabilities: [{id, name, description, compatibility, trust, riskLevel}] }
    // and returns reordered scores. Until then it never silently degrades
    // accuracy: it returns null and the deterministic ranking stands.
    return null;
  }
}

export const defaultSemanticMatcher: SemanticMatcher = new LexicalSemanticMatcher();
export const defaultLlmReranker: LlmReRanker = new ConfiguredLlmReranker();

/** Extract semantic-ish signals for search/find from project context. */
export function taskFromContext(ctx: RouteContext): TaskAnalysis {
  const parts: string[] = [ctx.task];
  if (ctx.project) {
    parts.push(ctx.project.languages.join(" "), ctx.project.frameworks.join(" "), ctx.project.databases.join(" "), ctx.project.cloudProviders.join(" "));
  }
  if (ctx.git) parts.push(ctx.git.signals.join(" "));
  return analyzeTask(parts.join(" "));
}

export function technologySet(scores: CapabilityScore[]): Set<string> {
  const out = new Set<string>();
  for (const score of scores) {
    for (const tech of score.capability.triggers?.technologies ?? []) {
      const canonical = canonicalTechnology(tech);
      if (canonical) out.add(canonical);
    }
  }
  return out;
}