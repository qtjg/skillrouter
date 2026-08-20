export type SkillRouterEvent =
  | { event: "task.started"; task: string; project: string | null }
  | { event: "task.changed"; task: string; project: string | null; agent?: string }
  | { event: "file.changed"; path: string }
  | { event: "git.changed"; files: string[] }
  | { event: "capability.discovered"; id: string; source: string }
  | { event: "corpus.indexed"; id: string; changed: boolean }
  | { event: "retrieval.queried"; query: string; hits: number }
  | { event: "capability.installed"; id: string; version: string }
  | { event: "capability.activated"; id: string; agent: string }
  | { event: "capability.failed"; id: string; error: string }
  | { event: "capability.fallback"; capability: string; fallback: string; reason: string }
  | { event: "capability.deactivated"; id: string; agent: string }
  | { event: "capability.disabled"; id: string }
  | { event: "capability.enabled"; id: string }
  | { event: "agent.detected"; agent: string }
  | { event: "permission.requested"; capability: string; permission: string }
  | { event: "router.decided"; decisionId: string; task: string; activations: string[]; deactivations: string[] }
  | { event: "metrics.updated"; capabilityId: string; successRate: number; ok: "success" | "failure"; context: string | null }
  | { event: "feedback.received"; executionId: string; capabilityId: string; success: boolean; latencyMs: number | null; verification: "pass" | "fail" | null; rating: number | null; observations: number };

export type EventName = SkillRouterEvent["event"];

type Handler<T extends SkillRouterEvent> = (payload: T) => void;

export class EventBus {
  private handlers: Map<EventName, Array<Handler<SkillRouterEvent>>> = new Map();
  private history: SkillRouterEvent[] = [];

  on<T extends SkillRouterEvent>(event: T["event"], handler: Handler<T>): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as Handler<SkillRouterEvent>);
    this.handlers.set(event, list);
    return () => {
      const current = this.handlers.get(event);
      if (!current) return;
      this.handlers.set(event, current.filter((h) => h !== handler));
    };
  }

  emit(event: SkillRouterEvent): void {
    this.history.push(event);
    if (this.history.length > 1000) this.history.shift();
    const list = this.handlers.get(event.event);
    if (!list) return;
    for (const handler of list) {
      try {
        handler(event);
      } catch {
        // A failing listener must never break the bus.
      }
    }
  }

  getHistory(): SkillRouterEvent[] {
    return [...this.history];
  }

  clear(): void {
    this.history = [];
  }
}

export const globalBus = new EventBus();
