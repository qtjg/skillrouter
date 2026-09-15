import { join } from "node:path";
import type { CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { loadConfig, writeProjectConfig, type CustomAgentConfig } from "../../config/config.ts";
import { section, line, dim, ok, fail, jsonOut } from "../output.ts";
import { detectAll } from "../../adapters/env.ts";

/**
 * `skillrouter agents` — universal CLI-agent connector.
 *
 * Without arguments lists every known agent (built-in + custom). Subcommands
 * manage config-driven custom agents so ANY CLI tool can be connected without
 * writing an adapter:
 *
 *   skillrouter agents add myagent --cmd mycli --rules .myagent/rules [--label "My Agent"]
 *   skillrouter agents remove myagent
 */
export const agentsCommand: CommandDef = {
  name: "agents",
  category: "Connect",
  description: "List connected CLI agents, or connect any CLI tool via config-driven custom agents",
  usage: "[add <name> --cmd <command> --rules <dir> [--label <label>] | remove <name>]",
  args: [{ name: "subcommand", required: false, description: "add | remove (omit to list)" }],
  flags: [
    { name: "cmd", type: "string", description: "binary to detect on PATH (add)" },
    { name: "rules", type: "string", description: "project-relative rules dir where capability payloads are exposed (add)" },
    { name: "label", type: "string", description: "display label (add)" },
  ],
  examples: [
    "skillrouter agents",
    'skillrouter agents add myagent --cmd mycli --rules .myagent/rules --label "My Agent"',
    "skillrouter agents remove myagent",
  ],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const sub = ctx.positionals[0];

      if (!sub || sub === "list") {
        const { config } = await loadConfig(app.cwd);
        const infos = await detectAll(app.cwd, config.customAgents ?? []);
        if (ctx.json) {
          jsonOut({ agents: infos.map((a) => ({ id: a.id, name: a.name, detected: a.detected, notes: a.notes })) });
          return 0;
        }
        section("Connected agents");
        for (const info of infos) {
          line(`  ${info.id.padEnd(10)} ${info.name.padEnd(34)} ${info.detected ? "✓ detected" : dim("not detected")}`);
          for (const note of info.notes) line(`    ${dim(note)}`);
        }
        const custom = config.customAgents ?? [];
        line("");
        line(`  ${dim(`${custom.length} custom agent(s) configured in skillrouter.yaml`)}`);
        line(`  ${dim("connect any CLI tool: skillrouter agents add <name> --cmd <command> --rules <dir>")}`);
        return 0;
      }

      if (sub === "add") {
        const name = ctx.positionals[1];
        const cmd = ctx.flags["cmd"];
        const rules = ctx.flags["rules"];
        if (!name || typeof cmd !== "string" || typeof rules !== "string") {
          fail('Usage: skillrouter agents add <name> --cmd <command> --rules <dir> [--label "Label"]');
          return 1;
        }
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
          fail("Agent name must be alphanumeric with dashes/underscores.");
          return 1;
        }
        if (rules.startsWith("/") || rules.includes("..")) {
          fail("rules must be a project-relative directory (no absolute paths or ..).");
          return 1;
        }
        const { config, projectConfigPath } = await loadConfig(app.cwd);
        const custom = [...(config.customAgents ?? [])];
        if (custom.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
          fail(`Custom agent "${name}" already exists. Remove it first.`);
          return 1;
        }
        const entry: CustomAgentConfig = { name, command: cmd, rulesDir: rules.replace(/^\.\//, "") };
        const label = ctx.flags["label"];
        if (typeof label === "string" && label.trim()) entry.label = label.trim();
        custom.push(entry);

        await writeProjectConfig(app.cwd, { ...config, customAgents: custom });
        const target = join(app.cwd, entry.rulesDir);
        if (ctx.json) {
          jsonOut({ ok: true, agent: entry, projectConfigPath: projectConfigPath ?? join(app.cwd, "skillrouter.yaml") });
        } else {
          ok(`Connected ${entry.label ?? entry.name} (${entry.command}) → ${target}`);
          line(`  ${dim(`skills will be exposed as managed markdown files in ${entry.rulesDir}`)}`);
          line(`  ${dim(`stored in ${projectConfigPath ?? join(app.cwd, "skillrouter.yaml")} under customAgents`)}`);
        }
        return 0;
      }

      if (sub === "remove") {
        const name = ctx.positionals[1];
        if (!name) {
          fail("Usage: skillrouter agents remove <name>");
          return 1;
        }
        const { config, projectConfigPath } = await loadConfig(app.cwd);
        const before = config.customAgents ?? [];
        const custom = before.filter((a) => a.name.toLowerCase() !== name.toLowerCase());
        if (custom.length === before.length) {
          fail(`No custom agent named "${name}".`);
          return 1;
        }
        await writeProjectConfig(app.cwd, { ...config, customAgents: custom });
        ok(`Removed custom agent ${name}.`);
        return 0;
      }

      fail(`Unknown subcommand "${sub}". Use: list (default), add, remove.`);
      return 1;
    });
  },
};
