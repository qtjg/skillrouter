import { createHash } from "node:crypto";
import type { CapabilityCorpusRecord } from "../corpus/types.ts";
import { tokenize } from "../utils/text.ts";

const NGRAM_SIZE = 3;
const HASH_BITS = 64;

function unigrams(tokens: string[]): string[] {
  return tokens.map((t) => `1:${t}`);
}

function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    out.push(`${n}:${tokens.slice(i, i + n).join(" ")}`);
  }
  return out;
}

export function shinglesOf(text: string): string[] {
  const tokens = tokenize(text);
  const shingles = new Set<string>([...unigrams(tokens), ...(tokens.length >= NGRAM_SIZE ? ngrams(tokens, NGRAM_SIZE) : [])]);
  return [...shingles].sort();
}

function hash64(input: string): Uint8Array {
  return createHash("sha256").update(input).digest().subarray(0, 8) as Uint8Array;
}

/** SimHash (64-bit) over the shingle set of a corpus record body. */
export function featureHashOf(record: Pick<CapabilityCorpusRecord, "body" | "keywords">): string {
  const shingles = shinglesOf(`${record.body} ${record.keywords.join(" ")}`);
  const buckets = new Int32Array(HASH_BITS);
  for (const shingle of shingles) {
    const h = hash64(shingle);
    for (let b = 0; b < HASH_BITS; b++) {
      const byte = h[Math.floor(b / 8)] ?? 0;
      buckets[b] = (buckets[b] ?? 0) + ((byte & (1 << (7 - (b % 8)))) !== 0 ? 1 : -1);
    }
  }
  const bytes = new Uint8Array(8);
  for (let b = 0; b < HASH_BITS; b++) {
    if (buckets[b]! > 0) {
      const idx = Math.floor(b / 8);
      bytes[idx] = (bytes[idx] ?? 0) | (1 << (7 - (b % 8)));
    }
  }
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** Similarity in [0,1] of two 64-bit feature hashes: 1 - hamming/64. */
export function fingerprintSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b || a.length !== 16 || b.length !== 16) return 0;
  let hamming = 0;
  for (let i = 0; i < 16; i += 2) {
    const na = parseInt(a.slice(i, i + 2), 16);
    const nb = parseInt(b.slice(i, i + 2), 16);
    hamming += bitCount(na ^ nb);
  }
  return 1 - hamming / HASH_BITS;
}

function bitCount(x: number): number {
  let n = 0;
  while (x) {
    x &= x - 1;
    n += 1;
  }
  return n;
}

/** Exact Jaccard similarity of two shingle sets. */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setB = new Set(b);
  let intersection = 0;
  const seen = new Set<string>();
  for (const s of a) {
    if (!seen.has(s) && setB.has(s)) {
      intersection += 1;
      seen.add(s);
    }
  }
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : intersection / union;
}

/** Sørensen–Dice similarity of two shingle sets; compares to Jaccard with less size-bias. */
export function diceSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setB = new Set(b);
  let intersection = 0;
  for (const s of new Set(a)) {
    if (setB.has(s)) intersection += 1;
  }
  return (2 * intersection) / (a.length + b.length);
}

export interface DuplicateSet {
  /** Complete-link pairwise similarity matrix above the threshold. */
  pairs: Array<{ a: string; b: string; similarity: number }>;
  /** Greedy clusters grouped by the highest-similarity representative. */
  clusters: Array<{ rep: string; members: string[] }>;
}

/**
 * Detects near-duplicate capabilities from their corpus bodies (shingle set
 * Dice similarity). Deterministic ordering: pairs sorted by descending
 * similarity, clusters grouped by the lexically smallest representative.
 */
export function findDuplicates(records: CapabilityCorpusRecord[], threshold = 0.85): DuplicateSet {
  const shingleSets = new Map<string, string[]>();
  for (const record of records) {
    shingleSets.set(record.capabilityId, shinglesOf(`${record.body} ${record.keywords.join(" ")}`));
  }
  const byId = new Map(records.map((r) => [r.capabilityId, r]));
  const ids = [...byId.keys()].sort();

  const pairs: Array<{ a: string; b: string; similarity: number }> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const similarity = diceSimilarity(shingleSets.get(ids[i]!)!, shingleSets.get(ids[j]!)!);
      if (similarity >= threshold) pairs.push({ a: ids[i]!, b: ids[j]!, similarity });
    }
  }
  pairs.sort((x, y) => y.similarity - x.similarity || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));

  // Greedy single-link clustering over the pair set.
  const adj = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!adj.has(p.a)) adj.set(p.a, new Set());
    if (!adj.has(p.b)) adj.set(p.b, new Set());
    adj.get(p.a)!.add(p.b);
    adj.get(p.b)!.add(p.a);
  }
  const seen = new Set<string>();
  const clusters: Array<{ rep: string; members: string[] }> = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const stack = [id];
    const members = new Set<string>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      members.add(cur);
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) stack.push(next);
      }
    }
    if (members.size > 1) clusters.push({ rep: [...members].sort()[0]!, members: [...members].sort() });
  }
  clusters.sort((a, b) => a.rep.localeCompare(b.rep));

  return { pairs, clusters };
}