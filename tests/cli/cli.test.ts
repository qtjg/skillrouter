import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import main from "../../src/cli/index.ts";

const captured = { out: "", err: "" };
const origWrite = { out: process.stdout.write, err: process.stderr.write };

function capture(): void {
  captured.out = "";
  captured.err = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured.out += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured.err += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
}

function release(): void {
  process.stdout.write = origWrite.out;
  process.stderr.write = origWrite.err;
}

async function withCleanEnv(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "sr-cli-"));
  process.env.XDG_CONFIG_HOME = join(dir, "config");
  process.env.XDG_STATE_HOME = join(dir, "state");
  await rm(join(dir, "state"), { recursive: true, force: true });
  const prevCwd = process.cwd();
  process.chdir(dir);
  try {
    await fn(dir);
  } finally {
    process.chdir(prevCwd);
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_STATE_HOME;
    await rm(dir, { recursive: true, force: true });
  }
}

test("main --version prints a version line", async () => {
  await withCleanEnv(async () => {
    capture();
    try {
      const code = await main(["--version"]);
      assert.equal(code, 0);
      assert.match(captured.out, /^skillrouter \d+\.\d+\.\d+/);
    } finally {
      release();
    }
  });
});

test("main --help renders usage", async () => {
  await withCleanEnv(async () => {
    capture();
    try {
      const code = await main(["--help"]);
      assert.equal(code, 0);
      assert.match(captured.out, /Usage: skillrouter <command>/);
      assert.match(captured.out, /route/);
    } finally {
      release();
    }
  });
});

test("main unknown command exits 2", async () => {
  await withCleanEnv(async () => {
    capture();
    try {
      const code = await main(["frobnicate"]);
      assert.equal(code, 2);
      assert.match(captured.err, /Unknown command/);
    } finally {
      release();
    }
  });
});

test("main parse flag errors exit with usage error", async () => {
  await withCleanEnv(async () => {
    capture();
    try {
      const code = await main(["status", "--not-a-flag"]);
      assert.equal(code, 2);
      assert.match(captured.err, /Unknown flag/);
    } finally {
      release();
    }
  });
});

test("main route --json --dry-run returns a machine-readable decision", async () => {
  await withCleanEnv(async () => {
    await writeFile(join(process.cwd(), "skillrouter.yaml"), "project:\n  name: cli-test\n", "utf8");
    capture();
    try {
      const code = await main(["route", "write unit tests for the API", "--json", "--dry-run"]);
      assert.equal(code, 0);
      const parsed = JSON.parse(captured.out) as { decisionId: string; mode: string; dryRun: boolean; activate: unknown[] };
      assert.equal(typeof parsed.decisionId, "string");
      assert.equal(parsed.mode, "assisted");
      assert.equal(parsed.dryRun, true);
      assert.ok(Array.isArray(parsed.activate));
    } finally {
      release();
    }
  });
});

test("main stats reports reliability observations in table and json mode", async () => {
  await withCleanEnv(async () => {
    capture();
    try {
      let code = await main(["stats"]);
      assert.equal(code, 0);
      assert.match(captured.out, /No reliability statistics yet/);

      capture();
      code = await main(["stats", "--json"]);
      assert.equal(code, 0);
      assert.deepEqual(JSON.parse(captured.out), { capabilities: [] });
    } finally {
      release();
    }
  });
});