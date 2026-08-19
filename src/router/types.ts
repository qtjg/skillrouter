import type { Capability, Compatibility, NormalizedQuery, RiskLevel, TrustLevel } from "../core/types.ts";
import type { ProjectAnalysis } from "../project/analyzer.ts";
import type { GitContext } from "../git/context.ts";
import type { InstalledCapabilityRow } from "../storage/types.ts";
import type { MetricsRow } from "../storage/types.ts";
import type { SkillRouterConfig } from "../config/config.ts";
import type { AgentId } from "../core/types.ts";

export type Operation = "implementation" | "configuration" | "testing" | "debugging" | "refactoring" | "security-review" | "deployment" | "design" | "documentation" | "review" | "migration";

export interface TaskAnalysis {
  task: string;
  normalized: NormalizedQuery;
  tokens: string[];
  technologies: string[];
  domains: string[];
  operations: Operation[];
  riskEstimate: RiskLevel;
}

export interface Signal {
  type: string;
  text: string;
  weight: number;
}

export interface FactorBreakdown {
  keyword: number;
  taskSimilarity: number;
  technology: number;
  project: number;
  git: number;
  file: number;
  dependency: number;
  compatibility: number;
  trust: number;
  quality: number;
  historical: number;
  cost: number;
  latency: number;
  contextCost: number;
  permissionCost: number;
  conflict: number;
}

export interface CapabilityScore {
  capability: Capability;
  score: number;
  signals: Signal[];
  breakdown: FactorBreakdown;
  compatibility: Compatibility;
  trust: TrustLevel;
  riskLevel: RiskLevel;
  conflictWith: string | null;
}

export type PlanActionType = "activate" | "deactivate" | "keep" | "suspend" | "keep-inactive";

export interface PlanAction {
  capabilityId: string;
  action: PlanActionType;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: Signal[];
  permissions: string[];
  state: string;
}

export interface RouterDecision {
  decisionId: string;
  task: string;
  mode: string;
  /** Scoring strategy applied (PRD §13/§50). */
  strategy: string;
  analysis: TaskAnalysis;
  scores: CapabilityScore[];
  plan: PlanAction[];
  contextEstimate: number;
  contextBudget: number;
  semanticUsed: boolean;
  llmUsed: boolean;
  latencyMs: number;
  createdAt: string;
  /** Declared fallback chains for every selected capability (PRD §21). */
  fallbacks: Record<string, string[]>;
}

export interface RouteContext {
  task: string;
  cwd: string;
  project: ProjectAnalysis | null;
  git: GitContext | null;
  capabilities: Capability[];
  installed: Map<string, InstalledCapabilityRow>;
  agents: AgentId[];
  config: SkillRouterConfig;
  /** Fresh reliability observations; when present they override declared successRate. */
  metrics?: Map<string, MetricsRow>;
  /** Normalized context for the current workspace (Phase D); optional in tests. */
  context?: import("../context/types.ts").NormalizedContext;
}

export interface SemanticResult {
  score: number;
  used: boolean;
  note?: string;
}

export interface SemanticMatcher {
  readonly id: string;
  isConfigured(config: SkillRouterConfig): boolean;
  similarity(capability: Capability, task: TaskAnalysis): Promise<SemanticResult | null>;
}

export interface LlmReRanker {
  readonly id: string;
  isConfigured(config: SkillRouterConfig): boolean;
  rerank(task: TaskAnalysis, scores: CapabilityScore[], limit: number): Promise<CapabilityScore[] | null>;
}

export interface AgentCompatibility {
  agent: AgentId;
  supported: boolean;
  level: Compatibility;
}