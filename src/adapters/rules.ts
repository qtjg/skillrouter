import { join } from "node:path";
import { readFile, writeFile, readdir as fsReaddir } from "node:fs/promises";
import type { Capability, AgentId } from "../core/types.ts";
import type { AgentInfo, AgentAdapter, AdapterCapability, AdapterOperationResult } from "./types.ts";
import type { DetectionContext } from "./env.ts";
import { ensureDir, pathExists, removeDir } from "../utils/fs.ts";
import { run } from "../utils/proc.ts";
import { homeDir } from "./env.ts";
import { logger } from "../logging/logger.ts";

/**
 * Shared implementation for rule-file based agent adapters.
 *
 * Many coding agents pick up instructions from a directory of markdown files
 * (Cline `.clinerules/`, Cursor `.cursor/rules/`, Copilot `.github/instructions/`,
 * Windsurf `.windsurf/rules/`, Aider `.aider/skills/`, Codex `~/.codex/prompts/`).
 * This base exposes SkillRouter capabilities into those directories as
 * self-contained, marked markdown files so the agent picks them up natively
 * and SkillRouter can discover/uninstall them again.
 */

export const MANAGED_MARKER_PREFIX = "<!-- skillrouter:managed";

export interface RulesAgentSpec {
  agent: AgentId;
  label: string;
  /** Keys looked up in DetectionContext.binaryPaths. */
  binaryKeys: string[];
  /** Project-level rules dir (relative to cwd). */
  projectRulesDir: (cwd: string) => string;
  /** Extra project paths that count as detection evidence. */
  projectDetectPaths?: (cwd: string) => string[];
  /** Absolute global rules dirs. */
  globalRulesDirs?: string[];
  /** File suffix for exposed capability files. */
  fileSuffix: string;
  /** Optional frontmatter generator (Cursor .mdc / Copilot .instructions.md). */
  frontmatter?: (capability: Capability, slug: string) => string;
  /** Extra hint appended to install result details. */
  installNote?: string;
}

export function managedHeader(capabilityId: string): string {
  return `${MANAGED_MARKER_PREFIX} capability="${capabilityId}" -->`;
}

export function slugifyId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

function parseManagedId(content: string): string | null {
  // The marker sits on line 1 for plain markdown but after the frontmatter
  // block for MDC (.mdc) and .instructions.md files — scan the header region.
  const head = content.slice(0, 1024);
  if (!head.includes(MANAGED_MARKER_PREFIX)) return null;
  const match = head.match(/capability="([^"]+)"/);
  return match ? match[1]! : null;
}

export class RulesAgentAdapter implements AgentAdapter {
  readonly id: AgentId;
  protected readonly spec: RulesAgentSpec;
  protected readonly ctx: DetectionContext;

  constructor(spec: RulesAgentSpec, ctx: DetectionContext) {
    this.spec = spec;
    this.id = spec.agent;
    this.ctx = ctx;
  }

  protected dirs(): string[] {
    const dirs = [join(this.ctx.cwd, this.spec.projectRulesDir(this.ctx.cwd))];
    for (const globalDir of this.spec.globalRulesDirs ?? []) dirs.push(globalDir);
    return dirs;
  }

  async detect(): Promise<AgentInfo> {
    const notes: string[] = [];
    let binaryPath: string | null = null;
    for (const key of this.spec.binaryKeys) {
      const found = this.ctx.binaryPaths.get(key) ?? null;
      if (found) {
        binaryPath = found;
        break;
      }
    }
    let detected = binaryPath !== null;

    const evidence: string[] = [];
    const candidatePaths = [
      join(this.ctx.cwd, this.spec.projectRulesDir(this.ctx.cwd)),
      ...(this.spec.projectDetectPaths?.(this.ctx.cwd) ?? []),
      ...(this.spec.globalRulesDirs ?? []),
    ];
    for (const p of candidatePaths) {
      if (await pathExists(p)) evidence.push(p);
    }
    if (evidence.length > 0) {
      detected = true;
      notes.push(`config: ${evidence.join(", ")}`);
    }
    if (detected && !binaryPath) notes.push(`${this.spec.label} binary not found on PATH (config-only detection)`);

    let version: string | null = null;
    if (binaryPath) {
      const result = await run(binaryPath, ["--version"], { timeoutMs: 5000 });
      version = result.ok ? result.stdout.trim().split("\n")[0] ?? null : null;
    }
    return { id: this.spec.agent, name: this.spec.label, detected, binaryPath, version, notes };
  }

  async discoverInstalled(): Promise<AdapterCapability[]> {
    const out: AdapterCapability[] = [];
    for (const dir of this.dirs()) {
      let entries;
      try {
        entries = await fsReaddir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(this.spec.fileSuffix)) continue;
        const filePath = join(dir, entry.name);
        const content = await readFile(filePath, "utf8").catch(() => null);
        if (content === null) continue;
        const capabilityId = parseManagedId(content);
        if (capabilityId) out.push({ capabilityId, location: filePath, version: null, state: "installed" });
      }
    }
    return out;
  }

  async install(capability: Capability, installRoot: string): Promise<AdapterOperationResult> {
    const slug = slugifyId(capability.id);
    const dir = join(this.ctx.cwd, this.spec.projectRulesDir(this.ctx.cwd));
    await ensureDir(dir);
    const target = join(dir, `${slug}${this.spec.fileSuffix}`);

    const body = await readFile(join(installRoot, "SKILL.md"), "utf8").catch(() => null);
    const payload = body?.trim()
      ? body
      : [
          `# ${capability.name}`,
          "",
          capability.description,
          "",
          "_Full payload was not packaged with this capability (no SKILL.md in the install root)._",
        ].join("\n");

    const parts: string[] = [];
    if (this.spec.frontmatter) parts.push(this.spec.frontmatter(capability, slug));
    parts.push(managedHeader(capability.id));
    parts.push(payload.trimEnd());
    await writeFile(target, parts.join("\n") + "\n", "utf8");
    logger.info(`${this.spec.agent}: exposed ${capability.id} at ${target}`);

    let detail = target;
    if (this.spec.installNote) detail = `${target} — ${this.spec.installNote}`;
    return { agent: this.spec.agent, capabilityId: capability.id, ok: true, action: "install", detail };
  }

  async uninstall(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult> {
    void installRoot;
    const slug = slugifyId(capabilityId);
    let removed = false;
    for (const dir of this.dirs()) {
      const candidate = join(dir, `${slug}${this.spec.fileSuffix}`);
      if (await pathExists(candidate)) {
        await removeDir(candidate);
        removed = true;
        logger.info(`${this.spec.agent}: removed ${capabilityId} from ${candidate}`);
      }
    }
    return {
      agent: this.spec.agent,
      capabilityId,
      ok: true,
      action: "uninstall",
      detail: removed ? "removed" : "not exposed (nothing to remove)",
    };
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

/** Home-joined path helper for global rules dirs. */
export function homePath(...parts: string[]): string {
  return join(homeDir(), ...parts);
}
