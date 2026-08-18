import type { Capability, CapabilityState } from "../core/types.ts";

const NOW = new Date().toISOString();

function cap(id: string, name: string, overrides: Partial<Capability> = {}): Capability {
  const base: Capability = {
    id,
    name,
    description: name,
    version: "1.0.0",
    type: "skill",
    compatibility: { opencode: "native", claude: "compatible", gemini: "compatible" },
    permissions: {
      filesystem: { read: false, write: false },
      network: { allowed: [] },
      shell: { enabled: false },
    },
    risk: { declared: "low", score: 10 },
    metadata: { tags: [], categories: [] },
    trust: "community",
    source: { type: "catalog", location: "builtin", catalog: "examples/catalog" },
  };
  return { ...base, ...overrides };
}

export function mockCapabilities(): Capability[] {
  const caps = [
    cap("cap:test-writer", "Test Writer", {
      description: "Writes unit tests for JavaScript/TypeScript projects",
      metadata: { tags: ["testing", "typescript", "javascript"] },
      triggers: { keywords: ["test", "spec", "unit", "coverage"], intents: ["write tests", "add tests", "unit test"] },
      context: { estimatedTokens: 1200 },
    }),
    cap("cap:security-audit", "Security Auditor", {
      description: "Scans code and dependencies for vulnerabilities",
      metadata: { tags: ["security", "audit"] },
      triggers: { keywords: ["audit", "vulnerability", "security", "cve"], intents: ["audit security", "check vulnerabilities"] },
      risk: { declared: "medium", score: 45 },
      context: { estimatedTokens: 2000 },
    }),
    cap("cap:ui-design", "UI Designer", {
      description: "Creates frontend components and design systems",
      metadata: { tags: ["frontend", "ui"] },
      triggers: { keywords: ["component", "design", "css", "react"], intents: ["design ui", "create component"] },
      context: { estimatedTokens: 900 },
    }),
    cap("cap:deployer", "Deployer", {
      description: "Builds and deploys applications to production",
      metadata: { tags: ["deployment", "devops"] },
      triggers: { keywords: ["deploy", "docker", "kubernetes", "pipeline"], intents: ["deploy app", "build pipeline"] },
      permissions: { filesystem: { read: true, write: true }, network: { allowed: ["*"] }, shell: { enabled: true } },
      risk: { declared: "high", score: 78 },
      context: { estimatedTokens: 3000 },
    }),
    cap("cap:docs-writer", "Docs Writer", {
      description: "Writes documentation and README files",
      metadata: { tags: ["documentation"] },
      triggers: { keywords: ["docs", "readme", "changelog", "guide"], intents: ["write docs", "document"] },
      context: { estimatedTokens: 800 },
    }),
  ];
  // dedupe against IDs
  return caps;
}

export interface MockInstalledRow {
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

export function mockInstalled(): Map<string, MockInstalledRow> {
  const map = new Map<string, MockInstalledRow>();
  map.set("cap:test-writer", { id: "cap:test-writer", version: "1.0.0", state: "ACTIVE", installRoot: "/tmp/sr/test-writer", agents: ["opencode"], installedAt: NOW, updatedAt: NOW, sourceType: "catalog", sourceLocation: "builtin" });
  map.set("cap:docs-writer", { id: "cap:docs-writer", version: "1.0.0", state: "ENABLED", installRoot: "/tmp/sr/docs-writer", agents: [], installedAt: NOW, updatedAt: NOW, sourceType: "catalog", sourceLocation: "builtin" });
  return map;
}