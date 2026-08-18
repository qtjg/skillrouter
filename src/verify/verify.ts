import type { Storage } from "../storage/types.ts";
import type { SkillRouterConfig } from "../config/config.ts";
import { detectAll } from "../adapters/env.ts";
import { readLogFile } from "../logging/logger.ts";

export interface VerifyResult {
  ok: boolean;
  system: { nodeVersion: string; storageOk: boolean; storagePath: string; configOk: boolean };
  router: { ok: boolean; scriptCount: number };
  agents: Array<{ id: string; ok: boolean; version: number[] }>;
  targets: Array<{ id: string; status: string; ok: boolean }>;
  errors: string[];
}

export async function runVerify(opts: { storage: Storage; config: SkillRouterConfig; cwd: string; full?: boolean }): Promise<VerifyResult> {
  const errors: string[] = [];
  const result: VerifyResult = {
    ok: true,
    system: { nodeVersion: process.version, storageOk: true, storagePath: opts.storage.dataDir, configOk: true },
    router: { ok: true, scriptCount: 0 },
    agents: [],
    targets: [],
    errors,
  };

  try {
    await opts.storage.allInstalled();
  } catch (err) {
    result.system.storageOk = false;
    errors.push(`Storage: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    void opts.config.router.mode;
  } catch {
    result.system.configOk = false;
    errors.push("Config: failed to read router.mode");
  }

  // script count on disk (skills live in .skillrouter/scripts when exported)
  const { walkFiles } = await import("../utils/glob.ts");
  const scriptRoot = `${opts.cwd}/.skillrouter`;
  const files = await walkFiles(scriptRoot, { maxDepth: 4 }).catch(() => []);
  result.router.scriptCount = files.filter((f) => /\.(sh|py|js|ts|mjs|cjs)$/i.test(f)).length;

  const entries = await readLogFile(opts.cwd, { limit: 5 });
  if (entries.length === 0) result.router.ok = true;

  if (opts.full) {
    const agents = await detectAll(opts.cwd);
    for (const agent of agents) {
      const version = (agent.version ?? "0.0.0").split(".").map((n) => Number(n) || 0);
      result.agents.push({ id: agent.id, ok: agent.detected, version });
    }
    // targets = sources declared in config
    for (const source of opts.config.sources) {
      if (source.enabled === false) continue;
      result.targets.push({ id: source.name, status: source.type, ok: true });
    }
    const failed = [...result.agents, ...result.targets].filter((x) => !x.ok);
    if (failed.length > 0) errors.push(`Unreachable targets: ${failed.map((f) => f.id).join(", ")}`);
  }

  result.ok = errors.length === 0;
  return result;
}