import type { Capability, CapabilityState, TrustLevel } from "../core/types.ts";

export interface InstalledCapabilityRow {
  id: string;
  version: string;
  state: CapabilityState;
  installRoot: string | null;
  agents: string[];
  installedAt: string;
  updatedAt: string;
  sourceType: string | null;
  sourceLocation: string | null;
}

export interface RoutingHistoryRow {
  id: number;
  ts: string;
  task: string;
  project: string | null;
  decisionId: string | null;
  activations: string;
  deactivations: string;
  selected: string;
  mode: string;
}

export interface AuditRow {
  id: number;
  ts: string;
  actor: string;
  action: string;
  capability: string | null;
  detail: string | null;
}

export interface PreferenceRow {
  key: string;
  value: string;
}

export interface TrustRow {
  capabilityId: string;
  trust: TrustLevel;
  note: string | null;
  updatedAt: string;
}

export interface RouterCacheRow {
  key: string;
  value: string;
  ts: string;
}

/** Dynamic reliability observations for a capability (PRD §22). */
export interface MetricsRow {
  capabilityId: string;
  tasks: number;
  successes: number;
  failures: number;
  lastUpdated: string;
}

export interface Storage {
  /** Directory that contains the database and other runtime state. */
  readonly dataDir: string;

  init(): Promise<void>;
  close(): void;

  upsertCapability(capability: Capability): Promise<void>;
  getCapability(id: string): Promise<Capability | null>;
  allCapabilities(): Promise<Capability[]>;
  removeCapability(id: string): Promise<void>;

  getInstalled(id: string): Promise<InstalledCapabilityRow | null>;
  setInstalledState(id: string, state: CapabilityState, patch: Partial<InstalledCapabilityRow>): Promise<void>;
  allInstalled(): Promise<InstalledCapabilityRow[]>;

  getHistory(filter: { task?: string; limit?: number }): Promise<RoutingHistoryRow[]>;
  addHistory(entry: Omit<RoutingHistoryRow, "id" | "ts">): Promise<void>;

  addAudit(actor: string, action: string, capability: string | null, detail: string | null): Promise<void>;
  getAudit(options: { limit?: number; capability?: string }): Promise<AuditRow[]>;

  getPreference(key: string): Promise<string | null>;
  setPreference(key: string, value: string): Promise<void>;
  allPreferences(): Promise<PreferenceRow[]>;

  getTrust(capabilityId: string): Promise<TrustRow | null>;
  setTrust(capabilityId: string, trust: TrustLevel, note?: string): Promise<void>;
  removeTrust(capabilityId: string): Promise<void>;
  allTrust(): Promise<TrustRow[]>;

  getRouterCache(key: string): Promise<string | null>;
  setRouterCache(key: string, value: string): Promise<void>;

  getMetrics(capabilityId: string): Promise<MetricsRow | null>;
  setMetrics(metrics: MetricsRow): Promise<void>;
  allMetrics(): Promise<MetricsRow[]>;
}

export function installedAgentsJson(agents: string[]): string {
  return JSON.stringify(agents);
}

export function parseAgentsJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}