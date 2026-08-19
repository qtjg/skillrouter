import type { ContextFragment, ContextValue, NormalizedFields, ProviderTiming } from "./types.ts";

const MAX_DEPTH = 3;
const MAX_STRING = 200;
const MAX_ARRAY = 10;
const MAX_FIELDS = 200;

const SENSITIVE_KEY = /(^|[_.])?(token|secret|password|passwd|api[_-]?key|private[_-]?key|access[_-]?key|auth|credential|cookie|session)/i;

const VALUE_SECRET_PATTERNS = [
  /sk_live_[a-zA-Z0-9]{16,}/,
  /sk-proj-[a-zA-Z0-9-_]{20,}/,
  /gh[pousr]_[a-zA-Z0-9]{36,}/,
  /AKIA[0-9A-Z]{16}/,
  /npm_[a-zA-Z0-9]{36}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN .*PRIVATE KEY-----/,
];

function redactValue(key: string, value: string | number | boolean): ContextValue {
  if (typeof value === "string") {
    if (SENSITIVE_KEY.test(key) || VALUE_SECRET_PATTERNS.some((re) => re.test(value))) {
      return "[redacted]";
    }
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
  }
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e9) return value;
  if (typeof value === "boolean") return value;
  return "[dropped]";
}

/** Sanitizes a scalar; `[dropped]` for anything that cannot be represented. */
export function normalizeScalar(key: string, value: unknown): ContextValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return redactValue(key, value);
  if (typeof value === "number") return redactValue(key, value);
  if (typeof value === "boolean") return redactValue(key, value);
  return "[dropped]";
}

/** Flattens a fragment into dotted fields; objects/arrays are bounded, secrets redacted. */
export function flattenFragment(fragment: ContextFragment, out: NormalizedFields = {}, prefix = "", depth = 0): NormalizedFields {
  if (Object.keys(out).length >= MAX_FIELDS) return out;
  const data = fragment.data;
  if (data === null || data === undefined) return out;
  const entries = Object.entries(data);
  for (const [key, value] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ARRAY);
        if (items.length > 0 && items.every((item) => typeof item !== "object" && item !== null)) {
          out[path] = items.map((item) => {
            const normalized = normalizeScalar(key, item);
            return normalized === null || normalized === "[dropped]" ? "[dropped]" : String(normalized);
          });
        }
        // nested objects inside arrays are dropped
      } else if (depth < MAX_DEPTH) {
        flattenFragment({ provider: fragment.provider, data: value as Record<string, unknown> }, out, path, depth + 1);
      }
    } else {
      const normalized = normalizeScalar(path, value);
      if (normalized !== null) out[path] = normalized;
    }
    if (Object.keys(out).length >= MAX_FIELDS) return out;
  }
  return out;
}

/** Combines fragments into one bounded normalized view (later providers win per key). */
export function normalizeContext(fragments: Array<{ fragment: ContextFragment; timing: ProviderTiming }>): {
  fields: NormalizedFields;
  warnings: string[];
  timeline: ProviderTiming[];
} {
  const fields: NormalizedFields = {};
  const warnings: string[] = [];
  const timeline: ProviderTiming[] = [];
  for (const entry of fragments) {
    timeline.push(entry.timing);
    if (entry.fragment.data === null) {
      warnings.push(`${entry.fragment.provider}: no data`);
      continue;
    }
    flattenFragment(entry.fragment, fields, entry.fragment.provider);
  }
  return { fields, warnings, timeline };
}