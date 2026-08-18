import { join, dirname } from "node:path";
import { readdir as fsReaddir } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Capability } from "../core/types.ts";
import type { AgentInfo, AgentAdapter, AdapterCapability, AdapterOperationResult } from "./types.ts";
import type { DetectionContext } from "./env.ts";
import { ensureDir, pathExists, removeDir, copyDirRecursive } from "../utils/fs.ts";
import { run } from "../utils/proc.ts";
import { homeDir } from "./env.ts";
import { logger } from "../logging/logger.ts";

/**
 * OpenCode adapter.
 *
 * OpenCode discovers skills in `.opencode/skills` and also honors the shared
 * `.agents/skills` and `.claude/skills` locations. SkillRouter exposes
 * installed capabilities into `.opencode/skills` without rewriting content
 * (D-005: reuse universal skill payloads as-is).
 */
export class OpencodeAdapter implements AgentAdapter {
  readonly id = "opencode" as const;
  private readonly ctx: DetectionContext;

  constructor(ctx: DetectionContext) {
    this.ctx = ctx;
  }

  private projectSkillDir(): string {
    return join(this.ctx.cwd, ".opencode");
  }

  private skillDirs(): Array<{ dir: string; label: string }> {
    const cwd = this.ctx.cwd;
    return [
      { dir: join(cwd, ".opencode", "skills"), label: "project .opencode/skills" },
      { dir: join(cwd, ".claude", "skills"), label: "project .claude/skills" },
      { dir: join(cwd, ".agents", "skills"), label: "project .agents/skills" },
      { dir: join(homeDir(), ".config", "opencode", "skills"), label: "user ~/.config/opencode/skills" },
      { dir: join(homeDir(), ".claude", "skills"), label: "user ~/.claude/skills" },
    ];
  }

  async detect(): Promise<AgentInfo> {
    const binaryPath = this.ctx.binaryPaths.get("opencode") ?? null;
    const notes: string[] = [];
    let detected = binaryPath !== null;

    const present: string[] = [];
    for (const { dir, label } of this.skillDirs()) {
      if (await pathExists(dir)) present.push(label);
    }
    if (present.length > 0) {
      detected = true;
      notes.push(`skill directories: ${present.join(", ")}`);
    }
    if (detected && !binaryPath) notes.push("opencode binary not found on PATH");

    let version: string | null = null;
    if (binaryPath) {
      const result = await run(binaryPath, ["--version"], { timeoutMs: 5000 });
      version = result.ok ? result.stdout.trim().split("\n")[0] ?? null : null;
    }
    return { id: "opencode", name: "OpenCode", detected, binaryPath, version, notes };
  }

  async discoverInstalled(): Promise<AdapterCapability[]> {
    const out: AdapterCapability[] = [];
    for (const { dir } of this.skillDirs()) {
      if (!(await pathExists(dir))) continue;
      await this.scanDir(dir, out);
    }
    return out;
  }

  private async scanDir(dir: string, out: AdapterCapability[]): Promise<void> {
    let entries;
    try {
      entries = await fsReaddir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = join(dir, entry.name);
      if ((await pathExists(join(skillDir, "SKILL.md"))) || (await pathExists(join(skillDir, "skillrouter.yaml")))) {
        out.push({ capabilityId: entry.name, location: skillDir, version: null, state: "installed" });
      }
    }
  }

  async install(capability: Capability, installRoot: string): Promise<AdapterOperationResult> {
    const target = await this.exposeTarget(capability, installRoot);
    await copyDirRecursive(installRoot, target);
    logger.info(`opencode: exposed ${capability.id} at ${target}`);
    return { agent: "opencode", capabilityId: capability.id, ok: true, action: "install", detail: target };
  }

  async uninstall(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult> {
    const dir = await this.resolveExposed(capabilityId, installRoot);
    if (dir) {
      await removeDir(dir);
      logger.info(`opencode: removed ${capabilityId} from ${dir}`);
    }
    return { agent: "opencode", capabilityId, ok: true, action: "uninstall" };
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

  private async exposeTarget(capability: Capability, installRoot: string): Promise<string> {
    const projectDir = this.projectSkillDir();
    await ensureDir(join(projectDir, "skills"));
    const name = capabilityToSkillName(capability);
    return join(projectDir, "skills", name);
  }

  private async resolveExposed(capabilityId: string, installRoot: string | null): Promise<string | null> {
    const name = capabilityToSkillName({ id: capabilityId });
    for (const { dir } of this.skillDirs()) {
      const candidate = join(dir, name);
      if (await pathExists(candidate)) return candidate;
    }
    if (installRoot && (await pathExists(installRoot))) return installRoot;
    return null;
  }
}

function capabilityToSkillName(capability: { id: string }): string {
  return capability.id.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function hasOpenCodeConfig(cwd: string): boolean {
  return existsSync(join(cwd, ".opencode")) || existsSync(join(homeDir(), ".config", "opencode"));
}

export function hasOpenCodeBinary(): Promise<boolean> {
  return pathExistsSync("opencode");
}

async function pathExistsSync(binary: string): Promise<boolean> {
  return (await run("sh", ["-c", `command -v ${binary} 2>/dev/null`])).ok;
}