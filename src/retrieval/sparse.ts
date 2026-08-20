import type { CapabilityCorpusRecord } from "../corpus/types.ts";
import { tokenize } from "../utils/text.ts";
import type { SectionMatch } from "./types.ts";

const K1 = 1.2;
const B = 0.75;

interface TermPosting {
  capabilityId: string;
  sectionId: string;
  tf: number;
  docIndex: number;
}

interface Bm25Document {
  capabilityId: string;
  sectionId: string;
  title: string;
  kind: string;
  length: number;
}

/**
 * In-memory BM25 (sparse lexical) index over corpus sections. Deterministic:
 * same corpus and query always produce the same ranking.
 */
export class Bm25Index {
  private docs: Bm25Document[] = [];
  private postings = new Map<string, TermPosting[]>();
  private docLengths: number[] = [];
  private avgDocLength = 0;
  private docFrequencies = new Map<string, number>();
  private readonly tokensByDoc: string[][] = [];

  constructor(records: CapabilityCorpusRecord[]) {
    this.build(records);
  }

  private build(records: CapabilityCorpusRecord[]): void {
    let docId = 0;
    for (const record of records) {
      for (const section of record.sections) {
        const tokens = tokenize(section.body);
        if (tokens.length === 0) continue;
        const doc: Bm25Document = { capabilityId: record.capabilityId, sectionId: section.id, title: section.title, kind: section.kind, length: tokens.length };
        this.docs.push(doc);
        this.docLengths.push(tokens.length);
        this.tokensByDoc.push(tokens);

        const seen = new Map<string, number>();
        for (const token of tokens) seen.set(token, (seen.get(token) ?? 0) + 1);
        for (const [term, tf] of seen) {
          const list = this.postings.get(term) ?? [];
          list.push({ capabilityId: record.capabilityId, sectionId: section.id, tf, docIndex: docId });
          this.postings.set(term, list);
        }
        docId += 1;
      }
    }
    this.avgDocLength = this.docLengths.length > 0 ? this.docLengths.reduce((a, b) => a + b, 0) / this.docLengths.length : 1;
    for (const [term, list] of this.postings) {
      this.docFrequencies.set(term, list.length);
    }
  }

  get size(): number {
    return this.docs.length;
  }

  private idf(term: string): number {
    const n = this.docFrequencies.get(term) ?? 0;
    const N = this.docs.length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  /**
   * BM25 scores per capability, aggregated over matching sections, with the
   * best-scoring sections attached for transparency.
   */
  search(query: string, topK = 10): Array<{ capabilityId: string; score: number; matchedSections: SectionMatch[] }> {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];

    const capScores = new Map<string, number>();
    const capSections = new Map<string, SectionMatch[]>();

    for (const term of terms) {
      const idf = this.idf(term);
      if (idf <= 0) continue;
      const postings = this.postings.get(term) ?? [];
      for (const post of postings) {
        const dl = this.docLengths[post.docIndex] ?? 1;
        const idfScore = idf * ((post.tf * (K1 + 1)) / (post.tf + K1 * (1 - B + B * (dl / this.avgDocLength))));
        capScores.set(post.capabilityId, (capScores.get(post.capabilityId) ?? 0) + idfScore);
        const matches = capSections.get(post.capabilityId) ?? [];
        matches.push({ id: post.sectionId, title: this.docs[post.docIndex]!.title, score: idfScore });
        capSections.set(post.capabilityId, matches);
      }
    }

    const results = [...capScores.entries()].map(([capabilityId, score]) => ({
      capabilityId,
      score,
      matchedSections: (capSections.get(capabilityId) ?? []).sort((a, b) => b.score - a.score).slice(0, 3),
    }));
    results.sort((a, b) => b.score - a.score || (a.capabilityId < b.capabilityId ? -1 : 1));
    return results.slice(0, topK);
  }
}