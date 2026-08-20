import type { CapabilitySource, ContextProfile } from "../core/types.ts";

/** Origin of a corpus section relative to the capability content root. */
export type CorpusSectionKind = "overview" | "instructions" | "readme" | "docs" | "examples" | "manifest" | "other";

export interface CorpusSection {
  /** Stable per-capability identifier: source-relative path + heading slug. */
  id: string;
  title: string;
  kind: CorpusSectionKind;
  /** Path relative to the capability content root. */
  source: string;
  /** Heading depth; 0 for the preamble preceding the first heading. */
  level: number;
  /** Normalized, redacted text. */
  body: string;
  /** Estimated token count (chars / 4). */
  tokens: number;
}

/**
 * Canonical capability corpus record (PRD v2.0 §7.2): the full body of a
 * capability — manifest prose plus every extracted section — normalized,
 * redacted and fingerprinted so downstream phases (retrieval, reranking,
 * fingerprinting, composition) can operate on the complete content instead of
 * the manifest summary alone.
 */
export interface CapabilityCorpusRecord {
  capabilityId: string;
  name: string;
  version: string;
  type: string;
  summary: string;
  description: string;
  tags: string[];
  keywords: string[];
  context: Pick<ContextProfile, "estimatedTokens" | "resources">;
  source: Pick<CapabilitySource, "type" | "location" | "catalog" | "commit" | "url">;
  sections: CorpusSection[];
  /** Concatenated normalized, redacted body of all sections. */
  body: string;
  bodyTokens: number;
  /** Fingerprint over the full extracted content; changes when content changes. */
  contentHash: string;
  /** Fingerprint over the canonical capability metadata. */
  metadataHash: string;
  /** 64-bit SimHash over the body shingles; used for near-duplicate detection. */
  featureHash: string;
  indexedAt: string;
}

export interface CorpusFingerprint {
  contentHash: string;
  metadataHash: string;
}