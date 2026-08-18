import type { Capability, AgentId } from "../core/types.ts";

export interface AgentInfo {
  id: AgentId;
  name: string;
  detected: boolean;
  binaryPath: string | null;
  version: string | null;
  notes: string[];
}

export interface AdapterCapability {
  capabilityId: string;
  location: string;
  version: string | null;
  state: "installed" | "enabled" | "active" | "unknown";
}

export interface AdapterOperationResult {
  agent: AgentId;
  capabilityId: string;
  ok: boolean;
  action: string;
  detail?: string;
  requiresRestart?: boolean;
}

export interface ActivateTarget {
  /** Where the capability payload lives (installed capability dir without trailing agent dirs). */
  installRoot: string;
  version: string;
}

export interface AgentAdapter {
  id: AgentId;
  detect(): Promise<AgentInfo>;
  /** Capabilities the agent already knows about (discovered in its own config dirs). */
  discoverInstalled(): Promise<AdapterCapability[]>;
  /** Expose a capability to the agent (symlink/copy/config). */
  install(capability: Capability, installRoot: string): Promise<AdapterOperationResult>;
  /** Remove exposure of the capability. */
  uninstall(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult>;
  /** Mark as enabled in agent config (e.g. MCP config entry). */
  enable(capability: Capability, installRoot: string): Promise<AdapterOperationResult>;
  /** Mark as disabled. */
  disable(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult>;
  /** Fully activate (make usable in current session if supported). */
  activate(capability: Capability, installRoot: string): Promise<AdapterOperationResult>;
  /** Deactivate. */
  deactivate(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult>;
}