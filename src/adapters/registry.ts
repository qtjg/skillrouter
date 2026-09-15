import type { AgentAdapter } from "./types.ts";
import type { AgentId } from "../core/types.ts";
import { AdapterError } from "../utils/errors.ts";
import type { DetectionContext } from "./env.ts";

/**
 * Adapter registry. The core never imports adapter implementations directly;
 * it resolves them through this registry keyed by agent id.
 */
export class AdapterRegistry {
  private adapters = new Map<AgentId, AgentAdapter>();

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: AgentId): AgentAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new AdapterError(`No adapter registered for agent "${id}"`);
    return adapter;
  }

  has(id: AgentId): boolean {
    return this.adapters.has(id);
  }

  all(): AgentAdapter[] {
    return [...this.adapters.values()];
  }

  ids(): AgentId[] {
    return [...this.adapters.keys()];
  }
}

let instance: AdapterRegistry | null = null;

export async function getAdapterRegistry(ctx: DetectionContext, customAgents: import("../config/config.ts").CustomAgentConfig[] = []): Promise<AdapterRegistry> {
  if (instance) return instance;
  instance = new AdapterRegistry();
  const { OpencodeAdapter } = await import("./opencode.ts");
  const { ClaudeAdapter } = await import("./claude.ts");
  const { GeminiAdapter } = await import("./gemini.ts");
  const { McpAdapter } = await import("./mcp.ts");
  const { GenericAdapter } = await import("./generic.ts");
  const { CodexAdapter } = await import("./codex.ts");
  const { AiderAdapter } = await import("./aider.ts");
  const { ClineAdapter } = await import("./cline.ts");
  const { CursorAdapter } = await import("./cursor.ts");
  const { CopilotAdapter } = await import("./copilot.ts");
  const { WindsurfAdapter } = await import("./windsurf.ts");
  instance.register(new OpencodeAdapter(ctx));
  instance.register(new ClaudeAdapter(ctx));
  instance.register(new GeminiAdapter(ctx));
  instance.register(new McpAdapter(ctx));
  instance.register(new GenericAdapter(ctx));
  instance.register(new CodexAdapter(ctx));
  instance.register(new AiderAdapter(ctx));
  instance.register(new ClineAdapter(ctx));
  instance.register(new CursorAdapter(ctx));
  instance.register(new CopilotAdapter(ctx));
  instance.register(new WindsurfAdapter(ctx));
  if (customAgents.length > 0) {
    const { CustomAgentAdapter } = await import("./custom.ts");
    instance.register(new CustomAgentAdapter(ctx, customAgents));
  }
  return instance;
}

export function resetAdapterRegistry(): void {
  instance = null;
}