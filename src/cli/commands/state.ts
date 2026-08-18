import type { CliContext, CommandDef } from "../framework.ts";
import { withApp, type AppContext } from "../context.ts";
import { line, ok, info, warning, fail, jsonOut, section } from "../output.ts";
import { resolveCapability } from "../helpers.ts";
import { getAdapterRegistry } from "../../adapters/registry.ts";
import { transition, canTransition } from "../../core/lifecycle.ts";
import { audit } from "../../security/audit.ts";
import { globalBus } from "../../core/events.ts";
import { NotFoundError } from "../../utils/errors.ts";
import { logger } from "../../logging/logger.ts";

async function capabilityWithInstall(app: AppContext, ref: string) {
  const capability = await resolveCapability(app.storage, ref);
  const installed = await app.storage.getInstalled(capability.id);
  return { capability, installed };
}

export const enableCommand: CommandDef = {
  name: "enable",
  category: "Runtime",
  description: "Enable an installed capability (make it routable)",
  usage: "<capability>",
  args: [{ name: "capability", required: true, description: "capability id" }],
  examples: ["skillrouter enable security-audit"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const { capability, installed } = await capabilityWithInstall(app, ctx.positionals[0]!);
      if (!installed) {
        warning(`${capability.id} is not installed. Run \`skillrouter install ${capability.id}\` first.`);
        return 1;
      }
      await transitionState(app, capability.id, installed.state, "ENABLED", "user");
      ok(`Enabled ${capability.id}`);
      jsonOut({ id: capability.id, state: "ENABLED" });
      return 0;
    });
  },
};

export const disableCommand: CommandDef = {
  name: "disable",
  category: "Runtime",
  description: "Disable a capability (no longer routable or activatable)",
  usage: "<capability>",
  args: [{ name: "capability", required: true, description: "capability id" }],
  examples: ["skillrouter disable ui-design"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const { capability, installed } = await capabilityWithInstall(app, ctx.positionals[0]!);
      if (!installed) {
        line(`${capability.id} is not installed.`);
        return 0;
      }
      await deactivateFromAgents(app, capability.id, installed.installRoot);
      await transitionState(app, capability.id, installed.state, "DISABLED", "user");
      ok(`Disabled ${capability.id}`);
      jsonOut({ id: capability.id, state: "DISABLED" });
      return 0;
    });
  },
};

export const forceEnableCommand: CommandDef = {
  name: "force-enable",
  category: "Runtime",
  description: "Enable a capability regardless of router policy (manual override)",
  usage: "<capability>",
  args: [{ name: "capability", required: true, description: "capability id" }],
  examples: ["skillrouter force-enable security"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const { capability, installed } = await capabilityWithInstall(app, ctx.positionals[0]!);
      if (!installed) throw new NotFoundError(`${capability.id} is not installed.`);
      if (app.config.security.blocked.includes(capability.id)) {
        fail(`${capability.id} is blocked by security configuration; unblock it first.`);
        return 1;
      }
      await transitionState(app, capability.id, installed.state, "ENABLED", "user");
      await audit(app.storage, "user", "force-enable", capability.id);
      globalBus.emit({ event: "capability.enabled", id: capability.id });
      ok(`Force-enabled ${capability.id} (router may no longer deactivate it automatically)`);
      jsonOut({ id: capability.id, state: "ENABLED", forced: true });
      return 0;
    });
  },
};

export const forceDisableCommand: CommandDef = {
  name: "force-disable",
  category: "Runtime",
  description: "Disable a capability regardless of router policy (manual override)",
  usage: "<capability>",
  args: [{ name: "capability", required: true, description: "capability id" }],
  examples: ["skillrouter force-disable ui-design"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const { capability, installed } = await capabilityWithInstall(app, ctx.positionals[0]!);
      if (!installed) {
        line(`${capability.id} is not installed.`);
        return 0;
      }
      await deactivateFromAgents(app, capability.id, installed.installRoot);
      await transitionState(app, capability.id, installed.state, "DISABLED", "user");
      await audit(app.storage, "user", "force-disable", capability.id);
      globalBus.emit({ event: "capability.disabled", id: capability.id });
      ok(`Force-disabled ${capability.id}`);
      jsonOut({ id: capability.id, state: "DISABLED", forced: true });
      return 0;
    });
  },
};

export const activateCommand: CommandDef = {
  name: "activate",
  category: "Runtime",
  description: "Activate a capability in the connected agents",
  usage: "<capability>",
  args: [{ name: "capability", required: true, description: "capability id" }],
  flags: [{ name: "yes", short: "y", description: "approve consent prompts" }],
  examples: ["skillrouter activate security-audit"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const { capability, installed } = await capabilityWithInstall(app, ctx.positionals[0]!);
      if (!installed) {
        warning(`${capability.id} is not installed. Run \`skillrouter install ${capability.id}\` first.`);
        return 1;
      }
      await activateInAgents(app, capability, installed.installRoot, ctx);
      await transitionState(app, capability.id, installed.state, "ACTIVE", "user");
      ok(`Activated ${capability.id}`);
      jsonOut({ id: capability.id, state: "ACTIVE" });
      return 0;
    });
  },
};

export const deactivateCommand: CommandDef = {
  name: "deactivate",
  category: "Runtime",
  description: "Deactivate a capability (stays installed and enabled)",
  usage: "<capability>",
  args: [{ name: "capability", required: true, description: "capability id" }],
  examples: ["skillrouter deactivate stripe-expert"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const { capability, installed } = await capabilityWithInstall(app, ctx.positionals[0]!);
      if (!installed) {
        line(`${capability.id} is not installed.`);
        return 0;
      }
      await deactivateFromAgents(app, capability.id, installed.installRoot);
      await transitionState(app, capability.id, installed.state, "ENABLED", "user");
      ok(`Deactivated ${capability.id}`);
      jsonOut({ id: capability.id, state: "ENABLED" });
      return 0;
    });
  },
};

export const activeCommand: CommandDef = {
  name: "active",
  category: "Runtime",
  description: "List currently active capabilities",
  flags: [
    { name: "json", description: "machine-readable output" },
    { name: "explain", description: "show why each capability is active" },
  ],
  examples: ["skillrouter active"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const installed = await app.storage.allInstalled();
      const active = installed.filter((i) => i.state === "ACTIVE");
      const candidates = installed.filter((i) => i.state === "CANDIDATE");
      if (ctx.flags["json"] || ctx.json) {
        jsonOut({ active: active.map((i) => ({ id: i.id, version: i.version, agents: i.agents })), candidates: candidates.map((i) => i.id) });
        return 0;
      }
      if (active.length === 0) {
        line("No capabilities are currently active.");
        info("Route a task to activate capabilities: `skillrouter route \"your task\"`");
        if (candidates.length > 0) info(`Candidates: ${candidates.map((c) => c.id).join(", ")}`, 2);
        return 0;
      }
      section(`Active capabilities`);
      for (const row of active) {
        const suffix = row.agents.length > 0 ? ` (${row.agents.join(", ")})` : "";
        ok(`${row.id}${suffix}`);
      }
      if (candidates.length > 0) {
        line("");
        info(`Candidates: ${candidates.map((c) => c.id).join(", ")}`);
      }
      return 0;
    });
  },
};

async function activateInAgents(app: AppContext, capability: import("../../core/types.ts").Capability, installRoot: string | null, ctx: CliContext): Promise<void> {
  const adapters = await getAdapterRegistry({ cwd: app.cwd, binaryPaths: new Map() });
  if (!installRoot) throw new NotFoundError(`No install root for ${capability.id}`);
  const agents = enabledAgentIds(app);
  let activatedSync = false;
  for (const id of agents) {
    if (!adapters.has(id)) continue;
    try {
      await adapters.get(id).activate(capability, installRoot);
      activatedSync = true;
    } catch (err) {
      warning(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!activatedSync) info("No agents enabled — capability marked active locally only.", 2);
  await audit(app.storage, "user", "activate", capability.id, `agents=${agents.join(",")}`);
}

async function deactivateFromAgents(app: AppContext, capabilityId: string, installRoot: string | null): Promise<void> {
  const adapters = await getAdapterRegistry({ cwd: app.cwd, binaryPaths: new Map() });
  for (const adapter of adapters.all()) {
    try {
      await adapter.deactivate(capabilityId, installRoot);
    } catch {
      // best-effort
    }
  }
}

async function transitionState(app: AppContext, id: string, from: import("../../core/types.ts").CapabilityState, to: import("../../core/types.ts").CapabilityState, actor: string): Promise<void> {
  if (!canTransition(from, to)) {
    // Walk through the legal chain (e.g. DISCOVERED → INSTALLED → ... → ACTIVE).
    const chain: Array<import("../../core/types.ts").CapabilityState> = ["INSTALLED", "AVAILABLE", "ENABLED", "ACTIVE"];
    const startIdx = Math.max(0, chain.indexOf(from));
    const endIdx = chain.indexOf(to);
    if (endIdx <= startIdx) {
      // terminal states without a legal path to `to`; fall back to direct set
      await app.storage.setInstalledState(id, to, { id });
      return;
    }
    let state = chain[startIdx]!;
    for (let i = startIdx; i < endIdx; i++) {
      if (canTransition(state, chain[i + 1]!)) state = transition(state, chain[i + 1]!);
      else break;
    }
    await app.storage.setInstalledState(id, state, { id });
    return;
  }
  const next = transition(from, to);
  await app.storage.setInstalledState(id, next, { id });
  await audit(app.storage, actor, to === "DISABLED" ? "disable" : "enable", id, `transition ${from}→${to}`);
  logger.info(`${id}: ${from} → ${to}`);
}

export function enabledAgentIds(app: AppContext): import("../../core/types.ts").AgentId[] {
  const out: import("../../core/types.ts").AgentId[] = [];
  for (const [key, value] of Object.entries(app.config.agents) as Array<[string, boolean]>) {
    if (value) out.push(key as import("../../core/types.ts").AgentId);
  }
  return out;
}