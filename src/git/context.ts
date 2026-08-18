import { join } from "node:path";
import { run } from "../utils/proc.ts";
import { GitError } from "../utils/errors.ts";
import { pathExists } from "../utils/fs.ts";
import { inferGitSignals } from "./signals.ts";

export interface GitContext {
  repoRoot: string | null;
  branch: string | null;
  changed: string[];
  staged: string[];
  commitCount: number;
  signals: string[];
}

export async function getGitContext(cwd: string): Promise<GitContext> {
  const ctx: GitContext = { repoRoot: null, branch: null, changed: [], staged: [], commitCount: 0, signals: [] };
  const root = await git(cwd, "rev-parse", "--show-toplevel");
  if (!root.ok) return ctx;
  ctx.repoRoot = root.stdout.trim();
  if (!(await pathExists(join(ctx.repoRoot, ".git")))) {
    // bare git dir detection for worktrees etc; treat as non-repo
  }

  const branch = await git(ctx.repoRoot, "rev-parse", "--abbrev-ref", "HEAD");
  if (branch.ok) ctx.branch = branch.stdout.trim();

  const status = await git(ctx.repoRoot, "status", "--porcelain");
  if (status.ok) {
    for (const line of status.stdout.split("\n")) {
      if (!line.trim()) continue;
      const flag = line.slice(0, 2);
      let file = line.slice(3).trim();
      if (file.includes(" -> ")) file = file.split(" -> ")[1]!.trim();
      if (!file || file.startsWith(".skillrouter/")) continue;
      const tracked = !(flag[0] === "?" && flag[1] === "?");
      ctx.changed.push(file);
      if (tracked) ctx.staged.push(file);
    }
  }

  const staged = await git(ctx.repoRoot, "diff", "--cached", "--name-only");
  if (staged.ok) {
    for (const file of staged.stdout.split("\n")) {
      const trimmed = file.trim();
      if (trimmed && !trimmed.startsWith(".skillrouter/")) ctx.staged.push(trimmed);
    }
  }

  const log = await git(ctx.repoRoot, "rev-list", "--count", "HEAD");
  if (log.ok) ctx.commitCount = Number(log.stdout.trim()) || 0;

  ctx.signals = inferGitSignals([...new Set([...ctx.changed, ...ctx.staged])]);
  return ctx;
}

async function git(cwd: string, ...args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const result = await run("git", args, { cwd, timeoutMs: 15000 });
  return { ok: result.ok, stdout: result.stdout, stderr: result.stderr };
}

export { inferGitSignals, GIT_SIGNAL_PATTERNS } from "./signals.ts";

export function isGitError(err: unknown): err is GitError {
  return err instanceof GitError;
}