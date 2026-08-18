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

export async function getAdapterRegistry(ctx: DetectionContext): Promise<AdapterRegistry> {
  if (instance) return instance;
  instance = new AdapterRegistry();
  const { OpencodeAdapter } = await import("./opencode.ts");
  const { ClaudeAdapter } = await import("./claude.ts");
  const { GeminiAdapter } = await import("./gemini.ts");
  const { McpAdapter } = await import("./mcp.ts");
  const { GenericAdapter } = await import("./generic.ts");
  instance.register(new OpencodeAdapter(ctx));
  instance.register(new ClaudeAdapter(ctx));
  instance.register(new GeminiAdapter(ctx));
  instance.register(new McpAdapter(ctx));
  instance.register(new GenericAdapter(ctx));
  return instance;
}

export function resetAdapterRegistry(): void {
  instance = null;
}