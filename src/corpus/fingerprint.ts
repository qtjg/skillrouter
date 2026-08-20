import { createHash } from "node:crypto";

/**
 * Deterministic JSON stringification: recursively sorts object keys so equal
 * structures always produce identical bytes regardless of key insertion order.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}