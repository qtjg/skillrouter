export function deepMerge<T>(base: T, override: unknown): T {
  if (override === null || override === undefined) return base;
  if (typeof override !== "object" || Array.isArray(override) || typeof base !== "object" || base === null || Array.isArray(base)) {
    return (override as T) ?? base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === undefined) continue;
    const existing = out[key];
    out[key] = deepMerge(existing, value);
  }
  return out as T;
}