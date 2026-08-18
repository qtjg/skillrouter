import { join, relative, resolve } from "node:path";
import type { Capability } from "../core/types.ts";
import { loadManifestFromContent } from "../manifest/index.ts";
import { readTextSafe } from "../utils/fs.ts";
import { walkFiles, walkDirs } from "../utils/glob.ts";
import { sha256File } from "../utils/hash.ts";
import { ManifestError } from "../utils/errors.ts";

const MANIFEST_NAMES = ["skillrouter.yaml", "skillrouter.yml", "manifest.yaml", "manifest.yml", "capability.yaml"];

export interface DiscoveredCapability {
  capability: Capability;
  rootDir: string;
  manifestFile: string;
}

export async function discoverSingleDir(dir: string): Promise<DiscoveredCapability | null> {
  for (const name of MANIFEST_NAMES) {
    const manifestFile = join(dir, name);
    const content = await readTextSafe(manifestFile);
    if (content === null) continue;
    const capability = loadManifestFromContent(content, manifestFile, { strict: false });
    const hash = await sha256File(manifestFile);
    capability.source = { ...capability.source, type: capability.source?.type ?? "local", location: dir, hash };
    return { capability, rootDir: dir, manifestFile };
  }
  return null;
}

export function isManifestFile(fileName: string): boolean {
  return MANIFEST_NAMES.includes(fileName.toLowerCase());
}

export async function discoverInTree(root: string, options: { maxDepth?: number; expectManifests?: boolean } = {}): Promise<DiscoveredCapability[]> {
  const out: DiscoveredCapability[] = [];
  const files = await walkFiles(root, { ignore: [], maxDepth: options.maxDepth ?? 10 });
  const manifestDirs = new Set<string>();
  for (const file of files) {
    const base = file.split("/").pop() ?? "";
    if (isManifestFile(base)) {
      manifestDirs.add(resolve(file, ".."));
    }
  }
  if (manifestDirs.size === 0 && !options.expectManifests) return out;

  for (const dir of manifestDirs) {
    const found = await discoverSingleDir(dir);
    if (found) out.push(found);
  }
  return out;
}

export async function discoverCatalogTree(root: string): Promise<DiscoveredCapability[]> {
  const out: DiscoveredCapability[] = [];
  const dirs = await walkDirs(root, 8);
  for (const dir of dirs) {
    const found = await discoverSingleDir(dir);
    if (found) out.push(found);
  }
  return out;
}

export interface CapabilityPackage {
  capability: Capability;
  rootDir: string;
  files: string[];
}

export async function collectPackage(dir: string, capability: Capability): Promise<CapabilityPackage> {
  const files = await walkFiles(dir, { ignore: [] }).then((f) => f.filter((file) => !file.includes("/.git/")));
  const relativeFiles = files.map((f) => relative(dir, f)).filter((f) => !f.startsWith(".git/"));
  const rootDir = resolve(dir);
  void rootDir;
  return {
    capability: { ...capability, manifestPath: join(dir, "skillrouter.yaml") },
    rootDir,
    files: relativeFiles,
  };
}

export async function loadCatalogFile(catalogPath: string): Promise<DiscoveredCapability[]> {
  const content = await readTextSafe(catalogPath);
  if (content === null) throw new ManifestError(`Catalog file not found: ${catalogPath}`);
  const raw = JSON.parse(content) as unknown;
  if (!Array.isArray(raw)) throw new ManifestError(`Catalog ${catalogPath} must be a JSON array of manifests`);
  const out: DiscoveredCapability[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    const json = JSON.stringify(item);
    const manifestFile = `${catalogPath}#${String(item["id"] ?? "unknown")}`;
    const manifest = loadManifestFromContent(json, manifestFile);
    manifest.source = { type: "catalog", location: catalogPath, catalog: catalogPath };
    out.push({ capability: manifest, rootDir: catalogPath, manifestFile });
  }
  return out;
}