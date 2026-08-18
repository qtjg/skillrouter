import type { CliContext, CommandDef } from "../framework.ts";
import { withApp, type AppContext } from "../context.ts";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { section, line, ok, info, warning, fail, jsonOut, promptYesNo, dim, green, table } from "../output.ts";
import { resolveCapability } from "../helpers.ts";
import { computeRisk } from "../../security/risk.ts";
import { CapabilityInstaller } from "../../installer/installer.ts";
import { readLockfile, writeLockfile, removeLockEntry } from "../../lockfile/lockfile.ts";
import { getAdapterRegistry } from "../../adapters/registry.ts";
import { globalBus } from "../../core/events.ts";
import { audit } from "../../security/audit.ts";
import { pathExists } from "../../utils/fs.ts";
import { NotFoundError } from "../../utils/errors.ts";
import { compareSemVer } from "../../utils/version.ts";
import { resolveCapabilityRef } from "../../registry/indexer.ts";
import { logger } from "../../logging/logger.ts";

export const installCommand: CommandDef = {
  name: "install",
  category: "Capabilities",
  description: "Install a capability (registry id, local path, or git url)",
  usage: "<capability>",
  args: [{ name: "capability", required: true, description: "capability id, path or git URL" }],
  flags: [
    { name: "force", short: "f", description: "Install even if the security audit flags problems" },
    { name: "yes", short: "y", description: "Approve consent prompts automatically (LOW/MEDIUM risk only)" },
    { name: "dry-run", description: "Show what would happen without changing anything" },
    { name: "no-activate", description: "Install without exposing to agents" },
  ],
  examples: ["skillrouter install stripe-expert", "skillrouter install ./my-capability", "skillrouter install https://github.com/user/stripe-expert"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const ref = ctx.positionals[0];
      if (!ref) throw new Error("Missing capability reference. Usage: skillrouter install <capability | path | git-url>");

      const resolved = await resolveCapabilityRef(ref, app.cwd, app.config.sources) ?? await resolveIndexed(app, ref);
      if (!resolved) throw new NotFoundError(`No capability found for "${ref}". Try \`skillrouter search ${ref}\`.`);

      const { capability, sourceDir } = resolved;
      const risk = computeRisk(capability);

      if (ctx.json) {
        const installer = new CapabilityInstaller(findProjectRoot(app), app.storage);
        const summary = await installer.auditInstall(sourceDir, capability, { dryRun: Boolean(ctx.flags["dry-run"]) });
        jsonOut({
          capability: { id: capability.id, version: capability.version, risk: summary.risk, riskScore: summary.riskScore },
          problems: summary.problems,
          dryRun: Boolean(ctx.flags["dry-run"]),
        });
        return summary.problems.length > 0 && !ctx.flags["force"] ? 1 : 0;
      }

      if (!ctx.flags["dry-run"]) {
        section(`Installing ${capability.name}`);
        line(`  ${dim(`id:      ${capability.id}`)}`);
        line(`  ${dim(`version: ${capability.version}`)}`);
        line(`  ${dim(`risk:    ${risk.level.toUpperCase()} (${risk.score}/100)`)}`);
        line("");
      }

      const installer = new CapabilityInstaller(findProjectRoot(app), app.storage);
      const summary = await installer.auditInstall(sourceDir, capability, { dryRun: Boolean(ctx.flags["dry-run"]) });

      if (summary.problems.length > 0) {
        warning("Security audit found issues:");
        for (const problem of summary.problems) fail(problem, 4);
        if (!ctx.flags["force"]) {
          if (ctx.flags["yes"]) {
            fail(`Aborted: ${capability.id} requires explicit approval (--force).`);
            return 1;
          }
          const proceed = await promptYesNo(`Install ${capability.id} anyway?`, false);
          if (!proceed) {
            info("Installation cancelled. No changes were made.");
            return 1;
          }
        }
      }

      if (summary.risk === "critical" && !ctx.flags["force"]) {
        if (ctx.flags["yes"]) {
          fail(`Aborted: ${capability.id} is CRITICAL risk and requires --force.`);
          return 1;
        }
        const proceed = await promptYesNo(`This capability is CRITICAL risk. Install anyway?`, false);
        if (!proceed) {
          info("Installation cancelled. No changes were made.");
          return 1;
        }
      }

      const lockfile = (await readLockfile(findProjectRoot(app))) ?? { path: joinPath(findProjectRoot(app), "skillrouter.lock"), version: 1, capabilities: new Map() };
      const wasInstalled = (await app.storage.getInstalled(capability.id)) !== null;

      const outcome = await installer.install(capability, sourceDir, {
        dryRun: Boolean(ctx.flags["dry-run"]),
        force: Boolean(ctx.flags["force"]),
        requireConsent: app.config.security.requireConsent,
        autoApprove: Boolean(ctx.flags["yes"]),
        agents: enabledAgents(app),
      }, lockfile);

      if (outcome.dryRun) {
        line(`Would install ${green(capability.id)}@${capability.version}`);
        line("");
        info(`Risk: ${outcome.risk.toUpperCase()} (${outcome.riskScore}/100)`);
        if (outcome.problems.length > 0) {
          warning("These issues would block installation:");
          for (const p of outcome.problems) fail(p, 4);
        }
        line("");
        info("No changes made.");
        return 0;
      }

      if (outcome.outcome === null) {
        fail(`Installation of ${capability.id} failed (verification).`);
        return 1;
      }

      await writeLockfile(lockfile);
      ok(`Installed ${capability.id}@${capability.version}`);
      if (outcome.outcome.backup) info(`Previous version backed up to ${outcome.outcome.backup}`, 4);

      if (!ctx.flags["no-activate"] && app.config.capabilities.autoActivate) {
        await exposeToAgents(app, capability, ctx);
      }

      jsonOut({
        installed: true,
        id: capability.id,
        version: capability.version,
        risk: outcome.risk,
        wasUpgrade: wasInstalled,
        agents: enabledAgents(app),
      });
      globalBus.emit({ event: "capability.installed", id: capability.id, version: capability.version });
      return 0;
    });
  },
};

async function resolveIndexed(app: AppContext, ref: string): Promise<{ capability: import("../../core/types.ts").Capability; sourceDir: string } | null> {
  try {
    const capability = await resolveCapability(app.storage, ref);
    const installer = new CapabilityInstaller(findProjectRoot(app), app.storage);
    const target = installer.targetFor(capability);
    return { capability, sourceDir: await installedOrIndexSourceDir(app, capability, target) };
  } catch {
    return null;
  }
}

async function installedOrIndexSourceDir(app: AppContext, capability: import("../../core/types.ts").Capability, target: string): Promise<string> {
  if (await pathExists(target)) return target;
  const location = capability.source?.location;
  if (location && await pathExists(location)) {
    const { discoverSingleDir } = await import("../../registry/discovery.ts");
    const found = location.endsWith("skillrouter.yaml") || location.endsWith("manifest.yaml") ? null : await discoverSingleDir(location);
    if (found && found.capability.id === capability.id) return location;
  }
  if (capability.source?.url) {
    const result = await resolveCapabilityRef(capability.source.url, app.cwd, app.config.sources);
    if (result) return result.sourceDir;
  }
  throw new NotFoundError(`Source directory for "${capability.id}" is not available locally. Re-index sources or install from a path/git URL.`);
}

export const uninstallCommand: CommandDef = {
  name: "uninstall",
  category: "Capabilities",
  description: "Remove a capability from the project",
  usage: "<capability>",
  args: [{ name: "capability", required: true, description: "capability id" }],
  flags: [{ name: "yes", short: "y", description: "skip confirmation" }],
  examples: ["skillrouter uninstall stripe-expert"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const id = ctx.positionals[0]!;
      const installed = await app.storage.getInstalled(id);
      if (!installed) {
        line(`Capability "${id}" is not installed.`);
        return 0;
      }
      if (!ctx.flags["yes"]) {
        const proceed = await promptYesNo(`Uninstall ${id}@${installed.version}?`, true);
        if (!proceed) {
          info("Uninstall cancelled.");
          return 0;
        }
      }
      const installer = new CapabilityInstaller(findProjectRoot(app), app.storage);
      const result = await installer.uninstall(id, installed, { dryRun: Boolean(ctx.flags["dry-run"] ?? false) });
      const lockfile = await readLockfile(findProjectRoot(app));
      if (lockfile) {
        removeLockEntry(lockfile, id);
        await writeLockfile(lockfile);
      }
      await exposeRemoval(app, id, installed.installRoot);
      if (result.backup) info(`Backup kept at ${result.backup}`, 4);
      ok(`Uninstalled ${id}`);
      jsonOut({ uninstalled: true, id, backup: result.backup });
      return 0;
    });
  },
};

export const updateCommand: CommandDef = {
  name: "update",
  category: "Capabilities",
  description: "Update installed capabilities to newer versions",
  flags: [
    { name: "yes", short: "y", description: "apply updates without prompting" },
    { name: "dry-run", description: "show available updates without applying" },
  ],
  examples: ["skillrouter update", "skillrouter update --yes"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const installed = await app.storage.allInstalled();
      const registry = await app.storage.allCapabilities();
      const updates: Array<{ id: string; from: string; to: string }> = [];
      for (const row of installed) {
        const older = registry.find((c) => c.id === row.id);
        if (!older) continue;
        if (compareSemVer(older.version, row.version) > 0) updates.push({ id: row.id, from: row.version, to: older.version });
      }
      if (updates.length === 0) {
        if (!ctx.json) ok("All capabilities are up to date.");
        jsonOut({ updates: [] });
        return 0;
      }
      if (ctx.json) {
        jsonOut({ updates });
        return ctx.flags["dry-run"] ? 0 : 0;
      }
      section(`Updates available`);
      table(
        ["Capability", "Current", "Latest"],
        updates.map((u) => [u.id, dim(u.from), green(u.to)]),
      );
      line("");
      if (ctx.flags["dry-run"]) {
        info("No changes made.");
        return 0;
      }
      if (!ctx.flags["yes"]) {
        const proceed = await promptYesNo(`Apply ${updates.length} update(s)?`, true);
        if (!proceed) {
          info("Update cancelled.");
          return 0;
        }
      }
      let applied = 0;
      for (const update of updates) {
        try {
          const resolved = await resolveCapabilityRef(update.id, app.cwd, app.config.sources) ?? await resolveIndexed(app, update.id);
          if (!resolved) {
            warning(`Could not resolve ${update.id}; skipping`);
            continue;
          }
          const installer = new CapabilityInstaller(findProjectRoot(app), app.storage);
          const lockfile = (await readLockfile(findProjectRoot(app))) ?? { path: joinPath(findProjectRoot(app), "skillrouter.lock"), version: 1, capabilities: new Map() };
          const outcome = await installer.install(resolved.capability, resolved.sourceDir, { force: true, autoApprove: true, agents: enabledAgents(app) }, lockfile);
          if (outcome.outcome) {
            await writeLockfile(lockfile);
            ok(`Updated ${update.id} ${dim(update.from)} → ${green(update.to)}`);
            applied += 1;
          }
        } catch (err) {
          fail(`${update.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (applied === updates.length) {
        globalBus.emit({ event: "capability.installed", id: "bulk-update", version: String(applied) });
        await audit(app.storage, "user", "update", null, `applied=${applied}/${updates.length}`);
      }
      jsonOut({ updated: applied, total: updates.length });
      return applied === updates.length ? 0 : 1;
    });
  },
};

export const sourceCommand: CommandDef = {
  name: "source",
  category: "Capabilities",
  description: "Manage capability sources (git, catalog, directory)",
  usage: "[add|remove|list] [name] [url|path]",
  args: [
    { name: "action", required: false, description: "add | remove | list" },
    { name: "name", required: false, description: "source name" },
    { name: "target", required: false, description: "git url or path" },
  ],
  flags: [{ name: "type", description: "source type: git (default), catalog, directory" }],
  examples: ["skillrouter source add my-skills https://github.com/user/skills", "skillrouter source list", "skillrouter source remove my-skills"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const [action, name, target] = ctx.positionals;
      const configPath = app.projectConfigPath ?? joinPath(app.cwd, "skillrouter.yaml");
      if (!action || action === "list") {
        if (ctx.json) {
          jsonOut({ sources: app.config.sources });
          return 0;
        }
        if (app.config.sources.length === 0) {
          info("No custom sources configured. Sources can be added from git, catalogs, or directories.");
          return 0;
        }
        table(
          ["Name", "Type", "Location", "Enabled"],
          app.config.sources.map((s) => [s.name, s.type, s.url ?? s.path ?? "-", s.enabled === false ? dim("no") : "yes"]),
        );
        return 0;
      }
      if (action === "add") {
        if (!name || !target) throw new Error("Usage: skillrouter source add <name> <url|path>");
        const type = typeof ctx.flags["type"] === "string" ? ctx.flags["type"] : target.includes("://") ? "git" : "directory";
        if (!["git", "catalog", "directory"].includes(type)) throw new Error(`Unknown source type "${type}"`);
        const sources = [...app.config.sources];
        const existingIndex = sources.findIndex((s) => s.name === name);
        const entry: import("../../config/config.ts").SourcesConfigItem = type === "git"
          ? { name, type: "git", url: target, enabled: true }
          : { name, type: type as "catalog" | "directory", path: target, enabled: true };
        if (existingIndex >= 0) sources[existingIndex] = entry;
        else sources.push(entry);
        const { writeProjectConfig } = await import("../../config/config.ts");
        await writeProjectConfig(app.cwd, { ...app.config, sources });
        const { refreshAll } = await import("../../registry/indexer.ts");
        let result;
        try {
          result = await refreshAll(app.storage, { ...app.config, sources }, findRepoRootSync(app.cwd), app.cwd);
        } catch (err) {
          warning(`Source added but indexing failed: ${err instanceof Error ? err.message : String(err)}`);
          result = { indexed: 0, failed: 1, errors: [{ id: name, message: String(err) }] };
        }
        await audit(app.storage, "user", "source.add", null, `${type}:${target}`);
        ok(`Added source ${name} (${type})`);
        info(`Indexed ${result.indexed} capabilities from this source.`);
        jsonOut({ added: true, source: entry, indexed: result.indexed });
        return result.failed > 0 ? 1 : 0;
      }
      if (action === "remove") {
        if (!name) throw new Error("Usage: skillrouter source remove <name>");
        const sources = app.config.sources.filter((s) => s.name !== name);
        if (sources.length === app.config.sources.length) {
          warning(`Source "${name}" not found.`);
          return 1;
        }
        const { writeProjectConfig } = await import("../../config/config.ts");
        await writeProjectConfig(app.cwd, { ...app.config, sources });
        await audit(app.storage, "user", "source.remove", null, name);
        ok(`Removed source ${name}`);
        jsonOut({ removed: true, name });
        return 0;
      }
      throw new Error(`Unknown source action "${action}". Use add, remove or list.`);
    });
  },
};

async function exposeToAgents(app: AppContext, capability: import("../../core/types.ts").Capability, ctx: CliContext): Promise<void> {
  const adapters = await getAdapterRegistry({ cwd: app.cwd, binaryPaths: new Map() });
  const installRow = await app.storage.getInstalled(capability.id);
  if (!installRow?.installRoot) return;
  const exposed: string[] = [];
  for (const id of enabledAgents(app)) {
    if (!adapters.has(id)) continue;
    try {
      await adapters.get(id).install(capability, installRow.installRoot);
      exposed.push(id);
      logger.info(`exposed ${capability.id} to ${id}`);
    } catch (err) {
      warning(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const fresh = await app.storage.getInstalled(capability.id);
  await app.storage.setInstalledState(capability.id, fresh?.state ?? "INSTALLED", {
    id: capability.id,
    agents: [...new Set([...(fresh?.agents ?? []), ...exposed])],
  });
  if (exposed.length === 0) info("No agents enabled — capability installed locally only.", 2);
  else ok(`Exposed to ${exposed.join(", ")}`);
}

async function exposeRemoval(app: AppContext, id: string, installRoot: string | null): Promise<void> {
  const adapters = await getAdapterRegistry({ cwd: app.cwd, binaryPaths: new Map() });
  for (const adapter of adapters.all()) {
    try {
      await adapter.uninstall(id, installRoot);
    } catch {
      // best-effort removal
    }
  }
}

export function enabledAgents(app: AppContext): import("../../core/types.ts").AgentId[] {
  const out: import("../../core/types.ts").AgentId[] = [];
  const agents = app.config.agents;
  for (const [key, value] of Object.entries(agents) as Array<[string, boolean]>) {
    if (value) out.push(key as import("../../core/types.ts").AgentId);
  }
  return out;
}

export function findProjectRoot(app: AppContext): string {
  return app.projectConfigPath ? app.projectConfigPath.replace(/\/skillrouter\.ya?ml$/, "") : app.cwd;
}

export function findRepoRootSync(start: string): string {
  let current = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(`${current}/.git`)) return current;
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
  return start;
}

function joinPath(dir: string, name: string): string {
  return `${dir}/${name}`;
}

export function riskSummary(capability: import("../../core/types.ts").Capability): { level: string; score: number } {
  const risk = computeRisk(capability);
  return { level: risk.level, score: risk.score };
}