import type { Capability } from "../core/types.ts";

export type GraphRelation = "requires" | "conflicts" | "enhances" | "replaces" | "compatibleWith";

export interface GraphEdge {
  from: string;
  to: string;
  relation: GraphRelation;
  optional?: boolean;
}

export interface GraphProblem {
  id: string;
  relation: GraphRelation | "dependency";
  message: string;
}

/**
 * Directed relationship graph over capabilities.
 *
 * Relations are read from the canonical Capability model:
 *   requires      -> capability.dependencies (id + optional flag)
 *   conflicts     -> capability.conflicts (treated as symmetric)
 *   enhances      -> capability.enhances
 *   replaces      -> capability.replaces
 *   compatibleWith-> capability.compatibleWith (environment/ecosystem tags,
 *                    not capability ids, so never validated as refs)
 */
export class CapabilityGraph {
  private readonly nodes = new Map<string, Capability>();
  private readonly requires = new Map<string, string[]>();
  private readonly optionalRequires = new Map<string, string[]>();
  private readonly requiredBy = new Map<string, string[]>();
  private readonly conflicts = new Map<string, string[]>();
  private readonly enhances = new Map<string, string[]>();
  private readonly enhancedBy = new Map<string, string[]>();
  private readonly replaces = new Map<string, string[]>();
  private readonly replacedBy = new Map<string, string[]>();
  private readonly compatibleWith = new Map<string, string[]>();

  static build(capabilities: Capability[]): CapabilityGraph {
    const graph = new CapabilityGraph();
    for (const capability of capabilities) graph.add(capability);
    return graph;
  }

  add(capability: Capability): void {
    if (this.nodes.has(capability.id)) return;
    this.nodes.set(capability.id, capability);
    const addEdge = (map: Map<string, string[]>, target: string): void => {
      const list = map.get(capability.id) ?? [];
      if (!list.includes(target)) list.push(target);
      map.set(capability.id, list);
    };
    for (const dep of capability.dependencies ?? []) {
      const map = dep.optional ? this.optionalRequires : this.requires;
      addEdge(map, dep.id);
      if (dep.id === capability.id) continue;
      const reverse = this.requiredBy.get(dep.id) ?? [];
      if (!reverse.includes(capability.id)) reverse.push(capability.id);
      this.requiredBy.set(dep.id, reverse);
    }
    for (const id of capability.conflicts ?? []) {
      addEdge(this.conflicts, id);
      const reverse = this.conflicts.get(id) ?? [];
      if (!reverse.includes(capability.id)) reverse.push(capability.id);
      this.conflicts.set(id, reverse);
    }
    for (const id of capability.enhances ?? []) {
      addEdge(this.enhances, id);
      const reverse = this.enhancedBy.get(id) ?? [];
      if (!reverse.includes(capability.id)) reverse.push(capability.id);
      this.enhancedBy.set(id, reverse);
    }
    for (const id of capability.replaces ?? []) {
      addEdge(this.replaces, id);
      const reverse = this.replacedBy.get(id) ?? [];
      if (!reverse.includes(capability.id)) reverse.push(capability.id);
      this.replacedBy.set(id, reverse);
    }
    for (const id of capability.compatibleWith ?? []) addEdge(this.compatibleWith, id);
  }

  size(): number {
    return this.nodes.size;
  }

  ids(): string[] {
    return [...this.nodes.keys()];
  }

  get(id: string): Capability | null {
    return this.nodes.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  /** Transitive closure of required capabilities (sorted, self excluded). */
  dependenciesOf(id: string, options: { includeOptional?: boolean; recursive?: boolean } = {}): string[] {
    const { includeOptional = false, recursive = true } = options;
    const visited = new Set<string>();
    const visit = (current: string): void => {
      for (const dep of this.requires.get(current) ?? []) {
        if (dep === current || visited.has(dep)) continue;
        visited.add(dep);
        if (recursive) visit(dep);
      }
      if (includeOptional) {
        for (const dep of this.optionalRequires.get(current) ?? []) {
          if (dep === current || visited.has(dep)) continue;
          visited.add(dep);
          if (recursive) visit(dep);
        }
      }
    };
    if (!this.nodes.has(id)) return [];
    visit(id);
    return [...visited].sort();
  }

  /** Capabilities that transitively require the given one. */
  dependentsOf(id: string): string[] {
    const visited = new Set<string>();
    const visit = (current: string): void => {
      for (const parent of this.requiredBy.get(current) ?? []) {
        if (!visited.has(parent)) {
          visited.add(parent);
          visit(parent);
        }
      }
    };
    visit(id);
    return [...visited].sort();
  }

  /** Required capabilities that must be present before this one (non-optional, transitive). */
  prerequisitesOf(id: string): string[] {
    return this.dependenciesOf(id, { includeOptional: false });
  }

  /** Symmetric conflict partners (declared directly or by the partner). */
  conflictingWith(id: string): string[] {
    const direct = this.conflicts.get(id) ?? [];
    const declaredByOthers = [...this.conflicts.entries()]
      .filter(([from, targets]) => from !== id && targets.includes(id))
      .map(([from]) => from);
    return [...new Set([...direct, ...declaredByOthers])].sort();
  }

  /** Capabilities this one enhances. */
  enhancementsOf(id: string): string[] {
    return [...(this.enhances.get(id) ?? [])].sort();
  }

  /** Capabilities that enhance this one. */
  enhancersOf(id: string): string[] {
    return [...(this.enhancedBy.get(id) ?? [])].sort();
  }

  /** Capabilities declared to replace the given one (replacement discovery). */
  replacementsFor(id: string): string[] {
    return [...(this.replacedBy.get(id) ?? [])].sort();
  }

  /** Capabilities the given one replaces. */
  replacedByIds(id: string): string[] {
    return [...(this.replaces.get(id) ?? [])].sort();
  }

  /** Environment/ecosystem tags the capability declares compatibility with. */
  compatibleTagsOf(id: string): string[] {
    return [...(this.compatibleWith.get(id) ?? [])].sort();
  }

  /**
   * Cluster around a capability: everything reachable through requires and
   * enhances edges within a bounded depth. Used for task-driven discovery.
   */
  cluster(id: string, options: { maxDepth?: number } = {}): string[] {
    const maxDepth = options.maxDepth ?? 2;
    if (!this.nodes.has(id)) return [];
    const visited = new Set<string>([id]);
    const queue: Array<{ current: string; depth: number }> = [{ current: id, depth: 0 }];
    while (queue.length > 0) {
      const { current, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;
      const next: string[] = [
        ...(this.requires.get(current) ?? []),
        ...(this.optionalRequires.get(current) ?? []),
        ...(this.enhances.get(current) ?? []),
      ];
      for (const target of next) {
        if (!visited.has(target)) {
          visited.add(target);
          queue.push({ current: target, depth: depth + 1 });
        }
      }
    }
    visited.delete(id);
    return [...visited].sort();
  }

  /** Structural validation: unknown refs, self refs, cycles, unsafe pairs. */
  validate(): GraphProblem[] {
    const problems: GraphProblem[] = [];
    for (const id of this.ids()) {
      for (const relation of ["requires", "conflicts", "enhances", "replaces"] as const) {
        const targets =
          relation === "requires"
            ? [...(this.requires.get(id) ?? []), ...(this.optionalRequires.get(id) ?? [])]
            : this[relation].get(id) ?? [];
        if (targets.includes(id)) {
          problems.push({ id, relation, message: `self-referencing ${relation} edge` });
        }
        for (const target of targets) {
          if (!this.nodes.has(target)) {
            problems.push({ id, relation, message: `${relation} references unknown capability "${target}"` });
          }
        }
      }
      for (const conflict of this.conflicts.get(id) ?? []) {
        if ((this.requires.get(id) ?? []).includes(conflict) || (this.optionalRequires.get(id) ?? []).includes(conflict)) {
          problems.push({ id, relation: "dependency", message: `conflicts with required capability "${conflict}"` });
        }
      }
    }
    for (const cycle of this.findCycles(this.requires)) {
      problems.push({ id: cycle[0]!, relation: "requires", message: `dependency cycle: ${cycle.join(" -> ")}` });
    }
    for (const cycle of this.findCycles(this.replaces)) {
      problems.push({ id: cycle[0]!, relation: "replaces", message: `replacement cycle: ${cycle.join(" -> ")}` });
    }
    return problems;
  }

  edges(): GraphEdge[] {
    const out: GraphEdge[] = [];
    for (const id of this.ids()) {
      for (const to of this.requires.get(id) ?? []) out.push({ from: id, to, relation: "requires" });
      for (const to of this.optionalRequires.get(id) ?? []) out.push({ from: id, to, relation: "requires", optional: true });
      for (const to of this.conflicts.get(id) ?? []) out.push({ from: id, to, relation: "conflicts" });
      for (const to of this.enhances.get(id) ?? []) out.push({ from: id, to, relation: "enhances" });
      for (const to of this.replaces.get(id) ?? []) out.push({ from: id, to, relation: "replaces" });
      for (const to of this.compatibleWith.get(id) ?? []) out.push({ from: id, to, relation: "compatibleWith" });
    }
    return out.sort((a, b) => (a.from + a.relation + a.to).localeCompare(b.from + b.relation + b.to));
  }

  private findCycles(adjacency: Map<string, string[]>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack: string[] = [];
    const onStack = new Set<string>();

    const dfs = (current: string): void => {
      if (onStack.has(current)) {
        const start = stack.indexOf(current);
        const cycle = [...stack.slice(start), current];
        const normalized = [...cycle.slice(0, -1)].sort();
        if (!cycles.some((existing) => existing.slice(0, -1).sort().join(",") === normalized.join(","))) {
          cycles.push(cycle);
        }
        return;
      }
      if (visited.has(current)) return;
      visited.add(current);
      stack.push(current);
      onStack.add(current);
      for (const next of adjacency.get(current) ?? []) dfs(next);
      stack.pop();
      onStack.delete(current);
    };

    for (const id of this.ids()) dfs(id);
    return cycles;
  }
}