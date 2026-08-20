import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { ConfigError } from "../utils/errors.ts";
import { pathExists } from "../utils/fs.ts";
import { deepMerge } from "../utils/object.ts";

export type RouterMode = "manual" | "assisted" | "automatic" | "autonomous";

/** Scoring strategy presets (PRD §13/§50). */
export type RouterStrategy = "balanced" | "quality" | "speed" | "cheap" | "minimal" | "safe";

export const ROUTER_STRATEGIES: RouterStrategy[] = ["balanced", "quality", "speed", "cheap", "minimal", "safe"];

export interface RouterConfig {
  mode: RouterMode;
  always: string[];
  never: string[];
  prefer: string[];
  avoid: string[];
  threshold: number;
  semantic: boolean;
  model: string | null;
  maxActivations: number;
  strategy: RouterStrategy;
  /** NO_MATCH/WEAK_MATCH/GOOD_MATCH/EXACT_MATCH boundaries (PRD §12). */
  classificationThresholds: {
    noMatch: number;
    weak: number;
    good: number;
    exact: number;
  };
  context: {
    enabled: boolean;
    timeoutMs: number;
  };
}

export interface CapabilitiesConfig {
  autoInstall: boolean;
  autoActivate: boolean;
}

export interface SecurityConfig {
  requireConsent: boolean;
  blocked: string[];
  policy: Record<string, unknown>;
}

/**
 * Self-learning (PRD §22–23, Phase G). Everything is opt-in-scoped: with
 * `enabled: false` scoring behaves exactly as before this phase landed.
 */
export interface LearningConfig {
  enabled: boolean;
  /** Max points observed reputation may add to the `historical` factor. */
  reputationWeight: number;
  /** Points per 1000 ms of observed average latency (penalty). */
  latencyWeight: number;
  /** Bounded outcome history kept per capability. */
  maxOutcomes: number;
}

export interface AgentsConfig {
  opencode: boolean;
  gemini: boolean;
  claude: boolean;
  codex: boolean;
  mcp: boolean;
  generic: boolean;
}

export type EmbeddingProviderName = "local" | "openai";

export interface EmbeddingsConfig {
  enabled: boolean;
  /** "local" = deterministic hashing embeddings (offline); "openai" = API-backed with local fallback. */
  provider: EmbeddingProviderName;
  /** Model name for API-backed providers. */
  model: string;
  /** Vector length for local embeddings / requested dimensionality for API providers. */
  dimension: number;
  /** Env var holding the API key (used when provider !== "local"). */
  apiKeyEnv: string;
  /** Base URL for OpenAI-compatible embeddings endpoints. */
  baseUrl: string;
}

export interface RetrievalConfig {
  /** Default result count of a retrieval call when topK is not given. */
  topK: number;
  embeddings: EmbeddingsConfig;
  rerank: {
    enabled: boolean;
    provider: string;
  };
}

export interface SourcesConfigItem {
  name: string;
  type: "git" | "catalog" | "directory";
  url?: string;
  path?: string;
  enabled?: boolean;
}

export interface SkillRouterConfig {
  project: { name?: string | null };
  router: RouterConfig;
  capabilities: CapabilitiesConfig;
  security: SecurityConfig;
  learning: LearningConfig;
  agents: AgentsConfig;
  retrieval: RetrievalConfig;
  sources: SourcesConfigItem[];
}

export const DEFAULT_CONFIG: SkillRouterConfig = {
  project: { name: null },
  router: {
    mode: "assisted",
    always: [],
    never: [],
    prefer: [],
    avoid: [],
    threshold: 40,
    semantic: false,
    model: null,
    maxActivations: 5,
    strategy: "balanced",
    classificationThresholds: {
      noMatch: 25,
      weak: 50,
      good: 75,
      exact: 90,
    },
    context: {
      enabled: true,
      timeoutMs: 1000,
    },
  },
  capabilities: {
    autoInstall: false,
    autoActivate: true,
  },
  security: {
    requireConsent: true,
    blocked: [],
    policy: {},
  },
  learning: {
    enabled: true,
    reputationWeight: 8,
    latencyWeight: 5,
    maxOutcomes: 1000,
  },
  agents: {
    opencode: true,
    gemini: true,
    claude: true,
    codex: false,
    mcp: false,
    generic: true,
  },
  retrieval: {
    topK: 10,
    embeddings: {
      enabled: false,
      provider: "local",
      model: "text-embedding-3-small",
      dimension: 256,
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
    },
    rerank: {
      enabled: true,
      provider: "lexical",
    },
  },
  sources: [],
};

export function configPaths(cwd: string): { projectConfig: string; globalConfig: string; stateDir: string } {
  const xdg = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "skillrouter") : join(homedir(), ".config", "skillrouter");
  const state = process.env.XDG_STATE_HOME ? join(process.env.XDG_STATE_HOME, "skillrouter") : join(homedir(), ".local", "state", "skillrouter");
  return { projectConfig: join(cwd, "skillrouter.yaml"), globalConfig: join(xdg, "config.yaml"), stateDir: state };
}

export async function findProjectConfigPath(startDir: string): Promise<string | null> {
  let current = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(current, "skillrouter.yaml");
    if (await pathExists(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

function isDir(item: SourcesConfigItem): item is SourcesConfigItem & { path: string } {
  return item.type === "directory";
}

function sanitize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return undefined;
}

export const EMBEDDING_PROVIDERS: EmbeddingProviderName[] = ["local", "openai"];

export async function loadConfig(cwd = process.cwd()): Promise<{ config: SkillRouterConfig; projectConfigPath: string | null; globalConfigPath: string }> {
  const { projectConfig, globalConfig, stateDir } = configPaths(cwd);
  const raw = await readTextYaml(globalConfig);
  const projectPath = await findProjectConfigPath(cwd);
  const rawProject = projectPath ? await readTextYaml(projectPath) : null;

  let global: SkillRouterConfig = deepMerge(structuredClone(DEFAULT_CONFIG), raw);
  let merged: SkillRouterConfig = deepMerge(global, rawProject);

  merged = validateConfig(merged, projectPath ?? globalConfig);

  return { config: merged, projectConfigPath: projectPath, globalConfigPath: globalConfig };
}

async function readTextYaml(path: string): Promise<SkillRouterConfig | null> {
  try {
    const content = await readFile(path, "utf8");
    const raw = parse(content); 
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError(`Invalid YAML in ${path}: root must be a mapping`);
    return raw as SkillRouterConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(`Failed to read config ${path}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

function validateConfig(config: SkillRouterConfig, path: string): SkillRouterConfig {
  const routerModes = ["manual", "assisted", "automatic", "autonomous"];
  if (!routerModes.includes(config.router.mode)) {
    throw new ConfigError(`router.mode in ${path} must be one of ${routerModes.join(", ")}`);
  }
  if (!ROUTER_STRATEGIES.includes(config.router.strategy)) {
    throw new ConfigError(`router.strategy in ${path} must be one of ${ROUTER_STRATEGIES.join(", ")}`);
  }
  if (typeof config.router.context?.enabled !== "boolean") {
    throw new ConfigError(`router.context.enabled in ${path} must be a boolean`);
  }
  const timeoutMs = config.router.context?.timeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new ConfigError(`router.context.timeoutMs in ${path} must be a number between 1 and 30000`);
  }
  if (typeof config.router.threshold !== "number" || config.router.threshold < 0 || config.router.threshold > 100) {
    throw new ConfigError(`router.threshold in ${path} must be a number between 0 and 100`);
  }
  const ct = config.router.classificationThresholds ?? {};
  for (const [key, value] of Object.entries(ct) as Array<[string, unknown]>) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new ConfigError(`router.classificationThresholds.${key} in ${path} must be a number between 0 and 100`);
    }
  }
  const ordered = [ct.noMatch, ct.weak, ct.good, ct.exact].every(
    (_, i, arr) => i === 0 || (arr[i - 1]! <= arr[i]!),
  );
  if (typeof ct.noMatch === "number" && !ordered) {
    throw new ConfigError(`router.classificationThresholds in ${path} must be ordered noMatch <= weak <= good <= exact`);
  }
  if (config.router.maxActivations < 0) throw new ConfigError(`router.maxActivations in ${path} must be >= 0`);
  if (typeof config.learning?.enabled !== "boolean") {
    throw new ConfigError(`learning.enabled in ${path} must be a boolean`);
  }
  const reputationWeight = config.learning?.reputationWeight;
  if (typeof reputationWeight !== "number" || !Number.isFinite(reputationWeight) || reputationWeight < 0 || reputationWeight > 50) {
    throw new ConfigError(`learning.reputationWeight in ${path} must be a number between 0 and 50`);
  }
  const latencyWeight = config.learning?.latencyWeight;
  if (typeof latencyWeight !== "number" || !Number.isFinite(latencyWeight) || latencyWeight < 0 || latencyWeight > 50) {
    throw new ConfigError(`learning.latencyWeight in ${path} must be a number between 0 and 50`);
  }
  const maxOutcomes = config.learning?.maxOutcomes;
  if (typeof maxOutcomes !== "number" || !Number.isFinite(maxOutcomes) || maxOutcomes < 10 || maxOutcomes > 100000) {
    throw new ConfigError(`learning.maxOutcomes in ${path} must be a number between 10 and 100000`);
  }
  if (typeof config.retrieval?.topK !== "number" || !Number.isFinite(config.retrieval.topK) || config.retrieval.topK < 1 || config.retrieval.topK > 100) {
    throw new ConfigError(`retrieval.topK in ${path} must be a number between 1 and 100`);
  }
  const embeddings = config.retrieval?.embeddings;
  if (typeof embeddings?.enabled !== "boolean") {
    throw new ConfigError(`retrieval.embeddings.enabled in ${path} must be a boolean`);
  }
  if (!EMBEDDING_PROVIDERS.includes(embeddings.provider)) {
    throw new ConfigError(`retrieval.embeddings.provider in ${path} must be one of ${EMBEDDING_PROVIDERS.join(", ")}`);
  }
  if (typeof embeddings.dimension !== "number" || !Number.isFinite(embeddings.dimension) || embeddings.dimension < 64 || embeddings.dimension > 4096) {
    throw new ConfigError(`retrieval.embeddings.dimension in ${path} must be a number between 64 and 4096`);
  }
  if (!embeddings.model) throw new ConfigError(`retrieval.embeddings.model in ${path} must not be empty`);
  if (!embeddings.apiKeyEnv) throw new ConfigError(`retrieval.embeddings.apiKeyEnv in ${path} must not be empty`);
  if (!/^https?:\/\//.test(embeddings.baseUrl)) throw new ConfigError(`retrieval.embeddings.baseUrl in ${path} must be an http(s) URL`);
  if (typeof config.retrieval?.rerank?.enabled !== "boolean") {
    throw new ConfigError(`retrieval.rerank.enabled in ${path} must be a boolean`);
  }
  if (config.retrieval.rerank.provider !== "lexical") {
    throw new ConfigError(`retrieval.rerank.provider in ${path} must be "lexical"`);
  }
  for (const item of config.sources) {
    if (!item.name || !["git", "catalog", "directory"].includes(item.type)) {
      throw new ConfigError(`Invalid source entry in ${path}: name and type ("git" | "catalog" | "directory") are required`);
    }
    if (item.type === "git" && !item.url) throw new ConfigError(`Git source "${item.name}" in ${path} requires a url`);
    if (item.type === "directory" && !item.path) throw new ConfigError(`Directory source "${item.name}" in ${path} requires a path`);
  }
  return config;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof current[key] !== "object" || current[key] === null || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

export async function setConfigValue(path: string, value: unknown, cwd = process.cwd()): Promise<string> {
  const { globalConfig } = configPaths(cwd);
  const existing = (await readTextYaml(globalConfig)) ?? {};
  setPath(existing as Record<string, unknown>, path, sanitize(value));
  await mkdir(dirname(globalConfig), { recursive: true });
  await writeFile(globalConfig, stringify(existing, { indent: 2 }) + "\n", "utf8");
  return globalConfig;
}

export async function unsetConfigValue(path: string, cwd = process.cwd()): Promise<string> {
  const { globalConfig } = configPaths(cwd);
  const existing = (await readTextYaml(globalConfig)) ?? {};
  const parts = path.split(".");
  let current: Record<string, unknown> = existing as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (typeof current[key] !== "object" || current[key] === null) return globalConfig;
    current = current[key] as Record<string, unknown>;
  }
  delete current[parts[parts.length - 1]!];
  await mkdir(dirname(globalConfig), { recursive: true });
  await writeFile(globalConfig, stringify(existing, { indent: 2 }) + "\n", "utf8");
  return globalConfig;
}

export async function writeProjectConfig(cwd: string, config: SkillRouterConfig): Promise<string> {
  const configPath = join(cwd, "skillrouter.yaml");
  await mkdir(cwd, { recursive: true });
  await writeFile(configPath, stringify(config, { indent: 2 }) + "\n", "utf8");
  return configPath;
}