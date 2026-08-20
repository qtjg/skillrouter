import type { Capability } from "../core/types.ts";

export type PlanNodeKind = "root" | "capability" | "group";

export type PlanNodeStatus = "satisfied" | "missing" | "conflict" | "skipped" | "pending";

export interface PlanNode {
  id: string;
  kind: PlanNodeKind;
  /** Set for capability nodes. */
  capabilityId?: string;
  label: string;
  depth: number;
  order: number;
  status: PlanNodeStatus;
  children: PlanNode[];
}

export type PlanLinkRelation = "requires" | "enhances" | "conflicts-with" | "fallback-of";

export interface PlanLink {
  from: string;
  to: string;
  rel: PlanLinkRelation;
}

/**
 * Explicit capability composition plan (PRD v2.0 D5): a DAG over capabilities,
 * where `requires` edges derive from a capability's `capabilities[]` list,
 * plus declared `enhances`/`conflicts-with`/`fallback-of` relations.
 */
export interface PlanDag {
  root: PlanNode;
  nodes: PlanNode[];
  links: PlanLink[];
}

export interface PlanValidation {
  valid: boolean;
  cycles: Array<{ path: string[] }>;
  missing: Array<{ capabilityId: string; requiredBy: string }>;
  conflicts: Array<{ a: string; b: string }>;
  warnings: string[];
}

export interface PlanStep {
  /** Node id being executed. */
  nodeId: string;
  capabilityId: string;
  label: string;
  depth: number;
}

export interface ComposedPlan {
  dag: PlanDag;
  validation: PlanValidation;
  /** Topologically ordered execution steps. */
  steps: PlanStep[];
}

export interface PlanInput {
  /** Capabilities known to the registry. */
  registry: Map<string, Capability>;
  /** Root capability ids to compose (empty = whole registry). */
  roots: string[];
  /** Excluded capability ids (composition guidance). */
  exclude?: string[];
}

export function isCapabilityNode(node: PlanNode): node is PlanNode & { capabilityId: string } {
  return node.kind === "capability" && typeof node.capabilityId === "string";
}