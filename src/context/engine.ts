import type { Storage, RoutingHistoryRow, PreferenceRow } from "../storage/types.ts";
import type { Capability, CapabilityState } from "../core/types.ts";
import type { SkillRouterConfig } from "../config/config.ts";
import type { GitContext } from "../git/context.ts";
import type { ProjectAnalysis } from "../project/analyzer.ts";
import { analyzeProject } from "../project/analyzer.ts";
import { getGitContext } from "../git/context.ts";

export interface ActiveCapability {
  id: string;
  state: CapabilityState;
  version: string;
  agents: string[];
}

export interface EnvironmentInfo {
  node: string;
  platform: string;
  agentIds: string[];
  offline: boolean;
}

/**
 * Normalized snapshot of everything the router needs beyond the raw task
 * text. Collectors run independently; a failing collector never aborts the
 * snapshot — it is recorded in `warnings`.
 */
export interface ContextSnapshot {
  task: string | null;
  cwd: string;
  project: ProjectAnalysis | null;
  git: GitContext | null;
  environment: EnvironmentInfo;
  capabilities: Capability[];
  activeCapabilities: ActiveCapability[];
  history: RoutingHistoryRow[];
  preferences: PreferenceRow[];
  policy: Record<string, unknown>;
  threshold: number;
  sources: string[];
  warnings: string[];
  collectedAt: string;
}

export interface ContextRequest {
  task?: string | null;
  cwd: string;
  offline?: boolean;
  historyLimit?: number;
}

export class ContextEngine {
  private readonly storage: Storage;
  private readonly config: SkillRouterConfig;

  constructor(storage: Storage, config: SkillRouterConfig) {
    this.storage = storage;
    this.config = config;
  }

  async collect(request: ContextRequest): Promise<ContextSnapshot> {
    const warnings: string[] = [];
    const sources: string[] = [];

    const project = await this.collectOr("project", () => analyzeProject(request.cwd), warnings, sources);
    const git = await this.collectOr("git", () => getGitContext(request.cwd), warnings, sources);
    const capabilities = await this.collectOr("capabilities", () => this.storage.allCapabilities(), warnings, sources) ?? [];
    const installed = await this.collectOr("installed", () => this.storage.allInstalled(), warnings, sources) ?? [];
    const history = await this.collectOr("history", () => this.storage.getHistory({ limit: request.historyLimit ?? 25 }), warnings, sources) ?? [];
    const preferences = await this.collectOr("preferences", () => this.storage.allPreferences(), warnings, sources) ?? [];

    const agentIds = Object.entries(this.config.agents)
      .filter(([, enabled]) => enabled)
      .map(([id]) => id);

    return {
      task: request.task ?? null,
      cwd: request.cwd,
      project,
      git,
      environment: {
        node: process.version,
        platform: process.platform,
        agentIds,
        offline: request.offline ?? false,
      },
      capabilities,
      activeCapabilities: installed
        .filter((row) => row.state === "ACTIVE" || row.state === "CANDIDATE")
        .map((row) => ({ id: row.id, state: row.state, version: row.version, agents: row.agents })),
      history,
      preferences,
      policy: this.config.security.policy,
      threshold: this.config.router.threshold,
      sources,
      warnings,
      collectedAt: new Date().toISOString(),
    };
  }

  private async collectOr<T>(
    name: string,
    fn: () => Promise<T>,
    warnings: string[],
    sources: string[],
  ): Promise<T | null> {
    sources.push(name);
    try {
      return await fn();
    } catch (error) {
      warnings.push(`${name}: ${(error as Error).message}`);
      return null;
    }
  }
}