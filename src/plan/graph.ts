import type { Capability } from "../core/types.ts";
import type { PlanDag, PlanInput, PlanLink, PlanLinkRelation, PlanNode, PlanNodeStatus, PlanValidation } from "./types.ts";

/** Resolve `enhances` / `conflicts` / `fallback-of` links declared in a manifest. */
function declaredLinks(capability: Capability): PlanLink[] {
  const links: PlanLink[] = [];
  const id = capability.id;
  for (const name of capability.enhances ?? []) {
    links.push({ from: id, to: name, rel: "enhances" });
  }
  for (const name of capability.conflicts ?? []) {
    links.push({ from: id, to: name, rel: "conflicts-with" });
  }
  for (const name of capability.fallbacks ?? []) {
    links.push({ from: id, to: name, rel: "fallback-of" });
  }
  return links;
}

export function buildPlanDag(input: PlanInput): PlanDag {
  const excluded = new Set(input.exclude ?? []);
  const nodes: PlanNode[] = [];
  const links: PlanLink[] = [];
  const created = new Set<string>();
  const orderCounter = [0];

  function createNode(
    capability: Capability,
    depth: number,
    status: PlanNodeStatus,
  ): PlanNode {
    const order = (orderCounter[0] ?? 0) + 1;
    orderCounter[0] = order;
    const node: PlanNode = {
      id: capability.id,
      kind: "capability",
      capabilityId: capability.id,
      label: capability.name,
      depth,
      order,
      status,
      children: [],
    };
    nodes.push(node);
    created.add(capability.id);
    return node;
  }

  function expand(container: PlanNode, capability: Capability, depth: number, visited: string[]): void {
    if (depth > 32) return;
    const kids = capability.capabilities ?? [];
    for (const childId of kids) {
      const target = input.registry.get(childId);
      const missing = target === undefined;
      const exists = created.has(childId);

      if (visited.includes(childId) && exists && !excluded.has(childId)) {
        container.children.push(findNode(childId)!);
        links.push({ from: capability.id, to: childId, rel: "requires" });
        continue;
      }
      if (exists && excluded.has(childId)) continue;
      if (exists) {
        if (!container.children.some((c) => c.id === childId)) container.children.push(findNode(childId)!);
        continue;
      }
      if (missing) {
        const node = {
          id: childId,
          kind: "capability" as const,
          capabilityId: childId,
          label: childId,
          depth,
          order: (orderCounter[0] ?? 0) + 1,
          status: "missing" as const,
          children: [],
        };
        orderCounter[0] = node.order;
        nodes.push(node);
        container.children.push(node);
        links.push({ from: capability.id, to: childId, rel: "requires" });
        continue;
      }

      if (excluded.has(childId)) {
        const node = createNode(target, depth, "skipped");
        container.children.push(node);
        links.push({ from: capability.id, to: childId, rel: "requires" });
        continue;
      }

      if (visited.includes(childId) || excluded.has(childId)) {
        links.push({ from: capability.id, to: childId, rel: "requires" });
        continue;
      }

      const node = createNode(target, depth, "pending");
      container.children.push(node);
      links.push({ from: capability.id, to: childId, rel: "requires" });
      expand(node, target, depth + 1, [...visited, capability.id]);
    }
  }

  function findNode(id: string): PlanNode | undefined {
    return nodes.find((n) => n.id === id);
  }

  const roots = input.roots.length > 0 ? input.roots : [...input.registry.keys()].sort();

  const root: PlanNode = {
    id: "root",
    kind: "root",
    label: "plan",
    depth: 0,
    order: -1,
    status: "pending",
    children: [],
  };
  nodes.push(root);

  for (const rootId of roots) {
    const capability = input.registry.get(rootId);
    if (!capability) {
      const node = {
        id: rootId,
        kind: "capability" as const,
        capabilityId: rootId,
        label: rootId,
        depth: 1,
        order: (orderCounter[0] ?? 0) + 1,
        status: "missing" as const,
        children: [],
      };
      orderCounter[0] = node.order;
      nodes.push(node);
      root.children.push(node);
      continue;
    }
    if (created.has(rootId)) continue;
    const node = createNode(capability, 1, "pending");
    root.children.push(node);
    created.add(rootId);
    expand(node, capability, 2, [rootId]);
  }

  for (const node of nodes) {
    if (node.kind !== "capability" || node.capabilityId === undefined) continue;
    const capability = input.registry.get(node.capabilityId);
    if (!capability) continue;
    for (const link of declaredLinks(capability)) links.push(link);
  }

  return { root, nodes, links };
}

/** DFS-based cycle detection over `requires` edges (deterministic id order). */
export function detectCycles(dag: PlanDag): Array<{ path: string[] }> {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const cycles: Array<{ path: string[] }> = [];
  const requires = new Map<string, string[]>();
  for (const link of dag.links) {
    if (link.rel !== "requires") continue;
    const list = requires.get(link.from) ?? [];
    list.push(link.to);
    requires.set(link.from, list);
  }
  const path: string[] = [];

  function visit(id: string): void {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      if (start >= 0) cycles.push({ path: [...path.slice(start), id] });
      return;
    }
    visiting.add(id);
    path.push(id);
    for (const next of (requires.get(id) ?? []).slice().sort()) visit(next);
    path.pop();
    visiting.delete(id);
    done.add(id);
  }

  for (const node of dag.nodes) if (node.kind === "capability") visit(node.capabilityId ?? node.id);
  return cycles.sort((a, b) => a.path.join(">").localeCompare(b.path.join(">")));
}

/** Resolve node statuses after graph inspection. */
export function classifyStatuses(dag: PlanDag, validation: PlanValidation): void {
  const conflictIds = new Set(validation.conflicts.flatMap((c) => [c.a, c.b]));
  const inCycle = new Set(validation.cycles.flatMap((c) => c.path));
  for (const node of dag.nodes) {
    if (node.kind !== "capability") continue;
    if (node.status === "missing" || node.status === "skipped") continue;
    if (node.id === "root") continue;
    if (inCycle.has(node.capabilityId ?? node.id)) {
      node.status = "skipped";
    } else if (conflictIds.has(node.capabilityId ?? node.id)) {
      node.status = "conflict";
    } else {
      node.status = "satisfied";
    }
  }
}

export function validatePlan(dag: PlanDag, known: Set<string>): PlanValidation {
  const validation: PlanValidation = { valid: true, cycles: [], missing: [], conflicts: [], warnings: [] };
  const byId = new Map(dag.nodes.map((n) => [n.id, n]));

  validation.cycles = detectCycles(dag);

  for (const link of dag.links) {
    if (link.rel === "requires") {
      if (!known.has(link.to) || !byId.has(link.to)) {
        validation.missing.push({ capabilityId: link.to, requiredBy: link.from });
      }
    }
  }
  validation.missing = validation.missing.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId) || a.requiredBy.localeCompare(b.requiredBy));

  const seenConflict = new Set<string>();
  for (const link of dag.links) {
    if (link.rel !== "conflicts-with") continue;
    if (validation.cycles.some((c) => c.path.includes(link.from) && c.path.includes(link.to))) continue;
    if (!known.has(link.to)) continue;
    const triple = [link.from, link.to].sort().join(":");
    if (seenConflict.has(triple)) continue;
    seenConflict.add(triple);
    validation.conflicts.push({ a: link.from, b: link.to });
  }
  validation.conflicts = validation.conflicts.sort((a, b) => a.a.localeCompare(b.a) || a.b.localeCompare(b.b));

  const stale = dag.links.filter((l) => l.rel !== "requires" && l.rel !== "conflicts-with" && !known.has(l.to));
  for (const link of stale) {
    validation.warnings.push(`unresolved ${link.rel} reference "${link.to}" (${link.from})`);
  }
  validation.warnings = validation.warnings.sort();

  validation.valid = validation.cycles.length === 0 && validation.missing.length === 0 && validation.conflicts.length === 0;
  return validation;
}

/**
 * Kahn topological order over `requires` edges, deterministic on node order.
 * Returns dependencies before dependents (edge a->b means `b` is required by `a`,
 * so `b` must run first).
 */
export function linearize(dag: PlanDag): string[] {
  const order: string[] = [];
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const ids = dag.nodes.map((n) => n.id).sort();

  for (const id of ids) indegree.set(id, 0);
  for (const link of dag.links) {
    if (link.rel !== "requires") continue;
    indegree.set(link.to, (indegree.get(link.to) ?? 0) + 1);
    const list = dependents.get(link.from) ?? [];
    list.push(link.to);
    dependents.set(link.from, list);
  }

  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of (dependents.get(id) ?? []).slice().sort()) {
      const deg = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, deg);
      if (deg === 0) ready.push(next);
      ready.sort();
    }
  }
  return order.reverse();
}

/** Render the DAG as an ASCII tree (used by the CLI). */
export function renderTree(root: PlanNode): string[] {
  const lines: string[] = [];
  function walk(node: PlanNode, prefix: string, isLast: boolean, seen: Set<string>): void {
    const marker = isLast ? "└─" : "├─";
    const status = node.status === "pending" ? "" : ` [${node.status}]`;
    lines.push(`${prefix}${marker} ${node.label}${status}`);
    if (seen.has(node.id)) return;
    const kids = [...node.children].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const nextSeen = new Set(seen).add(node.id);
    kids.forEach((child, i) => walk(child, prefix + (isLast ? "   " : "│  "), i === kids.length - 1, nextSeen));
  }
  walk(root, "", true, new Set());
  return lines;
}