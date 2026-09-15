import { join } from "node:path";
import { homedir } from "node:os";
import { which } from "../utils/proc.ts";
import { pathExists, readTextSafe } from "../utils/fs.ts";
import type { AgentInfo, AgentAdapter } from "./types.ts";
import type { AgentId } from "../core/types.ts";

export interface DetectionContext {
  cwd: string;
  binaryPaths: Map<string, string | null>;
}

export async function detectAll(cwd: string, customAgents: import("../config/config.ts").CustomAgentConfig[] = []): Promise<AgentInfo[]> {
  const ctx: DetectionContext = { cwd, binaryPaths: new Map() };
  ctx.binaryPaths = await binaryDetected(ctx);

  const adapters = await loadAdapted(ctx, customAgents);
  const infos: AgentInfo[] = [];
  for (const adapter of adapters) {
    infos.push(await adapter.detect());
  }
  return infos;
}

export async function detectAdapter(id: AgentId, cwd: string): Promise<AgentInfo | null> {
  const infos = await detectAll(cwd);
  return infos.find((i) => i.id === id) ?? null;
}

async function loadAdapted(ctx: DetectionContext, customAgents: import("../config/config.ts").CustomAgentConfig[] = []): Promise<AgentAdapter[]> {
  const { OpencodeAdapter } = await import("./opencode.ts");
  const { ClaudeAdapter } = await import("./claude.ts");
  const { GeminiAdapter } = await import("./gemini.ts");
  const { McpAdapter } = await import("./mcp.ts");
  const { CodexAdapter } = await import("./codex.ts");
  const { AiderAdapter } = await import("./aider.ts");
  const { ClineAdapter } = await import("./cline.ts");
  const { CursorAdapter } = await import("./cursor.ts");
  const { CopilotAdapter } = await import("./copilot.ts");
  const { WindsurfAdapter } = await import("./windsurf.ts");
  const adapters: AgentAdapter[] = [
    new OpencodeAdapter(ctx),
    new ClaudeAdapter(ctx),
    new GeminiAdapter(ctx),
    new McpAdapter(ctx),
    new CodexAdapter(ctx),
    new AiderAdapter(ctx),
    new ClineAdapter(ctx),
    new CursorAdapter(ctx),
    new CopilotAdapter(ctx),
    new WindsurfAdapter(ctx),
  ];
  if (customAgents.length > 0) {
    const { CustomAgentAdapter } = await import("./custom.ts");
    adapters.push(new CustomAgentAdapter(ctx, customAgents));
  }
  return adapters;
}

export async function binaryDetected(ctx: DetectionContext): Promise<Map<string, string | null>> {
  const names: Array<[string, string]> = [
    ["opencode", "opencode"],
    ["claude", "claude"],
    ["gemini", "gemini"],
    ["codex", "codex"],
    ["aider", "aider"],
    ["cursor", "cursor-agent"],
    ["cursoride", "cursor"],
    ["copilot", "copilot"],
    ["windsurf", "windsurf"],
  ];
  const map = new Map<string, string | null>();
  for (const [key, binary] of names) {
    map.set(key, await which(binary));
  }
  return map;
}

export function homeDir(): string {
  return homedir();
}

export function configRoot(name: string): string {
  return process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, name) : join(homedir(), ".config", name);
}

export function stateRoot(name: string): string {
  return process.env.XDG_STATE_HOME ? join(process.env.XDG_STATE_HOME, name) : join(homedir(), ".local", "state", name);
}

export async function detectByConfig(cwd: string, expectedPaths: string[], notes: string[]): Promise<{ detected: boolean; firstPath: string | null }> {
  for (const p of expectedPaths) {
    if (await pathExists(p)) return { detected: true, firstPath: p };
  }
  void cwd;
  return { detected: false, firstPath: null };
}

export async function tryRead(p: string): Promise<string | null> {
  return readTextSafe(p);
}