import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_TS = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], cwd: string, extraEnv: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-transform-types", CLI_TS, ...args], {
      cwd,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`agents ${args.join(" ")} timed out (non-TTY hang regression?)`));
    }, 20000);
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test("agents add persists a config-driven custom CLI agent; list shows it; remove deletes it", { timeout: 45000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "skillrouter-agents-"));
  const stateDir = await mkdtemp(join(tmpdir(), "skillrouter-agents-state-"));
  const configDir = await mkdtemp(join(tmpdir(), "skillrouter-agents-config-"));
  const env = { XDG_STATE_HOME: stateDir, XDG_CONFIG_HOME: configDir };

  // seed a project config via init (non-TTY defaults apply)
  await runCli(["init"], cwd, env);

  const added = await runCli(["agents", "add", "myagent", "--cmd", "mycli", "--rules", ".myagent/rules", "--label", "My Agent"], cwd, env);
  assert.equal(added.code, 0, `add failed: ${added.stdout}${added.stderr}`);
  assert.ok(added.stdout.includes("Connected My Agent"));

  const configYaml = await readFile(join(cwd, "skillrouter.yaml"), "utf8");
  assert.ok(configYaml.includes("customAgents:"));
  assert.ok(configYaml.includes("mycli"));
  assert.ok(configYaml.includes(".myagent/rules"));

  const listed = await runCli(["agents", "--json"], cwd, env);
  assert.equal(listed.code, 0);
  const payload = JSON.parse(listed.stdout.slice(listed.stdout.indexOf("{")));
  const custom = payload.agents.find((a: { id: string }) => a.id === "custom");
  assert.ok(custom, "custom agents entry present");
  assert.ok(custom.notes.some((n: string) => n.includes("myagent")));

  const removed = await runCli(["agents", "remove", "myagent"], cwd, env);
  assert.equal(removed.code, 0);
  const after = await readFile(join(cwd, "skillrouter.yaml"), "utf8");
  assert.ok(!after.includes("myagent"));
});

test("agents add rejects absolute rules dirs and duplicate names", { timeout: 45000 }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "skillrouter-agents-"));
  const stateDir = await mkdtemp(join(tmpdir(), "skillrouter-agents-state-"));
  const configDir = await mkdtemp(join(tmpdir(), "skillrouter-agents-config-"));
  const env = { XDG_STATE_HOME: stateDir, XDG_CONFIG_HOME: configDir };

  await runCli(["init"], cwd, env);
  const abs = await runCli(["agents", "add", "bad", "--cmd", "x", "--rules", "/etc/evil"], cwd, env);
  assert.equal(abs.code, 1);
  assert.ok(abs.stdout.includes("project-relative"));

  await runCli(["agents", "add", "dup", "--cmd", "x", "--rules", ".dup/rules"], cwd, env);
  const dup = await runCli(["agents", "add", "dup", "--cmd", "y", "--rules", ".dup2/rules"], cwd, env);
  assert.equal(dup.code, 1);
  assert.ok(dup.stdout.includes("already exists"));
});
