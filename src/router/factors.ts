import type { Capability, Compatibility, RiskLevel, TrustLevel } from "../core/types.ts";
import type { TaskAnalysis, Signal, FactorBreakdown, CapabilityScore, RouteContext } from "./types.ts";
import { normalizePhrases } from "../utils/text.ts";
import { computeRisk } from "../security/risk.ts";
import { matchesGlob } from "../utils/glob.ts";
import { softPreferenceDelta } from "../constraints/constraints.ts";
import type { ProjectAnalysis } from "../project/analyzer.ts";
import type { RouterStrategy } from "../config/config.ts";

export const W = {
  keyword: 12,
  technology: 14,
  intent: 16,
  nameOrId: 20,
  description: 0.5,
  projectFramework: 15,
  projectDependency: 18,
  projectLanguage: 6,
  gitPattern: 18,
  filePattern: 18,
  native: 8,
  compatible: 4,
  adaptable: 1,
  unsupported: -30,
  trustVerified: 8,
  trustTrusted: 5,
  trustCommunity: 2,
  trustUnknown: -6,
  qualityFactor: 8,
  historicalFactor: 8,
  reliabilityFactor: 8,
  costFactor: 5,
  latencyFactor: 5,
  contextPenaltyPerK: 3,
  contextPenaltyCap: 9,
  permissionPenalty: 12,
  // Phase F: context-aware matching (PRD2 §8)
  contextLanguage: 8,
  contextFramework: 8,
  contextRuntime: 6,
  contextMismatchRuntime: -20,
  intentMatch: 16,
};

export type Weights = Record<keyof typeof W, number>;

/**
 * Strategy presets (PRD §13/§50). Balanced is the identity — the weights a
 * deployment would have seen before strategies existed — so existing routing
 * behavior is preserved unless the user opts into another strategy.
 */
export function weightsFor(st: RouterStrategy): Weights {
  switch (st) {
    case "quality":
      return { ...W, qualityFactor: 24, historicalFactor: 16, reliabilityFactor: 16, trustUnknown: -9, permissionPenalty: 14, costFactor: 3, latencyFactor: 3 };
    case "speed":
      return { ...W, latencyFactor: 14, contextPenaltyPerK: 6, contextPenaltyCap: 14, qualityFactor: 4, historicalFactor: 6, reliabilityFactor: 6, permissionPenalty: 10 };
    case "cheap":
      return { ...W, costFactor: 14, contextPenaltyPerK: 8, contextPenaltyCap: 18, qualityFactor: 4, historicalFactor: 6, reliabilityFactor: 6, permissionPenalty: 10 };
    case "minimal":
      return { ...W, keyword: 8, technology: 10, intent: 12, nameOrId: 14, description: 0.3, qualityFactor: 4, historicalFactor: 4, reliabilityFactor: 4, costFactor: 6, latencyFactor: 6, contextPenaltyPerK: 6, contextPenaltyCap: 14 };
    case "safe":
      return { ...W, permissionPenalty: 30, costFactor: 8, latencyFactor: 8, trustUnknown: -9, trustVerified: 10, trustTrusted: 7, qualityFactor: 6, historicalFactor: 6, reliabilityFactor: 6 };
    default:
      return W;
  }
}

export const MAX_SCORE = 100;

export interface Prepared {
  keywords: Set<string>;
  intents: Set<string>;
  technologies: Set<string>;
  phrases: Set<string>;
  filePatterns: string[];
  gitPatterns: string[];
}

export function prepareCapability(capability: Capability): Prepared {
  const keywords = new Set<string>();
  const intents = new Set<string>();
  const technologies = new Set<string>();
  const phrases = new Set<string>();
  const addSource = (text: string) => {
    for (const p of normalizePhrases(text)) phrases.add(p);
  };
  const collectList = (list: string[], target: Set<string>) => {
    for (const item of list) {
      addSource(item);
      for (const p of normalizePhrases(item)) target.add(p);
    }
  };
  collectList(capability.triggers?.keywords ?? [], keywords);
  collectList(capability.triggers?.intents ?? [], intents);
  collectList(capability.triggers?.technologies ?? [], technologies);
  for (const category of capability.metadata?.categories ?? []) addSource(category);
  addSource(capability.id);
  addSource(capability.name);
  addSource(capability.description);
  return {
    keywords,
    intents,
    technologies,
    phrases,
    filePatterns: capability.triggers?.filePatterns ?? [],
    gitPatterns: capability.triggers?.gitPatterns ?? [],
  };
}

export function scoreSingleCapability(
  capability: Capability,
  task: TaskAnalysis,
  ctx: RouteContext,
  prepared: Prepared,
  weights?: Weights,
  constraints?: import("../constraints/constraints.ts").RouteConstraints,
): Pick<CapabilityScore, "capability" | "score" | "signals" | "breakdown" | "compatibility" | "trust" | "riskLevel" | "conflictWith"> {
  const w = weights ?? W;
  const signals: Signal[] = [];
  const breakdown: FactorBreakdown = {
    keyword: 0,
    taskSimilarity: 0,
    technology: 0,
    project: 0,
    git: 0,
    file: 0,
    dependency: 0,
    compatibility: 0,
    trust: 0,
    quality: 0,
    historical: 0,
    cost: 0,
    latency: 0,
    context: 0,
    preference: 0,
    contextCost: 0,
    permissionCost: 0,
    conflict: 0,
  };

  const add = (factor: keyof FactorBreakdown, weight: number, text: string) => {
    breakdown[factor] += weight;
    signals.push({ type: factor, text, weight });
  };

  // --- Level 1: task text matching ---
  const taskTokens = task.normalized.tokens;
  const matchedKeywords = [...taskTokens].filter((t) => prepared.keywords.has(t));
  const matchedTech = [...taskTokens].filter((t) => prepared.technologies.has(t));
  const matchedIntents = [...taskTokens].filter((t) => prepared.intents.has(t));
  const matchedDescription = [...taskTokens].filter(
    (t) => prepared.phrases.has(t) && !matchedKeywords.includes(t) && !matchedTech.includes(t) && !matchedIntents.includes(t),
  );

  if (matchedKeywords.length > 0) {
    add("keyword", Math.min(3, matchedKeywords.length) * w.keyword, `matched ${matchedKeywords.length} keyword(s): ${matchedKeywords.slice(0, 3).join(", ")}`);
  }
  if (matchedTech.length > 0) {
    add("technology", Math.min(3, matchedTech.length) * w.technology, `matched ${matchedTech.length} technology term(s): ${matchedTech.slice(0, 3).join(", ")}`);
  }
  if (matchedIntents.length > 0) {
    add("taskSimilarity", Math.min(3, matchedIntents.length) * w.intent, `matched ${matchedIntents.length} intent phrase(s): ${matchedIntents.slice(0, 3).join(", ")}`);
  }
  if (matchedDescription.length > 0) {
    add("taskSimilarity", Math.min(8, matchedDescription.length * w.description), `${matchedDescription.length} term(s) matched the capability description`);
  }

  const idTokens = new Set<string>([...normalizePhrases(capability.id)]);
  const nameTokens = new Set<string>([...normalizePhrases(capability.name)]);
  if ([...taskTokens].some((t) => idTokens.has(t) || nameTokens.has(t))) {
    add("taskSimilarity", w.nameOrId, `capability name "${capability.name}" matches task`);
  }

  // --- Project context ---
  if (ctx.project) {
    projectFactor(capability, ctx.project, prepared, add, w);
  }

  // --- Git context ---
  if (ctx.git && (ctx.git.changed.length > 0 || ctx.git.staged.length > 0) && prepared.gitPatterns.length > 0) {
    const gitFiles = [...new Set([...ctx.git.changed, ...ctx.git.staged])];
    const hits = gitFiles.filter((f) => matchesGlob(f, prepared.gitPatterns)).slice(0, 3);
    if (hits.length > 0) {
      add("git", Math.min(2, hits.length) * w.gitPattern, `changed files match git patterns: ${hits.join(", ")}`);
    }
  }

  // --- Capability file patterns vs project config ---
  if (prepared.filePatterns.length > 0 && ctx.project) {
    const hits = ctx.project.configFiles.filter((f) => matchesGlob(f, prepared.filePatterns)).slice(0, 3);
    if (hits.length > 0) {
      add("file", w.filePattern, `project files match capability patterns: ${hits.join(", ")}`);
    }
  }

  // --- Dependency match ---
  const depHits = (ctx.project?.dependencies ?? []).filter((d) => prepared.phrases.has(d) || prepared.technologies.has(d) || depRelates(d, capability)).slice(0, 3);
  if (depHits.length > 0) {
    add("dependency", Math.min(2, depHits.length) * w.projectDependency, `project dependencies include: ${depHits.join(", ")}`);
  }

  // --- Compatibility with target agent ---
  const agent = ctx.agents[0] ?? "generic";
  const compat: Compatibility = capability.compatibility[agent] ?? capability.compatibility["generic"] ?? "adaptable";
  if (compat === "native") add("compatibility", w.native, `native support in ${agent}`);
  else if (compat === "compatible") add("compatibility", w.compatible, `compatible with ${agent} via adapter`);
  else if (compat === "adaptable") add("compatibility", w.adaptable, `adaptable in ${agent}`);
  else add("compatibility", w.unsupported, `unsupported in ${agent}`);

  // --- Trust ---
  const trust: TrustLevel = capability.trust ?? "unknown";
  if (trust === "verified") add("trust", w.trustVerified, "verified publisher");
  else if (trust === "trusted") add("trust", w.trustTrusted, "trusted by your configuration");
  else if (trust === "community") add("trust", w.trustCommunity, "community capability");
  else if (trust === "blocked") add("trust", -100, "blocked capability");
  else add("trust", w.trustUnknown, "publisher is unverified");

  // --- Quality & history ---
  const quality = capability.metadata?.quality;
  if (quality !== undefined) add("quality", (quality / 100) * w.qualityFactor, `declared quality ${quality}/100`);

  // --- Intent match (Phase E/F): declared capability categories vs classified intent ---
  const intent = ctx.intent;
  if (intent && capability.capabilities && capability.capabilities.length > 0) {
    const categories = new Set(capability.capabilities.map((c) => c.toLowerCase()));
    if (categories.has(intent.intent)) {
      add("taskSimilarity", w.intentMatch, `capability category matches intent "${intent.intent}"`);
    }
  }

  // --- Context match (Phase D/F): declared requirements vs normalized context ---
  if (ctx.context && capability.requirements) {
    const ctxList = (key: string): string[] => {
      const value = ctx.context!.fields[key];
      return Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    };
    const langs = new Set(ctxList("project.language"));
    const frameworks = new Set(ctxList("project.framework"));
    const runtime = ctxList("runtime.os")[0] ?? null;
    const reqLangs = capability.requirements.language ?? [];
    const reqFrameworks = capability.requirements.framework ?? [];
    const reqRuntimes = capability.requirements.runtime ?? [];

    const langHits = reqLangs.filter((l) => langs.has(l.toLowerCase()));
    if (langHits.length > 0) {
      add("context", Math.min(2, langHits.length) * w.contextLanguage, `context language match: ${langHits.join(", ")}`);
    }
    const frameworkHits = reqFrameworks.filter((f) => frameworks.has(f.toLowerCase()));
    if (frameworkHits.length > 0) {
      add("context", Math.min(3, frameworkHits.length) * w.contextFramework, `context framework match: ${frameworkHits.join(", ")}`);
    }
    if (runtime && reqRuntimes.length > 0) {
      if (reqRuntimes.includes(runtime)) {
        add("context", w.contextRuntime, `context runtime match: ${runtime}`);
      } else if (reqRuntimes.length > 0) {
        add("context", w.contextMismatchRuntime, `requires runtime(s) ${reqRuntimes.join(", ")} but environment is ${runtime}`);
      }
    }
  }

  // --- Historical: fresh dynamic metrics win; declared successRate is the fallback; declared reliability last ---
  const metric = ctx.metrics?.get(capability.id);
  const summary = ctx.outcomes?.get(capability.id);
  if (metric && metric.tasks > 0) {
    const rate = metric.successes / metric.tasks;
    const rounded = Math.round(rate * 1000) / 1000;
    add("historical", rounded * w.historicalFactor, `historical success rate ${(rate * 100).toFixed(0)}% (${metric.tasks} observations)`);
  } else if (capability.metadata?.successRate !== undefined) {
    add("historical", (capability.metadata.successRate / 100) * w.historicalFactor, `declared success rate ${capability.metadata.successRate}%`);
  } else if (capability.metadata?.reliability !== undefined) {
    add("historical", capability.metadata.reliability * w.historicalFactor, `declared reliability ${Math.round(capability.metadata.reliability * 100)}%`);
  }
  // --- Phase G: observed reputation nudge (verification/rating), bounded and gated by learning.enabled ---
  if (summary && ctx.config.learning?.enabled) {
    let delta = 0;
    const parts: string[] = [];
    if (summary.verificationRate !== null) {
      delta += summary.verificationRate * w.historicalFactor * 0.25;
      parts.push(`verification ${Math.round(summary.verificationRate * 100)}%`);
    }
    if (summary.avgRating !== null) {
      delta += (summary.avgRating / 2) * w.historicalFactor * 0.25;
      parts.push(`rating ${summary.avgRating > 0 ? "+" : ""}${summary.avgRating}`);
    }
    if (parts.length > 0) {
      delta = Math.max(-ctx.config.learning.reputationWeight, Math.min(ctx.config.learning.reputationWeight, delta));
      if (delta !== 0) add("historical", Math.round(delta * 1000) / 1000, `reputation: ${parts.join(", ")}`);
    }
  }

  // --- Cost & latency (PRD §9/§50; observed latency replaces declared when learning is enabled) ---
  const cost = capability.metadata?.cost;
  if (cost !== undefined && cost > 0) {
    add("cost", -cost * w.costFactor, `declared cost ${cost}/5`);
  }
  const declaredLatency = capability.metadata?.latency;
  if (summary?.avgLatencyMs !== null && summary && ctx.config.learning?.enabled) {
    const penalty = Math.min(w.contextPenaltyCap, (summary.avgLatencyMs! / 1000) * ctx.config.learning.latencyWeight);
    add("latency", -Math.round(penalty * 1000) / 1000, `observed average latency ${Math.round(summary.avgLatencyMs!)}ms over ${summary.usage} executions`);
  } else if (declaredLatency !== undefined && declaredLatency > 0) {
    add("latency", -declaredLatency * w.latencyFactor, `declared latency ${declaredLatency}/5`);
  }

  // --- Penalties ---
  const estimatedTokens = capability.context?.estimatedTokens ?? 0;
  if (estimatedTokens > 0) {
    const penalty = Math.min(w.contextPenaltyCap, (estimatedTokens / 1000) * w.contextPenaltyPerK);
    add("contextCost", -penalty, `context cost ~${estimatedTokens} tokens`);
  }

  const risk = computeRisk(capability);
  const permPenalty = (risk.score / 100) * w.permissionPenalty;
  if (permPenalty > 0) add("permissionCost", -permPenalty, `risk ${risk.score}/100 (${risk.level})`);

  // --- Soft preferences (Phase E): never eliminate, only nudge scores ---
  if (constraints) {
    const preference = softPreferenceDelta(capability, constraints);
    if (preference !== 0) {
      const reasons: string[] = [];
      if ((constraints.requiredLanguage ?? []).some((l) => capability.requirements?.language?.includes(l.toLowerCase()))) reasons.push("matches a preferred language");
      if ((constraints.requiredFramework ?? []).some((f) => capability.requirements?.framework?.includes(f.toLowerCase()))) reasons.push("matches a preferred framework");
      add("preference", preference, reasons.join(" and "));
    }
  }

  const raw = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const score = Math.max(0, Math.min(MAX_SCORE, Math.round(raw)));

  return {
    capability,
    score,
    signals: signals.sort((a, b) => b.weight - a.weight),
    breakdown,
    compatibility: compat,
    trust,
    riskLevel: risk.level,
    conflictWith: null,
  };
}

function depRelates(dep: string, capability: Capability): boolean {
  const clean = (s: string) => s.replace(/[^a-z0-9]/g, "");
  const depClean = clean(dep);
  const idClean = clean(capability.id);
  if (depClean.length < 3 || idClean.length < 3) return false;
  return idClean.includes(depClean) || depClean.includes(idClean);
}

function projectFactor(
  capability: Capability,
  project: ProjectAnalysis,
  prepared: Prepared,
  add: (factor: keyof FactorBreakdown, weight: number, text: string) => void,
  w: Weights,
): void {
  const langHits = project.languages.filter((l) => prepared.technologies.has(l.toLowerCase()) || prepared.phrases.has(l.toLowerCase()));
  if (langHits.length > 0) {
    add("project", w.projectLanguage, `project language: ${langHits.join(", ")}`);
  }

  const matchList = (values: string[], label: string, limit = 3): void => {
    const hits = values.filter((v) => prepared.phrases.has(v) || prepared.technologies.has(v)).slice(0, limit);
    if (hits.length > 0) {
      add("project", Math.min(limit, hits.length) * w.projectFramework, `project ${label}: ${hits.join(", ")}`);
    }
  };

  matchList(project.frameworks, "framework");
  matchList(project.databases, "database");
  matchList(project.cloudProviders, "cloud provider", 2);
  matchList(project.testingFrameworks, "testing framework", 2);
}