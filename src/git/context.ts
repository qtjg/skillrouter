import { join } from "node:path";
import { run } from "../utils/proc.ts";
import { GitError } from "../utils/errors.ts";
import { pathExists } from "../utils/fs.ts";
import { matchesGlob } from "../utils/glob.ts";
import { normalizePhrases } from "../utils/text.ts";

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

  ctx.signals = inferSignals([...new Set([...ctx.changed, ...ctx.staged])]);
  return ctx;
}

const SIGNAL_PATTERNS: Array<{ signals: string[]; patterns: string[] }> = [
  { signals: ["authentication"], patterns: ["**/auth/**", "**/login/**", "**/middleware*", "**/*oauth*", "**/*session*", "**/*jwt*", "**/*token*"] },
  { signals: ["security"], patterns: ["**/*security*", "**/*audit*", "**/*vulnerab*", "**/csrf*", "**/*csp*", "**/*sanitize*", "**/*escape*"] },
  { signals: ["database"], patterns: ["**/migrations/**", "**/*migration*", "**/schema.prisma", "**/schema.sql", "**/drizzle/**", "**/*.sql"] },
  { signals: ["testing"], patterns: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/tests/**", "**/test/**", "**/*.e2e.*"] },
  { signals: ["frontend"], patterns: ["**/components/**", "**/*.jsx", "**/*.tsx", "**/*.css", "**/*.scss", "**/*.html", "**/pages/**", "**/pages/**", "**/app/page*"] },
  { signals: ["api"], patterns: ["**/api/**", "**/routes/**", "**/controllers/**", "**/handlers/**", "**/*endpoint*"] },
  { signals: ["deployment"], patterns: ["**/Dockerfile*", "**/docker-compose*", "**/*.yml", "**/*.yaml", "**/.github/workflows/**", "**/Procfile", "**/vercel.json", "**/netlify.toml"] },
  { signals: ["documentation"], patterns: ["**/*.md", "**/docs/**"] },
  { signals: ["typescript"], patterns: ["**/*.ts", "**/*.tsx"] },
  { signals: ["ui"], patterns: ["**/*.css", "**/*.scss", "**/*.less", "**/*.tailwind*", "**/theme/**", "**/styles/**"] },
  { signals: ["payments"], patterns: ["**/*stripe*", "**/*payment*", "**/*checkout*", "**/*billing*"] },
  { signals: ["webhook"], patterns: ["**/*webhook*"] },
  { signals: ["subscription"], patterns: ["**/*subscription*", "**/*billing*", "**/*plan*"] },
  { signals: ["workflow"], patterns: ["**/.github/workflows/**"] },
  { signals: ["refactoring"], patterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"] },
];

function inferSignals(files: string[]): string[] {
  const signals = new Set<string>();
  if (files.length === 0) return [];
  for (const file of files) {
    for (const { signals: sigs, patterns } of SIGNAL_PATTERNS) {
      if (matchesGlob(file, patterns)) {
        for (const s of sigs) signals.add(normalizeAlias(s));
      }
    }
  }
  return [...signals];
}

function normalizeAlias(signal: string): string {
  return [...normalizePhrases(signal)][0] ?? signal;
}

async function git(cwd: string, ...args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const result = await run("git", args, { cwd, timeoutMs: 15000 });
  return { ok: result.ok, stdout: result.stdout, stderr: result.stderr };
}

export function isGitError(err: unknown): err is GitError {
  return err instanceof GitError;
}