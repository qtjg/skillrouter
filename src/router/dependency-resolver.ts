import type { Capability, Dependency } from "../core/types.ts";

/**
 * Dependency resolution for the routing pipeline.
 *
 * Capabilities may declare `dependencies` (required or optional) that must be
 * satisfied before the capability can do its job. This module computes:
 *
 * - a deterministic activation order (dependencies first, Kahn topological
 *   sort), so the runtime can activate in the right sequence;
 * - required dependencies that are missing from the capability universe and
 *   must be installed first;
 * - optional dependencies that were tolerated (reported, not fatal);
 * - dependency cycles, which would otherwise deadlock the activation order.
 *
 * The resolver is a pure function of capability metadata — it never touches
 * the filesystem or storage.
 */

export interface MissingDependency {
  id: string;
  version?: string;
  requiredBy: string[];
}

export interface OptionalMiss {
  id: string;
  requiredBy: string;
}

export interface DependencyResolution {
  /** Deterministic activation order covering the requested ids and all their
   *  satisfiable (present) dependencies, dependencies first. */
  ordered: string[];
  /** Required dependencies that do not exist in the capability universe. */
  missing: MissingDependency[];
  /** Optional dependencies that could not be satisfied. */
  optionalMiss: OptionalMiss[];
  /** Simple dependency cycles detected among the requested closures. */
  cycles: string[][];
  /** Transitive dependency closure per requested id (excluding the id itself). */
  closure: Map<string, string[]>;
}

export function requiredDependencies(capability: Capability): Dependency[] {
  return (capability.dependencies ?? []).filter((d) => d.optional !== true);
}

export function optionalDependencies(capability: Capability): Dependency[] {
  return (capability.dependencies ?? []).filter((d) => d.optional === true);
}

function capacityById(universe: readonly Capability[]): Map<string, Capability> {
  const byId = new Map<string, Capability>();
  for (const capability of universe) byId.set(capability.id, capability);
  return byId;
}

/**
 * Expands the requested capability ids to include their transitive dependency
 * closure and reports everything that cannot be satisfied.
 */
export function expandDependencies(ids: string[], universe: readonly Capability[]): DependencyResolution {
  const byId = capacityById(universe);
  const requested = ids.filter((id) => byId.has(id));

  const missing: MissingDependency[] = [];
  const optionalMiss: OptionalMiss[] = [];

  const closureSet = new Set<string>(requested);
  const pending = [...requested];
  while (pending.length > 0) {
    const id = pending.pop()!;
    const capability = byId.get(id);
    if (!capability) continue;
    for (const dep of capability.dependencies ?? []) {
      if (dep.optional) {
        if (!byId.has(dep.id)) optionalMiss.push({ id: dep.id, requiredBy: id });
        continue;
      }
      if (!byId.has(dep.id)) {
        const record = missing.find((m) => m.id === dep.id);
        if (record) {
          record.requiredBy.push(id);
        } else {
          missing.push({ id: dep.id, version: dep.version, requiredBy: [id] });
        }
        continue;
      }
      if (!closureSet.has(dep.id)) {
        closureSet.add(dep.id);
        pending.push(dep.id);
      }
    }
  }

  const ordered = sortByDependencies([...closureSet], byId);
  missing.forEach((m) => m.requiredBy.sort());
  ordered.cycles.sort((a, b) => a.length - b.length || a[0]!.localeCompare(b[0]!));

  const closure = new Map<string, string[]>();
  for (const id of requested) {
    const seen = new Set<string>();
    const stack = [...(byId.get(id)?.dependencies ?? []).filter((d) => d.optional !== true).map((d) => d.id)];
    while (stack.length > 0) {
      const depId = stack.pop()!;
      if (seen.has(depId)) continue;
      seen.add(depId);
      const dep = byId.get(depId);
      if (dep) {
        for (const next of (dep.dependencies ?? []).filter((d) => d.optional !== true).map((d) => d.id)) {
          if (!seen.has(next)) stack.push(next);
        }
      }
    }
    if (seen.size > 0) closure.set(id, [...seen]);
  }

  return { ordered: ordered.ordered, missing, optionalMiss, cycles: ordered.cycles, closure };
}

/**
 * Topological sort of `ids` so that every capability comes after its required
 * dependencies. Deterministic: equal-priority ids are ordered by id.
 * Cycles are extracted (not fatal): members of a cycle are emitted in id order.
 */
export function sortByDependencies(ids: string[], byId: ReadonlyMap<string, Capability>): { ordered: string[]; cycles: string[][] } {
  const nodes = [...new Set(ids)].sort();
  const present = new Set(nodes);

  const dependents = new Map<string, string[]>(); // dep id -> dependent ids
  const dependencyCount = new Map<string, number>(); // id -> number of present, required deps
  for (const id of nodes) {
    const capability = byId.get(id);
    const deps = (capability?.dependencies ?? [])
      .filter((d) => d.optional !== true && present.has(d.id) && d.id !== id)
      .map((d) => d.id);
    dependencyCount.set(id, deps.length);
    for (const dep of deps) {
      const list = dependents.get(dep) ?? [];
      list.push(id);
      dependents.set(dep, list);
    }
  }

  const ordered: string[] = [];
  const ready = nodes.filter((id) => (dependencyCount.get(id) ?? 0) === 0);
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (dependencyCount.get(dependent) ?? 1) - 1;
      dependencyCount.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  const left = nodes.filter((id) => !ordered.includes(id));
  const cycles: string[][] = [];
  const seen = new Set<string>();
  for (const start of left) {
    if (seen.has(start)) continue;
    const cycle = simpleCycle(start, byId, present);
    if (cycle.length > 0) {
      cycles.push(cycle);
      for (const id of cycle) seen.add(id);
    }
  }
  for (const id of left) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return { ordered, cycles };
}

function simpleCycle(start: string, byId: ReadonlyMap<string, Capability>, present: Set<string>): string[] {
  const visited = new Set<string>([start]);
  const path: string[] = [start];
  const dfs = (current: string): string[] | null => {
    for (const next of (byId.get(current)?.dependencies ?? []).filter((d) => d.optional !== true && present.has(d.id)).map((d) => d.id)) {
      if (next === start) return [...path, start];
      if (visited.has(next)) continue;
      visited.add(next);
      path.push(next);
      const found = dfs(next);
      if (found) return found;
      path.pop();
    }
    return null;
  };
  return dfs(start) ?? [];
}