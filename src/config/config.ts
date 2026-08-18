import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { ConfigError } from "../utils/errors.ts";
import { pathExists } from "../utils/fs.ts";
import { deepMerge } from "../utils/object.ts";

export type RouterMode = "manual" | "assisted" | "automatic" | "autonomous";

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

export interface AgentsConfig {
  opencode: boolean;
  gemini: boolean;
  claude: boolean;
  codex: boolean;
  mcp: boolean;
  generic: boolean;
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
  agents: AgentsConfig;
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
  agents: {
    opencode: true,
    gemini: true,
    claude: true,
    codex: false,
    mcp: false,
    generic: true,
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
  if (typeof config.router.threshold !== "number" || config.router.threshold < 0 || config.router.threshold > 100) {
    throw new ConfigError(`router.threshold in ${path} must be a number between 0 and 100`);
  }
  if (config.router.maxActivations < 0) throw new ConfigError(`router.maxActivations in ${path} must be >= 0`);
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