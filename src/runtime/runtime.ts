import type { Capability, CapabilityState, AgentId } from "../core/types.ts";
import type { RouterDecision, PlanAction, RouteContext } from "../router/types.ts";
import type { Storage, InstalledCapabilityRow } from "../storage/types.ts";
import type { SkillRouterConfig } from "../config/config.ts";
import type { Lockfile } from "../lockfile/lockfile.ts";
import { transition, canTransition } from "../core/lifecycle.ts";
import { globalBus } from "../core/events.ts";
import { audit } from "../security/audit.ts";
import { resolvePolicy, type PermissionRequest, type Decision } from "../security/policy.ts";
import { computeRisk } from "../security/risk.ts";
import { AdapterError, RouterError, SkillRouterError } from "../utils/errors.ts";
import { logger } from "../logging/logger.ts";
import type { AdapterRegistry } from "../adapters/registry.ts";
import { CapabilityInstaller } from "../installer/installer.ts";
import type { AgentAdapter } from "../adapters/types.ts";

export interface ConsentFn {
  (request: { capabilityId: string; action: string; risk: string; permissions: string[]; reason: string }): Promise<boolean>;
}

export interface RuntimeOptions {
  storage: Storage;
  config: SkillRouterConfig;
  adapters: AdapterRegistry;
  lockfile: Lockfile | null;
  cwd: string;
  consent?: ConsentFn;
  autoApproveConsent?: boolean;
}

export interface ExecutionResult {
  activated: Array<{ capabilityId: string; agent: AgentId; ok: boolean; detail?: string }>;
  deactivated: Array<{ capabilityId: string; agent: AgentId; ok: boolean; detail?: string }>;
  skipped: Array<{ capabilityId: string; reason: string }>;
  failures: Array<{ capabilityId: string; error: string }>;
}

/**
 * Runtime orchestrator: converts a router decision into real adapter calls.
 * Owns lifecycle state transitions, consent gating and audit logging.
 */
export class Runtime {
  constructor(private readonly opts: RuntimeOptions) {}

  async executePlan(decision: RouterDecision, ctx: RouteContext): Promise<ExecutionResult> {
    const result: ExecutionResult = { activated: [], deactivated: [], skipped: [], failures: [] };
    if (decision.plan.length === 0) return result;

    for (const action of decision.plan) {
      try {
        const capability = decision.scores.find((s) => s.capability.id === action.capabilityId)?.capability;
        if (action.action === "activate") {
          if (!capability) throw new RouterError(`Capability ${action.capabilityId} not available in decision scores`);
          await this.activate(capability, action, result);
        } else if (action.action === "deactivate") {
          await this.deactivate(action.capabilityId, result);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.failures.push({ capabilityId: action.capabilityId, error: message });
        globalBus.emit({ event: "capability.failed", id: action.capabilityId, error: message });
      }
    }
    return result;
  }

  private async enabledAdapters(): Promise<AgentAdapter[]> {
    const ids = this.opts.config.agents;
    const adapters: AgentAdapter[] = [];
    for (const [key, value] of Object.entries(ids) as Array<[string, boolean]>) {
      if (!value) continue;
      const id = key as AgentId;
      if (this.opts.adapters.has(id)) adapters.push(this.opts.adapters.get(id));
    }
    return adapters;
  }

  private async activate(capability: Capability, action: PlanAction, result: ExecutionResult): Promise<void> {
    const risk = computeRisk(capability);
    const machineState = await this.currentState(capability.id);

    const permissionRequests: PermissionRequest[] = this.permissionRequestsFor(capability);
    const consentRequired = permissionRequests.some(
      (q) => resolvePolicy(q, {
        configPolicy: this.opts.config.security.policy,
        requireConsent: this.opts.config.security.requireConsent,
        interactive: this.opts.consent !== undefined,
        blocked: this.opts.config.security.blocked,
      }) === "ask",
    );

    if (consentRequired) {
      if (!this.opts.consent) throw new RouterError(`Consent required to activate ${capability.id} (${risk.level}), but no interactive consent is available; run in a terminal or configure security.require_consent: false`);
      const granted = await this.opts.consent({
        capabilityId: capability.id,
        action: "activate",
        risk: risk.level,
        permissions: action.permissions,
        reason: action.reasons.map((r) => r.text).join("; "),
      });
      if (!granted) {
        result.skipped.push({ capabilityId: capability.id, reason: "consent denied" });
        await audit(this.opts.storage, "user", "activate", capability.id, "consent denied");
        return;
      }
      globalBus.emit({ event: "permission.requested", capability: capability.id, permission: permissionRequests.map((p) => p.kind).join(",") });
    }

    const adapters = await this.enabledAdapters();
    if (adapters.length === 0) {
      result.skipped.push({ capabilityId: capability.id, reason: "no enabled agents" });
      return;
    }

    const installRow = await this.opts.storage.getInstalled(capability.id);
    if (!installRow) {
      result.skipped.push({ capabilityId: capability.id, reason: "not installed; run `skillrouter install` first" });
      return;
    }

    let activatedSync = false;
    for (const adapter of adapters) {
      try {
        await adapter.activate(capability, installRow.installRoot ?? "");
        activatedSync = true;
        result.activated.push({ capabilityId: capability.id, agent: adapter.id, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.failures.push({ capabilityId: capability.id, error: message });
      }
    }

    if (activatedSync) {
      await this.transitionState(capability.id, machineState, "ACTIVE");
      await audit(this.opts.storage, "runtime", "activate", capability.id, `agents=${adapters.map((a) => a.id).join(",")} decision=${this.lastDecisionId()}`);
      globalBus.emit({ event: "capability.activated", id: capability.id, agent: adapters[0]!.id });
    }
  }

  private async deactivate(capabilityId: string, result: ExecutionResult): Promise<void> {
    const machineState = await this.currentState(capabilityId);
    const installRow = await this.opts.storage.getInstalled(capabilityId);
    const adapters = await this.enabledAdapters();
    for (const adapter of adapters) {
      try {
        await adapter.deactivate(capabilityId, installRow?.installRoot ?? null);
        result.deactivated.push({ capabilityId, agent: adapter.id, ok: true });
      } catch (err) {
        result.failures.push({ capabilityId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    await this.transitionState(capabilityId, machineState, "ENABLED");
    globalBus.emit({ event: "capability.deactivated", id: capabilityId, agent: "all" });
  }

  private async currentState(capabilityId: string): Promise<CapabilityState> {
    const row = await this.opts.storage.getInstalled(capabilityId);
    return row?.state ?? "DISCOVERED";
  }

  private async transitionState(capabilityId: string, from: CapabilityState, to: CapabilityState): Promise<void> {
    if (canTransition(from, to)) {
      const next = transition(from, to);
      await this.opts.storage.setInstalledState(capabilityId, next, { id: capabilityId });
      return;
    }
    // Force a legal path: DISCOVERED → INSTALLED → AVAILABLE → ENABLED → ACTIVE
    const legal: CapabilityState[] = ["INSTALLED", "AVAILABLE", "ENABLED", "ACTIVE"];
    const start = legal.includes(from) ? from : "INSTALLED";
    const idx = legal.indexOf(start);
    let state: CapabilityState = start;
    for (let i = idx; i < legal.indexOf(to); i++) {
      if (canTransition(state, legal[i + 1]!)) state = transition(state, legal[i + 1]!);
    }
    await this.opts.storage.setInstalledState(capabilityId, state, { id: capabilityId });
  }

  private permissionRequestsFor(capability: Capability): PermissionRequest[] {
    const out: PermissionRequest[] = [];
    const p = capability.permissions;
    const risk = computeRisk(capability);
    if (p?.filesystem?.write) out.push({ kind: "filesystem.write", capability: capability.id, riskLevel: risk.level });
    if (p?.network?.allowed?.includes("*")) out.push({ kind: "network", target: "*", capability: capability.id, riskLevel: risk.level });
    if (p?.shell?.enabled) out.push({ kind: "shell", capability: capability.id, riskLevel: risk.level });
    if (p?.credentials && p.credentials.access !== "none") out.push({ kind: "credentials", capability: capability.id, riskLevel: risk.level });
    if (p?.processes?.enabled) out.push({ kind: "processes", capability: capability.id, riskLevel: risk.level });
    return out;
  }

  private lastDecisionId(): string {
    return this.opts.lockfile?.path ?? "unknown";
  }

  /** Reset a capability lifecycle for removal. */
  async markRemoved(capabilityId: string): Promise<void> {
    await this.opts.storage.setInstalledState(capabilityId, "DISABLED", { id: capabilityId });
  }
}

export function runtimeError(message: string): SkillRouterError {
  return new SkillRouterError("E_RUNTIME", message);
}