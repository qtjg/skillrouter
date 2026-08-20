import { createHash } from "node:crypto";
import { logger } from "../logging/logger.ts";
import type { EmbeddingsConfig } from "../config/config.ts";
import type { EmbeddingProvider } from "./types.ts";

/** Cosine similarity of two equal-length unit vectors == their dot product. */
export function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

export function normalizeVector(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
  if (norm === 0) return new Array(v.length).fill(0);
  return v.map((x) => x / norm);
}

const FEATURE_NAMESPACE = "skillrouter:local-embed";

/**
 * Deterministic local embedding provider: hashes each token into a fixed
 * dimension vector (feature hashing with signed buckets) so no API key or
 * network is required. Vectors are unit-normalized for cosine comparison.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = "local";
  readonly dimension: number;

  constructor(dimension = 256) {
    this.dimension = dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = new Float64Array(this.dimension);
      for (const token of tokenize(text)) {
        const h = createHash("sha256").update(`${FEATURE_NAMESPACE}::${token}`).digest();
        const index = h.readUInt32BE(0) % this.dimension;
        const sign = (h.readUInt8(4) & 1) === 0 ? 1 : -1;
        vector[index] = (vector[index] ?? 0) + sign;
      }
      return normalizeVector([...vector]);
    });
  }
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}

/** Tokenize helper shared with sparse index (kept private here for determinism). */
export function textToTokens(text: string): string[] {
  return tokenize(text);
}

export interface OpenAiEmbeddingsOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
  dimension: number;
}

/** OpenAI-compatible embeddings provider ("/embeddings", token auth). */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly model: string;
  readonly dimension: number;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: OpenAiEmbeddingsOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.dimension = options.dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const body: Record<string, unknown> = {
      model: this.model,
      input: texts.map((t, i) => ({ index: i, text: t })),
    };
    if (this.dimension > 0) body.dimensions = this.dimension;
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Embeddings API ${res.status}: ${detail.slice(0, 200)}`);
    }
    const payload = (await res.json()) as { data?: Array<{ index?: number; embedding?: number[] }> };
    const items = (payload.data ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (items.length !== texts.length) throw new Error(`Embeddings API returned ${items.length} vectors for ${texts.length} texts`);
    return items.map((item) => {
      const vec = item.embedding ?? [];
      if (vec.length !== this.dimension) throw new Error(`Embeddings API returned dimension ${vec.length}, expected ${this.dimension}`);
      return normalizeVector(vec);
    });
  }
}

/**
 * Resolves the configured embedding provider. API-backed providers fall back to
 * the deterministic local provider when the configured key env var is missing,
 * so offline operation never breaks retrieval.
 */
export function resolveEmbeddingProvider(config: EmbeddingsConfig): { provider: EmbeddingProvider; fallback: boolean } {
  if (config.provider === "openai") {
    const apiKey = process.env[config.apiKeyEnv];
    if (apiKey) {
      try {
        return { provider: new OpenAiEmbeddingProvider({ baseUrl: config.baseUrl, model: config.model, apiKey, dimension: config.dimension }), fallback: false };
      } catch {
        // fall through to local
      }
    }
    logger.warn(`Embedding provider "openai" configured but ${config.apiKeyEnv} is not set; using deterministic local embeddings.`);
    return { provider: new LocalEmbeddingProvider(config.dimension), fallback: true };
  }
  return { provider: new LocalEmbeddingProvider(config.dimension), fallback: false };
}