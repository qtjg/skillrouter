export type CapabilityType =
  | "skill"
  | "plugin"
  | "mcp-server"
  | "command"
  | "hook"
  | "agent"
  | "sub-agent"
  | "context"
  | "template"
  | "script"
  | "extension"
  | "tool"
  | "workflow"
  | "adapter";

export const CAPABILITY_TYPES: readonly CapabilityType[] = [
  "skill",
  "plugin",
  "mcp-server",
  "command",
  "hook",
  "agent",
  "sub-agent",
  "context",
  "template",
  "script",
  "extension",
  "tool",
  "workflow",
  "adapter",
];

export type RiskLevel = "low" | "medium" | "high" | "critical";

export const RISK_LEVELS: readonly RiskLevel[] = ["low", "medium", "high", "critical"];

export type TrustLevel = "verified" | "trusted" | "community" | "unknown" | "blocked";

export type CapabilityState =
  | "DISCOVERED"
  | "INSTALLED"
  | "AVAILABLE"
  | "ENABLED"
  | "CANDIDATE"
  | "ACTIVE"
  | "SUSPENDED"
  | "BLOCKED"
  | "DISABLED"
  | "FAILED"
  | "OUTDATED";

export type AgentId = "opencode" | "gemini" | "claude" | "codex" | "aider" | "mcp" | "generic";

export type Compatibility = "native" | "compatible" | "adaptable" | "unsupported";

export type ActivationLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type CapabilitySourceType = "local" | "git" | "catalog" | "url" | "registry";

export interface TriggerDefinition {
  keywords?: string[];
  intents?: string[];
  technologies?: string[];
  filePatterns?: string[];
  gitPatterns?: string[];
}

export interface Dependency {
  id: string;
  version?: string;
  optional?: boolean;
}

export interface FileSystemPermission {
  read: boolean;
  write: boolean;
  paths?: string[];
}

export interface NetworkPermission {
  allowed: string[];
  deny?: string[];
}

export interface ShellPermission {
  enabled: boolean;
  allow?: string[];
  deny?: string[];
}

export interface EnvironmentPermission {
  read?: boolean;
  variables?: string[];
}

export interface CredentialPermission {
  access: "none" | "explicit" | "requested";
  allowed?: string[];
}

export interface HookPermission {
  enabled: boolean;
  events?: string[];
}

export interface McpPermission {
  servers?: string[];
}

export interface ProcessPermission {
  enabled: boolean;
  allow?: string[];
}

export interface PermissionSet {
  filesystem?: FileSystemPermission;
  network?: NetworkPermission;
  shell?: ShellPermission;
  environment?: EnvironmentPermission;
  credentials?: CredentialPermission;
  hooks?: HookPermission;
  mcp?: McpPermission;
  processes?: ProcessPermission;
}

export interface RiskProfile {
  declared?: RiskLevel;
  score?: number;
  reasons?: string[];
}

export interface ContextProfile {
  estimatedTokens?: number;
  activationLevel?: ActivationLevel;
  resources?: string[];
}

export interface CapabilitySource {
  type: CapabilitySourceType;
  location: string;
  url?: string;
  commit?: string;
  catalog?: string;
  hash?: string;
}

export interface CompatibilityMap {
  [agent: string]: Compatibility;
}

export interface CapabilityMetadata {
  categories?: string[];
  tags?: string[];
  license?: string;
  author?: string;
  repository?: string;
  homepage?: string;
  quality?: number;
  popularity?: number;
  successRate?: number;
}

export interface Capability {
  id: string;
  name: string;
  version: string;
  description: string;
  type: CapabilityType;
  schema?: string;
  capabilities?: string[];
  triggers?: TriggerDefinition;
  compatibility: CompatibilityMap;
  dependencies?: Dependency[];
  conflicts?: string[];
  enhances?: string[];
  replaces?: string[];
  compatibleWith?: string[];
  permissions?: PermissionSet;
  risk?: RiskProfile;
  context?: ContextProfile;
  source?: CapabilitySource;
  trust?: TrustLevel;
  metadata?: CapabilityMetadata;
  resources?: string[];
  manifestPath?: string;
}

export interface CapabilitySummary {
  id: string;
  name: string;
  version: string;
  description: string;
  type: CapabilityType;
  compatibility: CompatibilityMap;
  trust: TrustLevel;
  riskLevel: RiskLevel;
  categories?: string[];
}

export interface NormalizedQuery {
  tokens: Set<string>;
  phrases: Set<string>;
}

export const STATE_ORDER: Record<CapabilityState, number> = {
  DISCOVERED: 0,
  INSTALLED: 1,
  AVAILABLE: 2,
  ENABLED: 3,
  CANDIDATE: 4,
  ACTIVE: 5,
  SUSPENDED: 6,
  BLOCKED: 7,
  DISABLED: 8,
  FAILED: 9,
  OUTDATED: 10,
};
