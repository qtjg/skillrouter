import { join, dirname } from "node:path";
import { readdir as fsReaddir, mkdir } from "node:fs/promises";
import type { Capability } from "../core/types.ts";
import type { AgentInfo, AgentAdapter, AdapterCapability, AdapterOperationResult } from "./types.ts";
import type { DetectionContext } from "./env.ts";
import { ensureDir, pathExists, removeDir, copyDirRecursive, readTextSafe } from "../utils/fs.ts";
import { run } from "../utils/proc.ts";
import { homeDir } from "./env.ts";
import { AdapterError } from "../utils/errors.ts";
import { logger } from "../logging/logger.ts";

/**
 * Claude-compatible skills adapter.
 *
 * Claude Code loads skills from `~/.claude/skills/<name>/SKILL.md` and
 * project `.claude/skills/<name>/SKILL.md`. SkillRouter reuses the universal
 * skill payload (SKILL.md at the capability root) without conversion.
 */
export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude" as const;
  private readonly ctx: DetectionContext;

  constructor(ctx: DetectionContext) {
    this.ctx = ctx;
  }

  private skillDirs(): Array<{ dir: string; label: string }> {
    return [
      { dir: join(this.ctx.cwd, ".claude", "skills"), label: "project .claude/skills" },
      { dir: join(homeDir(), ".claude", "skills"), label: "user ~/.claude/skills" },
    ];
  }

  async detect(): Promise<AgentInfo> {
    const binaryPath = this.ctx.binaryPaths.get("claude") ?? null;
    const notes: string[] = [];
    let detected = binaryPath !== null;
    const present: string[] = [];
    for (const { dir, label } of this.skillDirs()) {
      if (await pathExists(dir)) {
        present.push(label);
        detected = true;
      }
    }
    if (present.length > 0) notes.push(`skill directories: ${present.join(", ")}`);
    if (detected && !binaryPath) notes.push("claude binary not found on PATH");

    let version: string | null = null;
    if (binaryPath) {
      const result = await run(binaryPath, ["--version"], { timeoutMs: 5000 });
      version = result.ok ? result.stdout.trim().split("\n")[0] ?? null : null;
    }
    return { id: "claude", name: "Claude Code", detected, binaryPath, version, notes };
  }

  async discoverInstalled(): Promise<AdapterCapability[]> {
    const out: AdapterCapability[] = [];
    for (const { dir } of this.skillDirs()) {
      if (!(await pathExists(dir))) continue;
      let entries;
      try {
        entries = await fsReaddir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = join(dir, entry.name);
        if (await pathExists(join(skillDir, "SKILL.md"))) {
          out.push({ capabilityId: entry.name, location: skillDir, version: null, state: "installed" });
        }
      }
    }
    return out;
  }

  async install(capability: Capability, installRoot: string): Promise<AdapterOperationResult> {
    const target = join(this.ctx.cwd, ".claude", "skills", capability.id);
    await ensureDir(dirname(target));
    await copyDirRecursive(installRoot, target);
    logger.info(`claude: exposed ${capability.id} at ${target}`);
    return { agent: "claude", capabilityId: capability.id, ok: true, action: "install", detail: target };
  }

  async uninstall(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult> {
    const target = join(this.ctx.cwd, ".claude", "skills", capabilityId);
    if (await pathExists(target)) await removeDir(target);
    void installRoot;
    return { agent: "claude", capabilityId, ok: true, action: "uninstall" };
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

export async function hasClaudeConfig(cwd: string): Promise<boolean> {
  return (await pathExists(join(cwd, ".claude"))) || (await pathExists(join(homeDir(), ".claude")));
}

export async function isClaudeSkill(dir: string): Promise<boolean> {
  return (await readTextSafe(join(dir, "SKILL.md"))) !== null;
}

export function claudeSkillError(message: string): AdapterError {
  return new AdapterError(message, { agent: "claude" });
}