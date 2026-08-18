import { join } from "node:path";
import { configPaths, loadConfig, type SkillRouterConfig } from "../config/config.ts";
import { SqliteStorage } from "../storage/sqlite.ts";
import type { Storage } from "../storage/types.ts";
import { logger } from "../logging/logger.ts";
import { ensureDir } from "../utils/fs.ts";
import type { CliContext } from "./framework.ts";

export interface AppContext {
  cwd: string;
  config: SkillRouterConfig;
  projectConfigPath: string | null;
  globalConfigPath: string;
  storage: Storage;
  stateDir: string;
  dbPath: string;
  json: boolean;
}

/**
 * Bootstraps shared infrastructure for CLI commands:
 * global state dir + database + config + logger.
 */
export async function createAppContext(ctx: CliContext): Promise<AppContext> {
  const { stateDir } = configPaths(ctx.cwd);
  await ensureDir(stateDir);
  await logger.init(ctx.cwd);
  const dbPath = join(stateDir, "skillrouter.db");
  const storage = new SqliteStorage(dbPath);
  await storage.init();
  const { config, projectConfigPath, globalConfigPath } = await loadConfig(ctx.cwd);
  return { cwd: ctx.cwd, config, projectConfigPath, globalConfigPath, storage, stateDir, dbPath, json: ctx.json };
}

export async function withApp<T>(ctx: CliContext, fn: (app: AppContext) => Promise<T>): Promise<T> {
  const app = await createAppContext(ctx);
  try {
    return await fn(app);
  } finally {
    app.storage.close();
  }
}

export function repoRootOf(app: AppContext): string {
  return app.projectConfigPath ? join(app.projectConfigPath, "..") : app.cwd;
}