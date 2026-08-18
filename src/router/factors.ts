import type { Capability, Compatibility, RiskLevel, TrustLevel } from "../core/types.ts";
import type { TaskAnalysis, Signal, FactorBreakdown, CapabilityScore, RouteContext } from "./types.ts";
import { normalizePhrases } from "../utils/text.ts";
import { computeRisk } from "../security/risk.ts";
import { matchesGlob } from "../utils/glob.ts";
import type { ProjectAnalysis } from "../project/analyzer.ts";

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
  contextPenaltyPerK: 3,
  contextPenaltyCap: 9,
  permissionPenalty: 12,
} as const;

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
): Pick<CapabilityScore, "capability" | "score" | "signals" | "breakdown" | "compatibility" | "trust" | "riskLevel" | "conflictWith"> {
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
    add("keyword", Math.min(3, matchedKeywords.length) * W.keyword, `matched ${matchedKeywords.length} keyword(s): ${matchedKeywords.slice(0, 3).join(", ")}`);
  }
  if (matchedTech.length > 0) {
    add("technology", Math.min(3, matchedTech.length) * W.technology, `matched ${matchedTech.length} technology term(s): ${matchedTech.slice(0, 3).join(", ")}`);
  }
  if (matchedIntents.length > 0) {
    add("taskSimilarity", Math.min(3, matchedIntents.length) * W.intent, `matched ${matchedIntents.length} intent phrase(s): ${matchedIntents.slice(0, 3).join(", ")}`);
  }
  if (matchedDescription.length > 0) {
    add("taskSimilarity", Math.min(8, matchedDescription.length * W.description), `${matchedDescription.length} term(s) matched the capability description`);
  }

  const idTokens = new Set<string>([...normalizePhrases(capability.id)]);
  const nameTokens = new Set<string>([...normalizePhrases(capability.name)]);
  if ([...taskTokens].some((t) => idTokens.has(t) || nameTokens.has(t))) {
    add("taskSimilarity", W.nameOrId, `capability name "${capability.name}" matches task`);
  }

  // --- Project context ---
  if (ctx.project) {
    projectFactor(capability, ctx.project, prepared, add);
  }

  // --- Git context ---
  if (ctx.git && (ctx.git.changed.length > 0 || ctx.git.staged.length > 0) && prepared.gitPatterns.length > 0) {
    const gitFiles = [...new Set([...ctx.git.changed, ...ctx.git.staged])];
    const hits = gitFiles.filter((f) => matchesGlob(f, prepared.gitPatterns)).slice(0, 3);
    if (hits.length > 0) {
      add("git", Math.min(2, hits.length) * W.gitPattern, `changed files match git patterns: ${hits.join(", ")}`);
    }
  }

  // --- Capability file patterns vs project config ---
  if (prepared.filePatterns.length > 0 && ctx.project) {
    const hits = ctx.project.configFiles.filter((f) => matchesGlob(f, prepared.filePatterns)).slice(0, 3);
    if (hits.length > 0) {
      add("file", W.filePattern, `project files match capability patterns: ${hits.join(", ")}`);
    }
  }

  // --- Dependency match ---
  const depHits = (ctx.project?.dependencies ?? []).filter((d) => prepared.phrases.has(d) || prepared.technologies.has(d) || depRelates(d, capability)).slice(0, 3);
  if (depHits.length > 0) {
    add("dependency", Math.min(2, depHits.length) * W.projectDependency, `project dependencies include: ${depHits.join(", ")}`);
  }

  // --- Compatibility with target agent ---
  const agent = ctx.agents[0] ?? "generic";
  const compat: Compatibility = capability.compatibility[agent] ?? capability.compatibility["generic"] ?? "adaptable";
  if (compat === "native") add("compatibility", W.native, `native support in ${agent}`);
  else if (compat === "compatible") add("compatibility", W.compatible, `compatible with ${agent} via adapter`);
  else if (compat === "adaptable") add("compatibility", W.adaptable, `adaptable in ${agent}`);
  else add("compatibility", W.unsupported, `unsupported in ${agent}`);

  // --- Trust ---
  const trust: TrustLevel = capability.trust ?? "unknown";
  if (trust === "verified") add("trust", W.trustVerified, "verified publisher");
  else if (trust === "trusted") add("trust", W.trustTrusted, "trusted by your configuration");
  else if (trust === "community") add("trust", W.trustCommunity, "community capability");
  else if (trust === "blocked") add("trust", -100, "blocked capability");
  else add("trust", W.trustUnknown, "publisher is unverified");

  // --- Quality & history (declared metadata in V0.1) ---
  const quality = capability.metadata?.quality;
  if (quality !== undefined) add("quality", (quality / 100) * W.qualityFactor, `declared quality ${quality}/100`);

  const successRate = capability.metadata?.successRate;
  if (successRate !== undefined) add("historical", (successRate / 100) * W.historicalFactor, `historical success rate ${successRate}%`);

  // --- Penalties ---
  const estimatedTokens = capability.context?.estimatedTokens ?? 0;
  if (estimatedTokens > 0) {
    const penalty = Math.min(W.contextPenaltyCap, (estimatedTokens / 1000) * W.contextPenaltyPerK);
    add("contextCost", -penalty, `context cost ~${estimatedTokens} tokens`);
  }

  const risk = computeRisk(capability);
  const permPenalty = (risk.score / 100) * W.permissionPenalty;
  if (permPenalty > 0) add("permissionCost", -permPenalty, `risk ${risk.score}/100 (${risk.level})`);

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
): void {
  const langHits = project.languages.filter((l) => prepared.technologies.has(l.toLowerCase()) || prepared.phrases.has(l.toLowerCase()));
  if (langHits.length > 0) {
    add("project", W.projectLanguage, `project language: ${langHits.join(", ")}`);
  }

  const matchList = (values: string[], label: string, limit = 3): void => {
    const hits = values.filter((v) => prepared.phrases.has(v) || prepared.technologies.has(v)).slice(0, limit);
    if (hits.length > 0) {
      add("project", Math.min(limit, hits.length) * W.projectFramework, `project ${label}: ${hits.join(", ")}`);
    }
  };

  matchList(project.frameworks, "framework");
  matchList(project.databases, "database");
  matchList(project.cloudProviders, "cloud provider", 2);
  matchList(project.testingFrameworks, "testing framework", 2);
}