/**
 * Pluggable context layer (PRD §Phase D). Providers collect raw fragments;
 * {@link NormalizedContext} is the flattened, bounded, sanitized view that
 * flows into routing/scoring.
 */

export type ContextValue = string | number | boolean | string[];

/** Normalized dotted fields, e.g. `project.language` → `["typescript"]`. */
export type NormalizedFields = Record<string, ContextValue>;

export interface ContextInput {
  cwd: string;
  signal?: AbortSignal;
}

/** Raw output of a single provider before normalization. */
export interface ContextFragment {
  provider: string;
  data: Record<string, unknown> | null;
}

export interface ContextProvider {
  name: string;
  description?: string;
  priority?: number;
  collect(input: ContextInput): Promise<Record<string, unknown> | null>;
}

export interface ProviderTiming {
  provider: string;
  ok: boolean;
  timedOut?: boolean;
  elapsedMs: number;
}

/** The bounded, sanitized context view used by the rest of the system. */
export interface NormalizedContext {
  fields: NormalizedFields;
  warnings: string[];
  timeline: ProviderTiming[];
  collectedAt: string;
}

export interface CollectContextOptions {
  timeoutMs?: number;
  enabled?: boolean;
  providers?: ContextProvider[];
}