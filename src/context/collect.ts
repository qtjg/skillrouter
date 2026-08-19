import { normalizeContext } from "./normalize.ts";
import { DEFAULT_CONTEXT_PROVIDERS } from "./providers.ts";
import type { CollectContextOptions, ContextFragment, ContextProvider, NormalizedContext, ProviderTiming } from "./types.ts";

/**
 * Collects context from all providers with per-provider timeouts. A failing or
 * timing-out provider never crashes collection — it is recorded in the
 * timeline and `warnings`.
 */
export async function collectContext(cwd: string, options: CollectContextOptions = {}): Promise<NormalizedContext> {
  if (options.enabled === false) {
    return { fields: {}, warnings: ["context collection disabled"], timeline: [], collectedAt: new Date().toISOString() };
  }
  const timeoutMs = options.timeoutMs ?? 1000;
  const providers = (options.providers ?? DEFAULT_CONTEXT_PROVIDERS)
    .filter((provider) => provider && typeof provider.collect === "function")
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

  const fragments: Array<{ fragment: ContextFragment; timing: ProviderTiming }> = [];
  for (const provider of providers) {
    const timing = await runProvider(provider, cwd, timeoutMs);
    fragments.push({ fragment: { provider: provider.name, data: timing.data }, timing });
  }

  const { fields, warnings, timeline } = normalizeContext(fragments);
  return { fields, warnings, timeline, collectedAt: new Date().toISOString() };
}

async function runProvider(provider: ContextProvider, cwd: string, timeoutMs: number): Promise<ProviderTiming & { data: Record<string, unknown> | null }> {
  const started = performance.now();
  try {
    const data = await withTimeout(provider.collect({ cwd }), timeoutMs);
    return { provider: provider.name, ok: true, elapsedMs: Math.round(performance.now() - started), data };
  } catch (error) {
    const timedOut = error instanceof ContextTimeoutError;
    return {
      provider: provider.name,
      ok: false,
      timedOut,
      elapsedMs: Math.round(performance.now() - started),
      data: null,
    };
  }
}

export class ContextTimeoutError extends Error {
  constructor(provider: string, ms: number) {
    super(`context provider "${provider}" exceeded ${ms}ms timeout`);
    this.name = "ContextTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ContextTimeoutError("provider", ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}