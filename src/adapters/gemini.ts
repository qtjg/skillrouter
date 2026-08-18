import { join, dirname } from "node:path";
import { readdir as fsReaddir } from "node:fs/promises";
import type { Capability } from "../core/types.ts";
import type { AgentInfo, AgentAdapter, AdapterCapability, AdapterOperationResult } from "./types.ts";
import type { DetectionContext } from "./env.ts";
import { ensureDir, pathExists, removeDir, copyDirRecursive } from "../utils/fs.ts";
import { run } from "../utils/proc.ts";
import { homeDir } from "./env.ts";
import { AdapterError } from "../utils/errors.ts";
import { logger } from "../logging/logger.ts";

/**
 * Gemini CLI adapter.
 *
 * Gemini CLI loads extensions from `~/.gemini/extensions/<name>/extension.yaml`
 * (with optional `skills/` inside the extension). SkillRouter installs
 * capabilities as extensions: the universal skill payload is placed in
 * `skills/<id>/` inside the extension and referenced from `extension.yaml`.
 */
export class GeminiAdapter implements AgentAdapter {
  readonly id = "gemini" as const;
  private readonly ctx: DetectionContext;

  constructor(ctx: DetectionContext) {
    this.ctx = ctx;
  }

  private extensionsDir(): string {
    return join(homeDir(), ".gemini", "extensions");
  }

  async detect(): Promise<AgentInfo> {
    const binaryPath = this.ctx.binaryPaths.get("gemini") ?? null;
    const notes: string[] = [];
    let detected = binaryPath !== null;
    const extDir = this.extensionsDir();
    if (await pathExists(extDir)) {
      detected = true;
      notes.push(`extension directory: ${extDir}`);
    }
    if (detected && !binaryPath) notes.push("gemini binary not found on PATH");
    notes.push("Gemini CLI requires a restart after extension changes");
    let version: string | null = null;
    if (binaryPath) {
      const result = await run(binaryPath, ["--version"], { timeoutMs: 5000 });
      version = result.ok ? result.stdout.trim().split("\n")[0] ?? null : null;
    }
    return { id: "gemini", name: "Gemini CLI", detected, binaryPath, version, notes };
  }

  async discoverInstalled(): Promise<AdapterCapability[]> {
    const extDir = this.extensionsDir();
    const out: AdapterCapability[] = [];
    if (!(await pathExists(extDir))) return out;
    let entries;
    try {
      entries = await fsReaddir(extDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const extPath = join(extDir, entry.name);
      if (await pathExists(join(extPath, "extension.yaml"))) {
        out.push({ capabilityId: entry.name, location: extPath, version: null, state: "installed" });
      }
    }
    return out;
  }

  async install(capability: Capability, installRoot: string): Promise<AdapterOperationResult> {
    const extDir = join(this.extensionsDir(), capability.id);
    await ensureDir(extDir);
    await this.writeExtensionYaml(capability, extDir);
    const skillsDir = join(extDir, "skills", capability.id);
    await copyDirRecursive(installRoot, skillsDir);
    logger.info(`gemini: installed extension ${capability.id} at ${extDir}`);
    return { agent: "gemini", capabilityId: capability.id, ok: true, action: "install", detail: extDir, requiresRestart: true };
  }

  private async writeExtensionYaml(capability: Capability, extDir: string): Promise<void> {
    const { writeTextAtomic } = await import("../utils/fs.ts");
    const description = (capability.description ?? "").replace(/[\n\r]+/g, " ").slice(0, 400);
    const content = [
      "name: " + capability.id,
      "description: " + JSON.stringify(description),
      "version: " + capability.version,
      "metadata:",
      "  source: skillrouter",
      "skills:",
      "  - " + capability.id,
    ].join("\n") + "\n";
    await writeTextAtomic(join(extDir, "extension.yaml"), content);
  }

  async uninstall(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult> {
    const extDir = join(this.extensionsDir(), capabilityId);
    if (await pathExists(extDir)) await removeDir(extDir);
    void installRoot;
    return { agent: "gemini", capabilityId, ok: true, action: "uninstall", requiresRestart: true };
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

export function geminiError(message: string): AdapterError {
  return new AdapterError(message, { agent: "gemini" });
}