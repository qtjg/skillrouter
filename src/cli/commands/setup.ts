import type { CliContext, CommandDef } from "../framework.ts";
import { withApp, type AppContext } from "../context.ts";
import { section, line, ok, fail, warning, info, table, jsonOut, promptYesNo } from "../output.ts";
import { detectAll } from "../../adapters/env.ts";
import { refreshAll } from "../../registry/indexer.ts";
import { writeProjectConfig, DEFAULT_CONFIG, type SkillRouterConfig } from "../../config/config.ts";
import { audit } from "../../security/audit.ts";
import { analyzeProject } from "../../project/analyzer.ts";
import { getGitContext } from "../../git/context.ts";
import { readLockfile, writeLockfile, type Lockfile } from "../../lockfile/lockfile.ts";
import { pathExists } from "../../utils/fs.ts";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { bold, dim, green, cyan, red, yellow } from "../output.ts";

export const initCommand: CommandDef = {
  name: "init",
  category: "Setup",
  description: "Initialize SkillRouter in the current project",
  flags: [
    { name: "force", short: "f", description: "Overwrite an existing skillrouter.yaml" },
    { name: "yes", short: "y", description: "Accept defaults without prompting" },
  ],
  examples: ["skillrouter init", "skillrouter init --yes"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const configPath = join(app.cwd, "skillrouter.yaml");
      if (ctx.flags["force"]) {
        await writeProjectConfig(app.cwd, structuredClone(DEFAULT_CONFIG));
      } else if (await pathExists(configPath)) {
        fail(`skillrouter.yaml already exists in ${app.cwd}. Use --force to reset it.`);
        return 1;
      } else {
        const agents = await detectAll(app.cwd);
        const detected = agents.filter((a) => a.detected);
        if (detected.length > 0) {
          line(`Detected AI environments:`);
          for (const agent of detected) ok(agent.name);
        } else {
          warning("No AI environments detected yet. SkillRouter works standalone; adapters activate when agents are present.");
        }

        const config: SkillRouterConfig = structuredClone(DEFAULT_CONFIG);
        if (detected.some((a) => a.id === "opencode")) config.agents.opencode = true;
        if (detected.some((a) => a.id === "claude")) config.agents.claude = true;
        if (detected.some((a) => a.id === "gemini")) config.agents.gemini = true;
        if (detected.some((a) => a.id === "mcp")) config.agents.mcp = true;

        if (ctx.flags["yes"]) {
          await writeProjectConfig(app.cwd, config);
        } else {
          const proceed = await promptYesNo(`Write skillrouter.yaml?`, true);
          if (!proceed) {
            line("Skipped. Nothing was written.");
            return 0;
          }
          await writeProjectConfig(app.cwd, config);
        }
      }

      const result = await refreshAll(app.storage, app.config, githubRoot(app), app.cwd);
      await audit(app.storage, "user", "init", null, `capabilities indexed=${result.indexed} failed=${result.failed}`);
      ok(`Initialized SkillRouter in ${app.cwd}`);
      info(`Indexed ${result.indexed} capabilities from builtin catalog, local dirs and sources.`);
      jsonOut({ ok: true, project: app.cwd, indexed: result.indexed, errors: result.errors });
      return 0;
    });
  },
};

export const doctorCommand: CommandDef = {
  name: "doctor",
  category: "Setup",
  description: "Diagnose SkillRouter installation and environment",
  examples: ["skillrouter doctor"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const issues: string[] = [];
      section("SkillRouter Doctor");

      section("AI environments");
      const agents = await detectAll(app.cwd);
      for (const agent of agents) {
        if (agent.detected) {
          const detail = agent.version ? ` (${agent.version})` : "";
          ok(`${agent.name}${detail}`);
          for (const note of agent.notes) info(note, 4);
        } else {
          info(`${agent.name}: not detected`, 2);
        }
      }

      section("Capabilities");
      const { indexed, failed, errors } = await refreshAll(app.storage, app.config, githubRoot(app), app.cwd);
      ok(`${indexed} capabilities indexed`);
      if (failed > 0) {
        fail(`${failed} capability sources failed`);
        for (const error of errors.slice(0, 5)) warning(error.message, 4);
      }

      section("Project");
      const project = await analyzeProject(app.cwd);
      if (project.languages.length > 0 || project.frameworks.length > 0) {
        line(`  ${bold("Languages")}:  ${project.languages.join(", ") || dim("none detected")}`);
        line(`  ${bold("Frameworks")}: ${project.frameworks.join(", ") || dim("none detected")}`);
        line(`  ${bold("Databases")}:  ${project.databases.join(", ") || dim("none detected")}`);
        line(`  ${bold("Package")}:    ${project.packageManager ?? dim("none detected")}`);
      } else {
        warning("No package or framework files detected in this directory.");
        issues.push("no project files detected");
      }

      const git = await getGitContext(app.cwd);
      if (git.repoRoot) {
        ok(`Git repository detected (${git.branch ?? "unknown branch"})`);
        if (git.changed.length > 0) info(`${git.changed.length} changed file(s)`, 4);
      } else {
        info("Not a Git repository", 2);
      }

      const lockfile = await readLockfile(app.cwd);
      if (lockfile) ok(`Lockfile present (${lockfile.capabilities.size} capabilities)`);
      else info("No skillrouter.lock yet", 2);

      section("Storage");
      ok(`SQLite database at ${app.dbPath}`);

      jsonOut({
        agents: agents.map((a) => ({ id: a.id, detected: a.detected, version: a.version })),
        capabilities: indexed,
        project: { languages: project.languages, frameworks: project.frameworks },
        git: git.repoRoot !== null,
        lockfile: lockfile !== null,
        issues,
      });
      return issues.length > 0 ? 1 : 0;
    });
  },
};

export const statusCommand: CommandDef = {
  name: "status",
  category: "Setup",
  description: "Show installed capabilities and their states",
  examples: ["skillrouter status", "skillrouter status --json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const installed = await app.storage.allInstalled();
      const capabilities = await app.storage.allCapabilities();
      const stateColor = (state: string): string => {
        switch (state) {
          case "ACTIVE":
            return green(state);
          case "ENABLED":
            return cyan(state);
          case "INSTALLED":
          case "AVAILABLE":
            return bold(state);
          case "DISABLED":
            return dim(state);
          case "FAILED":
          case "BLOCKED":
            return red(state);
          case "OUTDATED":
            return yellow(state);
          default:
            return state;
        }
      };
      if (ctx.json) {
        jsonOut({ installed: installed.map((i) => ({ ...i, agents: i.agents })), total: installed.length });
        return 0;
      }
      if (installed.length === 0) {
        line("No capabilities installed yet.");
        info("Discover capabilities: `skillrouter search <query>`");
        info("Install one:          `skillrouter install <id>`");
        return 0;
      }
      table(
        ["ID", "Version", "State", "Agents", "Risk"],
        installed.map((row) => {
          const cap = capabilities.find((c) => c.id === row.id);
          const risk = row.state === "ACTIVE" && cap ? cap.risk?.declared ?? "low" : "-";
          return [
            row.id,
            row.version,
            stateColor(row.state),
            row.agents.join(", ") || "-",
            risk,
          ];
        }),
      );
      line("");
      info(`${installed.length} capability(ies) installed.`);
      return 0;
    });
  },
};

export const configCommand: CommandDef = {
  name: "config",
  category: "Setup",
  description: "View or set SkillRouter configuration",
  usage: "[get|set|unset|path] [key] [value]",
  args: [
    { name: "action", required: false, description: "get | set | unset | path" },
    { name: "key", required: false, description: "dot-separated config key, e.g. router.mode" },
    { name: "value", required: false, variadic: true, description: "value for set" },
  ],
  examples: ["skillrouter config", "skillrouter config get router.mode", "skillrouter config set router.mode assisted", "skillrouter config unset router.mode"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const [action, key, ...rest] = ctx.positionals;
      if (!action || action === "get" || action === "path" || action === "list") {
        const getValue = (path: string, obj: unknown): unknown => {
          let current: unknown = obj;
          for (const part of path.split(".")) {
            if (current === null || current === undefined || typeof current !== "object") return undefined;
            current = (current as Record<string, unknown>)[part];
          }
          return current;
        };
        if (action === "path") {
          jsonOut({ project: app.projectConfigPath, global: app.globalConfigPath });
          return 0;
        }
        if (key) {
          const value = getValue(key, app.config);
          jsonOut(value ?? null);
          return 0;
        }
        jsonOut(app.config);
        return 0;
      }
      if (action === "set") {
        if (!key) throw new Error("Usage: skillrouter config set <key> <value>");
        const value = parseConfigValue(rest.join(" ") ?? rest[0] ?? "true");
        const { setConfigValue } = await import("../../config/config.ts");
        const path = await setConfigValue(key, value, app.cwd);
        await audit(app.storage, "user", "config.set", null, `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
        ok(`Set ${key} in ${path}`);
        jsonOut({ key, value, path });
        return 0;
      }
      if (action === "unset") {
        if (!key) throw new Error("Usage: skillrouter config unset <key>");
        const { unsetConfigValue } = await import("../../config/config.ts");
        const path = await unsetConfigValue(key, app.cwd);
        await audit(app.storage, "user", "config.unset", null, key);
        ok(`Unset ${key} in ${path}`);
        jsonOut({ key, path });
        return 0;
      }
      throw new Error(`Unknown config action "${action}". Use get, set, unset or path.`);
    });
  },
};

function parseConfigValue(value: string): unknown {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((s) => parseConfigValue(s))
      .filter((v) => v !== "");
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function githubRoot(app: AppContext): string {
  return findRepoRootSync(app.cwd);
}

function findRepoRootSync(start: string): string {
  let current = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
  return start;
}