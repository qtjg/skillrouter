import { join, basename } from "node:path";
import { stringify } from "yaml";
import type { Capability } from "../core/types.ts";
import type { AgentInfo, AgentAdapter, AdapterCapability, AdapterOperationResult } from "./types.ts";
import type { DetectionContext } from "./env.ts";
import { ensureDir, copyDirRecursive, writeTextAtomic } from "../utils/fs.ts";
import { pathExists } from "../utils/fs.ts";
import { homeDir } from "./env.ts";

/**
 * Generic Agent Skills adapter.
 *
 * Implements the portable `.agents/skills/<name>/SKILL.md` standard shared by
 * multiple AI tools. Used as the universal export target and fallback adapter.
 */
export class GenericAdapter implements AgentAdapter {
  readonly id = "generic" as const;
  private readonly ctx: DetectionContext;

  constructor(ctx: DetectionContext) {
    this.ctx = ctx;
  }

  private agentsSkillsDir(): string {
    return join(this.ctx.cwd, ".agents", "skills");
  }

  private userAgentsSkillsDir(): string {
    return join(homeDir(), ".agents", "skills");
  }

  async detect(): Promise<AgentInfo> {
    const notes: string[] = [];
    const present: string[] = [];
    for (const dir of [this.agentsSkillsDir(), this.userAgentsSkillsDir()]) {
      if (await pathExists(dir)) present.push(dir);
    }
    const detected = present.length > 0;
    if (detected) notes.push(`portable skills dirs: ${present.join(", ")}`);
    return { id: "generic", name: "Generic Agent Skills", detected, binaryPath: null, version: null, notes };
  }

  async discoverInstalled(): Promise<AdapterCapability[]> {
    const out: AdapterCapability[] = [];
    for (const dir of [this.agentsSkillsDir(), this.userAgentsSkillsDir()]) {
      if (!(await pathExists(dir))) continue;
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (await pathExists(join(dir, entry.name, "SKILL.md"))) {
          out.push({ capabilityId: entry.name, location: join(dir, entry.name), version: null, state: "installed" });
        }
      }
    }
    return out;
  }

  async install(capability: Capability, installRoot: string): Promise<AdapterOperationResult> {
    const target = join(this.agentsSkillsDir(), capability.id);
    await copyDirRecursive(installRoot, target);
    return { agent: "generic", capabilityId: capability.id, ok: true, action: "install", detail: target };
  }

  async uninstall(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult> {
    void installRoot;
    const target = join(this.agentsSkillsDir(), capabilityId);
    if (await pathExists(target)) await import("../utils/fs.ts").then((m) => m.removeDir(target));
    return { agent: "generic", capabilityId, ok: true, action: "uninstall" };
  }

  async enable(capability: Capability, installRoot: string): Promise<AdapterOperationResult> {
    return this.install(capability, installRoot);
  }

  async disable(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult> {
    return this.uninstall(capabilityId, installRoot);
  }

  async activate(capability: Capability, installRoot: string): Promise<AdapterOperationResult> {
    return this.install(capability, installRoot);
  }

  async deactivate(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult> {
    return this.uninstall(capabilityId, installRoot);
  }
}

export interface ExportResult {
  targetDir: string;
  files: string[];
}

/** Export a capability into a self-contained portable directory (PRD §102). */
export async function exportCapability(capability: Capability, installRoot: string, targetDir: string): Promise<ExportResult> {
  await ensureDir(targetDir);
  const files: string[] = [];

  const skill = [
    "# " + capability.name,
    "",
    capability.description,
    "",
    "## Overview",
    "",
    `- Type: ${capability.type}`,
    `- Version: ${capability.version}`,
    `- ID: ${capability.id}`,
    `- Risk: ${capability.risk?.declared ?? "low"}`,
    "",
    ...(capability.triggers?.keywords?.length ? ["## Keywords", "", ...capability.triggers.keywords.map((k) => `- ${k}`), ""] : []),
    ...(capability.triggers?.intents?.length ? ["## Use cases", "", ...capability.triggers.intents.map((i) => `- ${i}`), ""] : []),
    ...(capability.capabilities?.length ? ["## Provides", "", ...capability.capabilities.map((c) => `- ${c}`), ""] : []),
  ].join("\n");
  await writeTextAtomic(join(targetDir, "SKILL.md"), skill + "\n");
  files.push("SKILL.md");

  const tools = [
    "# Tools",
    "",
    ...(capability.permissions?.shell?.enabled ? ["This capability may execute shell commands."] : ["This capability does not execute shell commands."]),
    ...(capability.permissions?.network?.allowed?.length ? [`Network access: ${capability.permissions.network.allowed.join(", ")}`] : ["Network access: none"]),
    ...(capability.permissions?.filesystem ? [`Filesystem: ${capability.permissions.filesystem.read ? "read" : ""}${capability.permissions.filesystem.write ? " write" : ""}`] : ["Filesystem: none"]),
  ].join("\n");
  await writeTextAtomic(join(targetDir, "tools.md"), tools + "\n");
  files.push("tools.md");

  const manifestDoc = manifestToYaml(capability);
  await writeTextAtomic(join(targetDir, "manifest.yaml"), manifestDoc + "\n");
  files.push("manifest.yaml");

  const resourcesDir = join(targetDir, "resources");
  const hasResources = (capability.resources ?? []).length > 0;
  if (hasResources) {
    await ensureDir(resourcesDir);
    for (const resource of capability.resources ?? []) {
      const src = join(installRoot, resource);
      if (await pathExists(src)) {
        await copyDirRecursive(src, join(resourcesDir, basename(resource)));
        files.push(`resources/${basename(resource)}`);
      }
    }
  }

  const originalManifest = await import("../utils/fs.ts").then((m) => m.readTextSafe(join(installRoot, "skillrouter.yaml")));
  if (originalManifest) {
    await writeTextAtomic(join(targetDir, "skillrouter.yaml"), originalManifest);
    files.push("skillrouter.yaml");
  }

  return { targetDir, files };
}

export function manifestToYaml(capability: Capability): string {
  const doc: Record<string, unknown> = {
    schema: "skillrouter/v1",
    id: capability.id,
    name: capability.name,
    version: capability.version,
    description: capability.description,
    type: capability.type,
  };
  if (capability.capabilities?.length) doc["capabilities"] = capability.capabilities;
  if (capability.triggers) doc["triggers"] = capability.triggers;
  if (Object.keys(capability.compatibility ?? {}).length > 0) doc["compatibility"] = capability.compatibility;
  if (capability.dependencies?.length) doc["dependencies"] = capability.dependencies;
  if (capability.conflicts?.length) doc["conflicts"] = capability.conflicts;
  if (capability.permissions) doc["permissions"] = capability.permissions;
  if (capability.resources?.length) doc["resources"] = capability.resources;
  return stringify(doc, { indent: 2 });
}