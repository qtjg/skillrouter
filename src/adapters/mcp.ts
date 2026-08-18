import { join, dirname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { Capability } from "../core/types.ts";
import type { AgentInfo, AgentAdapter, AdapterCapability, AdapterOperationResult } from "./types.ts";
import type { DetectionContext } from "./env.ts";
import { ensureDir, pathExists, readTextSafe } from "../utils/fs.ts";
import { run } from "../utils/proc.ts";
import { homeDir } from "./env.ts";
import { logger } from "../logging/logger.ts";

interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  disabled?: boolean;
  [key: string]: unknown;
}

interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
  servers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

const MCP_IDS = ["mcp", "mcp-server", "mcpserver"];

/**
 * MCP transport adapter.
 *
 * MCP capabilities (`type: mcp-server`) are installed into the MCP config:
 * project `.mcp.json` first, falling back to user `~/.config/mcp.json`.
 * Enable/disable toggles the `disabled` flag on the server entry.
 */
export class McpAdapter implements AgentAdapter {
  readonly id = "mcp" as const;
  private readonly ctx: DetectionContext;

  constructor(ctx: DetectionContext) {
    this.ctx = ctx;
  }

  private mcpConfigPath(): string {
    return join(this.ctx.cwd, ".mcp.json");
  }

  private mcpGlobalConfigPath(): string {
    return join(homeDir(), ".config", "mcp.json");
  }

  private isMcpCapability(capability: Capability): boolean {
    return capability.type === "mcp-server" || MCP_IDS.includes(capability.id);
  }

  async detect(): Promise<AgentInfo> {
    const notes: string[] = [];
    let detected = false;
    for (const p of [this.mcpConfigPath(), this.mcpGlobalConfigPath()]) {
      if (await pathExists(p)) {
        detected = true;
        notes.push(`MCP config: ${p}`);
      }
    }
    return { id: "mcp", name: "MCP", detected, binaryPath: null, version: null, notes };
  }

  async discoverInstalled(): Promise<AdapterCapability[]> {
    const out: AdapterCapability[] = [];
    for (const p of [this.mcpConfigPath(), this.mcpGlobalConfigPath()]) {
      const config = await this.readConfig(p);
      if (!config) continue;
      const servers = this.serverMap(config);
      for (const [name, entry] of Object.entries(servers)) {
        out.push({ capabilityId: name, location: p, version: null, state: entry.disabled ? "unknown" : "installed" });
      }
    }
    return out;
  }

  async install(capability: Capability, installRoot: string): Promise<AdapterOperationResult> {
    if (!this.isMcpCapability(capability)) {
      return { agent: "mcp", capabilityId: capability.id, ok: true, action: "install", detail: "not an MCP capability; skipped" };
    }
    const server = this.serverEntryFor(capability);
    if (!server) {
      return {
        agent: "mcp",
        capabilityId: capability.id,
        ok: false,
        action: "install",
        detail: "MCP capability must declare an mcp server entry in its manifest (mcp.command/args/url)",
      };
    }
    const configPath = (await pathExists(this.mcpConfigPath())) ? this.mcpConfigPath() : this.mcpGlobalConfigPath();
    const config = (await this.readConfig(configPath)) ?? {};
    const servers = this.serverMap(config);
    if (!servers[capability.id]) servers[capability.id] = server;
    else {
      const existing = servers[capability.id];
      Object.assign(existing ?? {}, server, { disabled: false });
    }
    this.writeServerMap(config, servers);
    await ensureDir(dirname(configPath));
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    logger.info(`mcp: registered ${capability.id} in ${configPath}`);
    return { agent: "mcp", capabilityId: capability.id, ok: true, action: "install", detail: configPath };
  }

  async uninstall(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult> {
    void installRoot;
    for (const p of [this.mcpConfigPath(), this.mcpGlobalConfigPath()]) {
      const config = await this.readConfig(p);
      if (!config) continue;
      const servers = this.serverMap(config);
      if (servers[capabilityId]) {
        delete servers[capabilityId];
        this.writeServerMap(config, servers);
        await writeFile(p, JSON.stringify(config, null, 2) + "\n", "utf8");
        return { agent: "mcp", capabilityId, ok: true, action: "uninstall", detail: p };
      }
    }
    return { agent: "mcp", capabilityId, ok: true, action: "uninstall", detail: "no entry found" };
  }

  async enable(capability: Capability, installRoot: string): Promise<AdapterOperationResult> {
    void installRoot;
    for (const p of [this.mcpConfigPath(), this.mcpGlobalConfigPath()]) {
      const config = await this.readConfig(p);
      if (!config) continue;
      const servers = this.serverMap(config);
      const entry = servers[capability.id];
      if (entry) {
        entry.disabled = false;
        await writeFile(p, JSON.stringify(config, null, 2) + "\n", "utf8");
        return { agent: "mcp", capabilityId: capability.id, ok: true, action: "enable", detail: p };
      }
    }
    return { agent: "mcp", capabilityId: capability.id, ok: false, action: "enable", detail: "not installed in MCP config" };
  }

  async disable(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult> {
    void installRoot;
    for (const p of [this.mcpConfigPath(), this.mcpGlobalConfigPath()]) {
      const config = await this.readConfig(p);
      if (!config) continue;
      const servers = this.serverMap(config);
      const entry = servers[capabilityId];
      if (entry) {
        entry.disabled = true;
        await writeFile(p, JSON.stringify(config, null, 2) + "\n", "utf8");
        return { agent: "mcp", capabilityId, ok: true, action: "disable", detail: p };
      }
    }
    return { agent: "mcp", capabilityId, ok: false, action: "disable", detail: "not found in MCP config" };
  }

  async activate(capability: Capability, installRoot: string): Promise<AdapterOperationResult> {
    return this.enable(capability, installRoot);
  }

  async deactivate(capabilityId: string, installRoot: string | null): Promise<AdapterOperationResult> {
    return this.disable(capabilityId, installRoot);
  }

  private async readConfig(path: string): Promise<McpConfig | null> {
    const content = await readTextSafe(path);
    if (content === null) return null;
    try {
      const parsed = JSON.parse(content) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as McpConfig;
      return null;
    } catch {
      logger.warn(`Invalid MCP config JSON at ${path}; ignored`);
      return null;
    }
  }

  private serverMap(config: McpConfig): Record<string, McpServerEntry> {
    return config.mcpServers ?? config.servers ?? {};
  }

  private writeServerMap(config: McpConfig, servers: Record<string, McpServerEntry>): void {
    if (config.mcpServers) config.mcpServers = servers;
    else if (config.servers) config.servers = servers;
    else config.mcpServers = servers;
  }

  private serverEntryFor(capability: Capability): McpServerEntry | null {
    const mcpSection = capability.permissions?.mcp ?? (capability as unknown as { mcp?: Record<string, unknown> }).mcp;
    if (mcpSection && typeof mcpSection === "object") {
      const m = mcpSection as Record<string, unknown>;
      if (typeof m["command"] === "string") {
        const entry: McpServerEntry = { command: m["command"] as string };
        if (Array.isArray(m["args"])) entry.args = (m["args"] as unknown[]).map(String);
        if (m["url"] && typeof m["url"] === "string") entry.url = m["url"] as string;
        return entry;
      }
    }
    if (capability.type === "mcp-server") return { command: "mcp", args: [capability.id] };
    return null;
  }
}

export async function isMcpServer(capability: Capability): Promise<boolean> {
  return capability.type === "mcp-server" || MCP_IDS.includes(capability.id);
}