import type { CapabilityState } from "./types.ts";
import { SkillRouterError } from "../utils/errors.ts";

interface Transition {
  from: CapabilityState;
  to: CapabilityState;
  reason: string;
}

const TRANSITIONS: Transition[] = [
  { from: "DISCOVERED", to: "INSTALLED", reason: "installed" },
  { from: "DISCOVERED", to: "AVAILABLE", reason: "adopted by an environment" },
  { from: "INSTALLED", to: "AVAILABLE", reason: "verified after install" },
  { from: "INSTALLED", to: "FAILED", reason: "installation failed" },
  { from: "AVAILABLE", to: "ENABLED", reason: "enabled" },
  { from: "AVAILABLE", to: "DISABLED", reason: "disabled" },
  { from: "ENABLED", to: "CANDIDATE", reason: "router candidate" },
  { from: "ENABLED", to: "DISABLED", reason: "disabled" },
  { from: "ENABLED", to: "ACTIVE", reason: "activated" },
  { from: "CANDIDATE", to: "ACTIVE", reason: "activated" },
  { from: "CANDIDATE", to: "ENABLED", reason: "not selected" },
  { from: "ACTIVE", to: "ENABLED", reason: "deactivated" },
  { from: "ACTIVE", to: "SUSPENDED", reason: "temporarily suspended" },
  { from: "ACTIVE", to: "FAILED", reason: "activation or runtime failure" },
  { from: "SUSPENDED", to: "ACTIVE", reason: "resumed" },
  { from: "SUSPENDED", to: "ENABLED", reason: "deactivated" },
  { from: "SUSPENDED", to: "BLOCKED", reason: "security violation" },
  { from: "ENABLED", to: "BLOCKED", reason: "security violation" },
  { from: "ACTIVE", to: "BLOCKED", reason: "security violation" },
  { from: "BLOCKED", to: "ENABLED", reason: "unblocked by user" },
  { from: "FAILED", to: "ENABLED", reason: "recovered" },
  { from: "FAILED", to: "DISABLED", reason: "disabled after failure" },
  { from: "DISABLED", to: "ENABLED", reason: "enabled" },
  { from: "DISABLED", to: "AVAILABLE", reason: "available without enablement" },
  { from: "INSTALLED", to: "DISABLED", reason: "disabled before verification" },
  { from: "INSTALLED", to: "OUTDATED", reason: "newer version available" },
  { from: "ENABLED", to: "OUTDATED", reason: "newer version available" },
  { from: "ACTIVE", to: "OUTDATED", reason: "newer version available" },
  { from: "OUTDATED", to: "ENABLED", reason: "updated" },
  { from: "OUTDATED", to: "DISABLED", reason: "disabled" },
  { from: "OUTDATED", to: "FAILED", reason: "update failed" },
  { from: "AVAILABLE", to: "INSTALLED", reason: "reinstall" },
  { from: "ENABLED", to: "INSTALLED", reason: "reinstall" },
  { from: "ACTIVE", to: "INSTALLED", reason: "reinstall" },
  { from: "ACTIVE", to: "DISABLED", reason: "disabled" },
  { from: "ENABLED", to: "SUSPENDED", reason: "temporarily suspended" },
];

const byFrom: Map<CapabilityState, Map<CapabilityState, string>> = new Map();
for (const t of TRANSITIONS) {
  if (!byFrom.has(t.from)) byFrom.set(t.from, new Map());
  byFrom.get(t.from)!.set(t.to, t.reason);
}

export function canTransition(from: CapabilityState, to: CapabilityState): boolean {
  return byFrom.get(from)?.has(to) ?? false;
}

export function transitionReason(from: CapabilityState, to: CapabilityState): string | null {
  return byFrom.get(from)?.get(to) ?? null;
}

export function transition(from: CapabilityState, to: CapabilityState): CapabilityState {
  const reason = transitionReason(from, to);
  if (!reason) {
    throw new SkillRouterError("E_STATE", `Illegal state transition ${from} → ${to}`);
  }
  return to;
}

export function permittedTargets(state: CapabilityState): CapabilityState[] {
  return [...(byFrom.get(state)?.keys() ?? [])];
}
