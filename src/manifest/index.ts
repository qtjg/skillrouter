import type { Capability } from "../core/types.ts";
import { ManifestError } from "../utils/errors.ts";
import { readTextSafe } from "../utils/fs.ts";
import { parseManifestYaml, validateManifest, normalizeManifest, formatProblems, type ManifestDoc } from "./validate.ts";

export function loadManifestFromContent(content: string, path: string, options: { strict?: boolean } = {}): Capability {
  const doc = parseManifestYaml(content, path);
  const result = validateManifest(doc);
  const fatal = result.problems.filter((p) => p.path === "schema" || p.path === "id" || p.path === "version" || p.path === "type" || p.path === "name" && p.message.includes("missing"));
  if (fatal.length > 0 || (options.strict && result.problems.length > 0)) {
    throw new ManifestError(`Invalid manifest:\n  ${formatProblems(result.problems).join("\n  ")}`, { path });
  }
  return normalizeManifest(doc, path);
}

export async function loadManifestFile(manifestPath: string, options: { strict?: boolean } = {}): Promise<Capability | null> {
  const content = await readTextSafe(manifestPath);
  if (content === null) return null;
  return loadManifestFromContent(content, manifestPath, options);
}