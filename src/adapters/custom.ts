import { join } from "node:path";
import { readFile, writeFile, readdir as fsReaddir } from "node:fs/promises";
import type { Capability, AgentId } from "../core/types.ts";
import type { AgentInfo, AgentAdapter, AdapterCapability, AdapterOperationResult } from "./types.ts";
import type { DetectionContext } from "./env.ts";
import { ensureDir, pathExists, removeDir } from "../utils/fs.ts";
import { logger } from "../logging/logger.ts";
import { MANAGED_MARKER_PREFIX, managedHeader, slugifyId } from "./rules.ts";

/**
 * Config-driven connector for arbitrary CLI agents.
 *
 * Users declare custom agents in `skillrouter.yaml`:
 *
 * ```yaml
 * customAgents:
 *   - name: myagent
 *     command: mycli          # binary looked up on PATH
 *     rulesDir: .myagent/rules  # where capability payloads are exposed
 *     label: My Agent          # optional display name
 * ```
 *
 * The adapter exposes capability payloads as managed markdown files into
 * each configured rules directory, giving ANY CLI agent native access to
 * SkillRouter capabilities without writing an adapter.
 */

export interface CustomAgentDefinition {
  name: string;
  command: string;
  rulesDir: string;
  label?: string;
}

export class CustomAgentAdapter implements AgentAdapter {
  readonly id: AgentId = "custom";
  private readonly ctx: DetectionContext;
  private readonly agents: CustomAgentDefinition[];

  constructor(ctx: DetectionContext, agents: CustomAgentDefinition[]) {
    this.ctx = ctx;
    this.agents = agents;
  }

  private dirs(): Array<{ dir: string; agent: CustomAgentDefinition }> {
    return this.agents.map((agent) => ({ dir: join(this.ctx.cwd, agent.rulesDir), agent }));
  }

  async detect(): Promise<AgentInfo> {
    const notes: string[] = [];
    let detected = false;
    const names: string[] = [];

    for (const agent of this.agents) {
      names.push(agent.label ?? agent.name);
      const rulesDir = join(this.ctx.cwd, agent.rulesDir);
      const hasDir = await pathExists(rulesDir);
      const binary = this.ctx.binaryPaths.get(agent.command) ?? null;
      if (hasDir || binary) {
        detected = true;
        notes.push(`${agent.name}: ${binary ? `binary ${agent.command} on PATH` : `rules dir ${agent.rulesDir}`}`);
      } else {
        notes.push(`${agent.name}: not detected (no ${agent.command} binary, no ${agent.rulesDir})`);
      }
    }
    return {
      id: "custom",
      name: names.length > 0 ? `Custom CLI agents (${names.join(", ")})` : "Custom CLI agents",
      detected,
      binaryPath: null,
      version: null,
      notes,
    };
  }

  async discoverInstalled(): Promise<AdapterCapability[]> {
    const out: AdapterCapability[] = [];
    for (const { dir } of this.dirs()) {
      let entries;
      try {
        entries = await fsReaddir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const filePath = join(dir, entry.name);
        const content = await readFile(filePath, "utf8").catch(() => null);
        if (content === null) continue;
        const firstLine = content.split("\n")[0] ?? "";
        if (!firstLine.startsWith(MANAGED_MARKER_PREFIX)) continue;
        const match = firstLine.match(/capability="([^"]+)"/);
        if (match) out.push({ capabilityId: match[1]!, location: filePath, version: null, state: "installed" });
      }
    }
    return out;
  }

  async install(capability: Capability, installRoot: string): Promise<AdapterOperationResult> {
    const slug = slugifyId(capability.id);
    const body = await readFile(join(installRoot, "SKILL.md"), "utf8").catch(() => null);
    const payload = body?.trim()
      ? body
      : [`# ${capability.name}`, "", capability.description].join("\n");
    const written: string[] = [];

    for (const { dir, agent } of this.dirs()) {
      await ensureDir(dir);
      const target = join(dir, `${slug}.md`);
      await writeFile(target, `${managedHeader(capability.id)}\n${payload.trimEnd()}\n`, "utf8");
      written.push(`${agent.name}: ${target}`);
    }
    logger.info(`custom agents: exposed ${capability.id} to ${written.length} agent(s)`);
    return {
      agent: "custom",
      capabilityId: capability.id,
      ok: written.length > 0,
      action: "install",
      detail: written.join("; ") || "no custom agents configured",
    };
  }

  async uninstall(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult> {
    void installRoot;
    const slug = slugifyId(capabilityId);
    let removed = 0;
    for (const { dir } of this.dirs()) {
      const candidate = join(dir, `${slug}.md`);
      if (await pathExists(candidate)) {
        await removeDir(candidate);
        removed += 1;
      }
    }
    return {
      agent: "custom",
      capabilityId,
      ok: true,
      action: "uninstall",
      detail: removed > 0 ? `removed from ${removed} agent(s)` : "not exposed (nothing to remove)",
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
