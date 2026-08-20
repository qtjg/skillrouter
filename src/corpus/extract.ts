import { join, dirname, isAbsolute, basename, extname, relative, sep } from "node:path";
import type { Capability } from "../core/types.ts";
import type { Storage } from "../storage/types.ts";
import { readTextSafe, pathExists } from "../utils/fs.ts";
import { walkFiles } from "../utils/glob.ts";
import { slugify } from "../utils/text.ts";
import { prepareText, estimateTokens } from "./normalize.ts";
import type { CorpusSection, CorpusSectionKind } from "./types.ts";

const MANIFEST_NAMES = ["skillrouter.yaml", "skillrouter.yml", "manifest.yaml", "manifest.yml", "capability.yaml"];
const TEXT_EXTS = new Set([".md", ".txt", ".yaml", ".yml", ".json"]);
const MAX_TOTAL_BYTES = 256 * 1024;
const MAX_SECTION_BYTES = 64 * 1024;

export interface BodyLocation {
  dir: string;
  via: string;
}

/**
 * Resolves the content root of a capability: the directory holding its
 * manifest plus SKILL.md / instructions / docs. Candidates, in order:
 * install root, manifest dir, source location, builtin catalog, project user dirs.
 */
export async function resolveBodyDir(
  capability: Capability,
  opts: { repoRoot: string; cwd: string; storage: Storage },
): Promise<BodyLocation | null> {
  const candidates: Array<{ dir: string; via: string }> = [];
  const loc = capability.source?.location;

  const installed = await opts.storage.getInstalled(capability.id).catch(() => null);
  if (installed?.installRoot) candidates.push({ dir: installed.installRoot, via: "installRoot" });

  if (capability.manifestPath) {
    const mp = isAbsolute(capability.manifestPath) ? capability.manifestPath : loc ? join(loc, capability.manifestPath) : capability.manifestPath;
    candidates.push({ dir: dirname(mp), via: "manifestPath" });
  }

  if (loc && loc !== "builtin") candidates.push({ dir: loc, via: "source.location" });

  if (capability.source?.type === "catalog" && capability.source.catalog) {
    candidates.push({ dir: join(opts.repoRoot, capability.source.catalog, capability.id), via: "catalog" });
  }

  candidates.push({ dir: join(opts.cwd, ".skillrouter", "capabilities", capability.id), via: "project" });

  for (const candidate of candidates) {
    if (await pathExists(candidate.dir)) return candidate;
  }
  return null;
}

function classify(relPath: string, fileName: string): CorpusSectionKind | null {
  const rel = relPath.split(sep).join("/").toLowerCase();
  if (MANIFEST_NAMES.includes(fileName.toLowerCase())) return "manifest";
  const lower = fileName.toLowerCase();
  if (lower === "skill.md") return "overview";
  if (lower === "readme.md") return "readme";
  if (rel.startsWith("instructions/")) return "instructions";
  if (rel.startsWith("docs/")) return "docs";
  if (rel.startsWith("examples/")) return "examples";
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "docs";
  return null;
}

const HEADING_RE = /^(#{1,4})\s+(.+?)\s*$/;

function splitMarkdown(text: string): Array<{ title: string; level: number; body: string }> {
  const parts: Array<{ title: string; level: number; body: string }> = [];
  let currentTitle = "";
  let currentLevel = 0;
  let currentLines: string[] = [];
  let preambleLines: string[] = [];

  const push = (title: string, level: number, lines: string[]) => {
    const body = lines.join("\n").trim();
    if (body) parts.push({ title, level, body });
  };

  for (const line of text.split("\n")) {
    const m = line.match(HEADING_RE);
    if (m) {
      const level = m[1]!.length;
      const title = m[2]!.trim();
      if (currentTitle === "" && preambleLines.length > 0) {
        push("Overview", 0, preambleLines);
        preambleLines = [];
      } else if (currentTitle !== "") {
        push(currentTitle, currentLevel, currentLines);
      }
      currentTitle = title;
      currentLevel = level;
      currentLines = [];
    } else if (currentTitle === "" && parts.length === 0) {
      preambleLines.push(line);
    } else {
      currentLines.push(line);
    }
  }
  push(currentTitle, currentLevel, currentLines);
  return parts;
}

export interface ExtractionResult {
  sections: CorpusSection[];
  body: string;
  bodyTokens: number;
}

/**
 * Extracts the full body of a capability from its content root: manifest
 * prose, SKILL.md, README, instructions/, docs/ and examples/ text files.
 * Deterministic: paths are sorted, budgets are applied, marks no changes.
 * When `capabilityId` is given, section ids are namespaced with it so they are
 * globally unique (required for the embeddings table PK).
 */
export async function extractSections(dir: string, capabilityId?: string): Promise<ExtractionResult> {
  const allFiles = (await walkFiles(dir, { ignore: [], maxDepth: 6 })).sort();
  const sections: CorpusSection[] = [];
  let totalBytes = 0;

  for (const file of allFiles) {
    const rel = relative(dir, file);
    const relLower = rel.split(sep).join("/").toLowerCase();
    if (relLower.includes(".git/") || relLower.includes("node_modules/") || relLower.includes("/.cache/") || relLower.endsWith(".hash")) continue;

    const fileName = basename(file);
    const kind = classify(rel, fileName);
    if (!kind) continue;
    if (!TEXT_EXTS.has(extname(file).toLowerCase()) && kind !== "manifest") continue;

    const raw = await readTextSafe(file);
    if (raw === null) continue;
    const cropped = raw.slice(0, MAX_SECTION_BYTES);
    if (cropped.length === 0) continue;
    if (totalBytes + cropped.length > MAX_TOTAL_BYTES) break;

    totalBytes += cropped.length;
    const text = prepareText(cropped);
    if (!text) continue;

    if (kind === "manifest") {
      sections.push(mkSection(rel, "Manifest", kind, 0, text, 1, capabilityId));
      continue;
    }

    const parts = splitMarkdown(text);
    if (parts.length === 0) {
      sections.push(mkSection(rel, titleOf(fileName), kind, 0, text, 1, capabilityId));
      continue;
    }
    const seen = new Map<string, number>();
    for (const part of parts) {
      const slug = slugify(part.title) || "top";
      const n = (seen.get(slug) ?? 0) + 1;
      seen.set(slug, n);
      sections.push(mkSection(rel, part.title, kind, part.level, part.body, n, capabilityId));
    }
  }

  const final = sections.map((s) => ({ ...s, body: prepareText(s.body) })).filter((s) => s.body.length > 0);
  const body = final.map((s) => s.body).join("\n\n");
  return {
    sections: final,
    body,
    bodyTokens: estimateTokens(body),
  };
}

function mkSection(relPath: string, title: string, kind: CorpusSectionKind, level: number, rawBody: string, ordinal = 1, capabilityId?: string): CorpusSection {
  const body = prepareText(rawBody);
  const prefix = capabilityId ? `${capabilityId}::` : "";
  const id = `${prefix}${relPath.split(sep).join("/")}::${slugify(title) || "top"}::${ordinal}`;
  return { id, title, kind, source: relPath.split(sep).join("/"), level, body, tokens: estimateTokens(body) };
}

function titleOf(fileName: string): string {
  return basename(fileName, extname(fileName)).replace(/[-_]+/g, " ").trim() || fileName;
}