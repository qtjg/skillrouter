import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CursorAdapter } from "../../src/adapters/cursor.ts";
import { CopilotAdapter } from "../../src/adapters/copilot.ts";
import { ClineAdapter } from "../../src/adapters/cline.ts";
import { WindsurfAdapter } from "../../src/adapters/windsurf.ts";
import { AiderAdapter } from "../../src/adapters/aider.ts";
import { CodexAdapter } from "../../src/adapters/codex.ts";
import { CustomAgentAdapter } from "../../src/adapters/custom.ts";
import type { DetectionContext } from "../../src/adapters/env.ts";
import type { Capability } from "../../src/core/types.ts";
import type { RulesAgentAdapter } from "../../src/adapters/rules.ts";

function capability(id: string, body?: string): Capability {
  return {
    id,
    name: id.replace(/[-:]/g, " "),
    description: `payload for ${id}`,
    version: "1.0.0",
    type: "skill",
    permissions: {},
  } as unknown as Capability;
}

async function tmpCtx(): Promise<DetectionContext> {
  return { cwd: await mkdtemp(join(tmpdir(), "skillrouter-connect-")), binaryPaths: new Map() };
}

async function installRootWith(payload?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillrouter-root-"));
  await writeFile(join(root, "SKILL.md"), payload ?? "# Demo\n\nPayload body.\n", "utf8");
  return root;
}

interface CaseSpec { adapter: RulesAgentAdapter; dir: string; suffix: string }
const cases: Array<[string, (ctx: DetectionContext) => CaseSpec]> = [
  ["cursor", (ctx) => ({ adapter: new CursorAdapter(ctx), dir: join(ctx.cwd, ".cursor/rules"), suffix: ".mdc" })],
  ["copilot", (ctx) => ({ adapter: new CopilotAdapter(ctx), dir: join(ctx.cwd, ".github/instructions"), suffix: ".instructions.md" })],
  ["cline", (ctx) => ({ adapter: new ClineAdapter(ctx), dir: join(ctx.cwd, ".clinerules"), suffix: ".md" })],
  ["windsurf", (ctx) => ({ adapter: new WindsurfAdapter(ctx), dir: join(ctx.cwd, ".windsurf/rules"), suffix: ".md" })],
  ["aider", (ctx) => ({ adapter: new AiderAdapter(ctx), dir: join(ctx.cwd, ".aider/skills"), suffix: ".md" })],
  ["codex", (ctx) => ({ adapter: new CodexAdapter(ctx), dir: join(ctx.cwd, ".codex/prompts"), suffix: ".md" })],
];

for (const [name, make] of cases) {
  test(`${name} adapter: install → discover → uninstall round-trip`, async () => {
    const ctx = await tmpCtx();
    const { adapter, dir, suffix } = make(ctx);
    const root = await installRootWith();

    const result = await adapter.install(capability("cap:demo"), root);
    assert.equal(result.ok, true, `${name} install should succeed`);

    const files = await readFile(join(dir, `cap-demo${suffix}`), "utf8");
    assert.ok(files.includes("skillrouter:managed"), `${name} file carries managed marker`);
    assert.ok(files.includes("Payload body."), `${name} file carries SKILL.md body`);

    const discovered = await adapter.discoverInstalled();
    assert.ok(discovered.some((c) => c.capabilityId === "cap:demo"), `${name} discovers its managed file`);

    const detect = await adapter.detect();
    assert.equal(detect.detected, true, `${name} detected after rules dir exists`);

    const removed = await adapter.uninstall("cap:demo", null);
    assert.equal(removed.ok, true);
    const after = await adapter.discoverInstalled();
    assert.ok(!after.some((c) => c.capabilityId === "cap:demo"), `${name} gone after uninstall`);
  });
}

test("cursor adapter writes MDC frontmatter", async () => {
  const ctx = await tmpCtx();
  const adapter = new CursorAdapter(ctx);
  const root = await installRootWith();
  await adapter.install(capability("cap:demo"), root);
  const file = await readFile(join(ctx.cwd, ".cursor/rules", "cap-demo.mdc"), "utf8");
  assert.ok(file.startsWith("---\n"));
  assert.ok(file.includes("alwaysApply: false"));
});

test("copilot adapter writes applyTo frontmatter", async () => {
  const ctx = await tmpCtx();
  const adapter = new CopilotAdapter(ctx);
  const root = await installRootWith();
  await adapter.install(capability("cap:demo"), root);
  const file = await readFile(join(ctx.cwd, ".github/instructions", "cap-demo.instructions.md"), "utf8");
  assert.ok(file.startsWith("---\n"));
  assert.ok(file.includes('applyTo: "**"'));
});

test("custom agent adapter exposes payloads into configured rules dirs", async () => {
  const ctx = await tmpCtx();
  const adapter = new CustomAgentAdapter(ctx, [
    { name: "mycli", command: "mycli", rulesDir: ".mycli/rules", label: "My CLI" },
    { name: "other", command: "other", rulesDir: ".other/rules" },
  ]);
  const root = await installRootWith();

  const result = await adapter.install(capability("cap:demo"), root);
  assert.equal(result.ok, true);
  const one = await readFile(join(ctx.cwd, ".mycli/rules", "cap-demo.md"), "utf8");
  assert.ok(one.includes("skillrouter:managed"));
  const two = await readFile(join(ctx.cwd, ".other/rules", "cap-demo.md"), "utf8");
  assert.ok(two.includes("skillrouter:managed"));

  const discovered = await adapter.discoverInstalled();
  assert.equal(discovered.filter((c) => c.capabilityId === "cap:demo").length, 2);

  await adapter.uninstall("cap:demo", null);
  const after = await adapter.discoverInstalled();
  assert.equal(after.length, 0);
});

test("custom agent adapter detect reports per-agent evidence", async () => {
  const ctx = await tmpCtx();
  const adapter = new CustomAgentAdapter(ctx, [{ name: "mycli", command: "mycli", rulesDir: ".mycli/rules" }]);
  const before = await adapter.detect();
  assert.equal(before.detected, false);

  await mkdir(join(ctx.cwd, ".mycli/rules"), { recursive: true });
  const after = await adapter.detect();
  assert.equal(after.detected, true);
  assert.ok(after.notes.some((n) => n.includes("mycli")));
});
