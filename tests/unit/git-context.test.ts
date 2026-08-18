import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir as fsMkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGitContext } from "../../src/git/context.ts";
import { run } from "../../src/utils/proc.ts";

async function gitAvailable(): Promise<boolean> {
  const result = await run("git", ["--version"]);
  return result.ok;
}

test("getGitContext returns empty context outside a repo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-no-git-"));
  try {
    const ctx = await getGitContext(dir);
    assert.equal(ctx.repoRoot, null);
    assert.equal(ctx.branch, null);
    assert.deepEqual(ctx.changed, []);
    assert.deepEqual(ctx.signals, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("getGitContext detects repo, branch, changes and git signals", async () => {
  if (!(await gitAvailable())) return;
  const dir = await mkdtemp(join(tmpdir(), "sr-git-"));
  try {
    const git = (args: string[]) => run("git", args, { cwd: dir });
    await git(["init", "-q"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["config", "user.name", "Test"]);
    await writeFile(join(dir, "README.md"), "# project\n");
    await git(["add", "README.md"]);
    await git(["commit", "-q", "-m", "init"]);

    await fsMkdir(join(dir, "src", "auth"), { recursive: true });
    await writeFile(join(dir, "src", "auth", "login.ts"), "export const login = 1;\n");
    await git(["add", "src/auth/login.ts"]);
    await git(["commit", "-q", "-m", "add auth"]);

    await writeFile(join(dir, "src", "auth", "login.ts"), "export const login = 2;\n");
    const ctx = await getGitContext(dir);
    assert.ok(ctx.repoRoot);
    assert.ok(ctx.branch && ctx.branch.length > 0);
    assert.ok(ctx.commitCount >= 2);
    assert.ok(ctx.changed.includes("src/auth/login.ts"));
    assert.equal(ctx.staged.includes("src/auth/login.ts"), false);
    assert.ok(ctx.signals.includes("authentication"));

    await git(["add", "src/auth/login.ts"]);
    const stagedCtx = await getGitContext(dir);
    assert.ok(stagedCtx.staged.includes("src/auth/login.ts"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});