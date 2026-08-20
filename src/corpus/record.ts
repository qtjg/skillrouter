import type { Capability } from "../core/types.ts";
import { tokenize } from "../utils/text.ts";
import { sha256Hex, stableStringify } from "./fingerprint.ts";
import { featureHashOf } from "../fingerprint/shingle.ts";
import type { CapabilityCorpusRecord, CorpusSection } from "./types.ts";

const STOPWORDS = new Set(["a", "an", "the", "of", "for", "in", "on", "with", "and", "or", "to", "from", "as", "is", "are", "be", "by", "at", "using", "use", "you", "your"]);

function collectKeywords(capability: Capability): string[] {
  const out = new Set<string>();
  for (const k of [...(capability.triggers?.keywords ?? []), ...(capability.triggers?.technologies ?? []), ...(capability.triggers?.intents ?? []), ...(capability.metadata?.tags ?? [])]) {
    for (const t of tokenize(k)) {
      if (t.length >= 2) out.add(t.toLowerCase());
    }
  }
  for (const t of tokenize(`${capability.name} ${capability.description}`)) {
    const lower = t.toLowerCase();
    if (lower.length >= 3 && !STOPWORDS.has(lower) && !out.has(lower)) {
      if (out.size < 24) out.add(lower);
    }
  }
  return [...out].sort();
}

/** Builds a canonical, redacted, fingerprinted corpus record for a capability. */
export function buildCorpusRecord(capability: Capability, sections: CorpusSection[], now = new Date().toISOString()): CapabilityCorpusRecord {
  const summary = capability.description;
  const keywords = collectKeywords(capability);
  const context = { ...capability.context };
  const source: CapabilityCorpusRecord["source"] = {
    type: capability.source?.type ?? "local",
    location: capability.source?.location ?? "",
    ...(capability.source?.catalog !== undefined && { catalog: capability.source.catalog }),
    ...(capability.source?.commit !== undefined && { commit: capability.source.commit }),
    ...(capability.source?.url !== undefined && { url: capability.source.url }),
  };

  const body = sections.map((s) => s.body).join("\n\n");
  const bodyTokens = sections.reduce((acc, s) => acc + s.tokens, 0);

  const contentHash = sha256Hex(
    stableStringify({
      name: capability.name,
      version: capability.version,
      type: capability.type,
      summary,
      description: capability.description,
      tags: [...(capability.metadata?.tags ?? [])].sort(),
      keywords,
      context,
      sections: sections.map((s) => ({ id: s.id, title: s.title, kind: s.kind, source: s.source, level: s.level, body: s.body, tokens: s.tokens })),
    }),
  );

  const metadataHash = sha256Hex(
    stableStringify({
      name: capability.name,
      version: capability.version,
      type: capability.type,
      summary,
      tags: [...(capability.metadata?.tags ?? [])].sort(),
      keywords,
      context,
    }),
  );

  const record: Omit<CapabilityCorpusRecord, "featureHash"> = {
    capabilityId: capability.id,
    name: capability.name,
    version: capability.version,
    type: capability.type,
    summary,
    description: capability.description,
    tags: [...(capability.metadata?.tags ?? [])].sort(),
    keywords,
    context,
    source,
    sections,
    body,
    bodyTokens,
    contentHash,
    metadataHash,
    indexedAt: now,
  };

  return { ...record, featureHash: featureHashOf(record) };
}