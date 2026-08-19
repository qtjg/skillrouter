import { join, basename } from "node:path";
import { readdir } from "node:fs/promises";
import { analyzeProject } from "../project/analyzer.ts";
import { getGitContext } from "../git/context.ts";
import { pathExists } from "../utils/fs.ts";
import type { ContextInput, ContextProvider } from "./types.ts";

export const GIT_CONTEXT_PROVIDER: ContextProvider = {
  name: "git",
  description: "git branch, dirty state, changed and staged files",
  priority: 10,
  async collect(input: ContextInput): Promise<Record<string, unknown> | null> {
    const git = await getGitContext(input.cwd);
    if (git.repoRoot === null) return null;
    return {
      branch: git.branch ?? null,
      dirty: git.changed.length > 0,
      changed: git.changed,
      staged: git.staged,
      signals: git.signals,
    };
  },
};

export const PROJECT_CONTEXT_PROVIDER: ContextProvider = {
  name: "project",
  description: "languages, frameworks, package manager, dependencies",
  priority: 20,
  async collect(input: ContextInput): Promise<Record<string, unknown> | null> {
    const project = await analyzeProject(input.cwd);
    return {
      language: project.languages,
      framework: project.frameworks,
      packageManager: project.packageManager,
      database: project.databases,
      cloudProvider: project.cloudProviders,
      testingFramework: project.testingFrameworks,
      docker: project.docker,
      typescript: project.isTypescript,
      javascript: project.isJavascript,
      hasPackageJson: project.isJavascript || project.isTypescript,
      dependencyCount: project.dependencies.length,
      configFiles: project.configFiles.slice(0, 10),
    };
  },
};

export const RUNTIME_CONTEXT_PROVIDER: ContextProvider = {
  name: "runtime",
  description: "os, platform, node version, shell",
  priority: 30,
  async collect(): Promise<Record<string, unknown> | null> {
    const shell = process.env.SHELL;
    return {
      os: process.platform,
      arch: process.arch,
      node: process.version,
      shell: shell ? basename(shell) : null,
      interactive: Boolean(process.stdin.isTTY),
      offline: false,
    };
  },
};

export const FILESYSTEM_CONTEXT_PROVIDER: ContextProvider = {
  name: "filesystem",
  description: "top-level directory shape of the workspace",
  priority: 40,
  async collect(input: ContextInput): Promise<Record<string, unknown> | null> {
    const entries = await readdir(input.cwd, { withFileTypes: true });
    const names = entries.slice(0, 50).map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
    return {
      isEmpty: entries.length === 0,
      entryCount: entries.length,
      hasGitDir: entries.some((e) => e.name === ".git" && e.isDirectory()),
      hasEnvFile: entries.some((e) => e.name === ".env"),
      entries: names,
    };
  },
};

const PACKAGE_MANAGER_FILES: Array<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
];

export const PACKAGE_MANAGER_CONTEXT_PROVIDER: ContextProvider = {
  name: "package-manager",
  description: "lockfile-detected package manager",
  priority: 35,
  async collect(input: ContextInput): Promise<Record<string, unknown> | null> {
    for (const [file, name] of PACKAGE_MANAGER_FILES) {
      if (await pathExists(join(input.cwd, file))) return { name, lockfile: file };
    }
    if (await pathExists(join(input.cwd, "package.json"))) return { name: "npm", lockfile: null };
    return null;
  },
};

const SENSITIVE_ENV_KEYS = /(token|secret|password|passwd|key|auth|credential|cookie|session)/i;
const SAFE_ENV_KEYS = ["CI", "NODE_ENV", "NODE_ICU_DATA", "TERM_PROGRAM", "COLORTERM", "LANG", "LC_ALL", "TZ", "npm_config_user_agent", "npm_package_name", "GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITLAB_CI", "CIRCLECI", "TRAVIS", "JENKINS_URL", "AWS_REGION", "VERCEL", "NETLIFY"];

export const ENVIRONMENT_CONTEXT_PROVIDER: ContextProvider = {
  name: "environment",
  description: "sanitized environment variables (values never exposed for sensitive keys)",
  priority: 50,
  async collect(): Promise<Record<string, unknown> | null> {
    const interesting: Record<string, string | boolean | number> = {};
    let sensitiveCount = 0;
    for (const key of SAFE_ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) {
        if (key === "CI" || key === "GITHUB_ACTIONS" || key === "GITLAB_CI" || key === "CIRCLECI" || key === "TRAVIS" || key === "VERCEL" || key === "NETLIFY") {
          interesting[key.toLowerCase()] = true;
        } else {
          interesting[key.toLowerCase()] = value;
        }
      }
    }
    for (const key of Object.keys(process.env)) {
      if (SENSITIVE_ENV_KEYS.test(key)) sensitiveCount += 1;
    }
    const userAgent = process.env.npm_config_user_agent;
    // npm_config_user_agent is safe (version metadata), never credentials.
    return {
      ci: Object.keys(interesting).some((k) => interesting[k] === true) || Boolean(process.env.CI),
      nodeEnv: process.env.NODE_ENV ?? null,
      sensitiveVarCount: sensitiveCount,
      npm: userAgent ? userAgent.split(" ")[0] : null,
    };
  },
};

export const DEFAULT_CONTEXT_PROVIDERS: ContextProvider[] = [
  GIT_CONTEXT_PROVIDER,
  PROJECT_CONTEXT_PROVIDER,
  RUNTIME_CONTEXT_PROVIDER,
  PACKAGE_MANAGER_CONTEXT_PROVIDER,
  FILESYSTEM_CONTEXT_PROVIDER,
  ENVIRONMENT_CONTEXT_PROVIDER,
];