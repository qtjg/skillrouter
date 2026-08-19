import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectContext } from "../../src/context/collect.ts";
import { flattenFragment, normalizeScalar } from "../../src/context/normalize.ts";
import { PROJECT_CONTEXT_PROVIDER, ENVIRONMENT_CONTEXT_PROVIDER } from "../../src/context/providers.ts";
import type { ContextProvider } from "../../src/context/types.ts";

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sr-context-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "ctx-test",
      dependencies: { next: "14.0.0", react: "18.0.0", typescript: "5.0.0" },
      devDependencies: { vitest: "1.0.0" },
    }),
  );
  await writeFile(join(dir, "tsconfig.json"), "{}");
  await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
  return dir;
}

test("project provider collects and normalizes languages and frameworks", async () => {
  const dir = await tempProject();
  try {
    const collected = await collectContext(dir, { timeoutMs: 2000 });
    const langs = collected.fields["project.language"];
    const frameworks = collected.fields["project.framework"];
    assert.ok(Array.isArray(langs) && langs.includes("typescript"));
    assert.ok(Array.isArray(frameworks) && frameworks.includes("nextjs"));
    assert.equal(collected.fields["project.packageManager"], "pnpm");
    assert.equal(collected.fields["project.docker"], false);
    const depCount = collected.fields["project.dependencyCount"];
    assert.equal(typeof depCount, "number");
    assert.ok((depCount as number) >= 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failing provider never crashes collection", async () => {
  const bad: ContextProvider = {
    name: "exploding",
    priority: 1,
    async collect() {
      throw new Error("boom");
    },
  };
  const collected = await collectContext(process.cwd(), { providers: [bad], timeoutMs: 500 });
  assert.equal(collected.fields["exploding"], undefined);
  assert.ok(collected.timeline.some((t) => t.provider === "exploding" && !t.ok));
  assert.ok(collected.warnings.length >= 0);
});

test("a timing-out provider is recorded as timed out, not a crash", async () => {
  const slow: ContextProvider = {
    name: "glacier",
    priority: 1,
    async collect() {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return { value: "never" };
    },
  };
  const collected = await collectContext(process.cwd(), { providers: [slow], timeoutMs: 30 });
  const entry = collected.timeline.find((t) => t.provider === "glacier");
  assert.ok(entry);
  assert.equal(entry!.ok, false);
  assert.equal(entry!.timedOut, true);
  assert.equal(collected.fields["glacier.value"], undefined);
});

test("disabled collection returns an empty context with a warning", async () => {
  const collected = await collectContext(process.cwd(), { enabled: false });
  assert.deepEqual(collected.fields, {});
  assert.ok(collected.warnings.includes("context collection disabled"));
});

test("normalization flattens nested objects into dotted bounded fields", () => {
  const fragment = {
    provider: "t",
    data: {
      layout: {
        robots: 3,
        flags: { readonly: true, name: "r2d2" },
      },
      list: ["a", "b"],
    },
  };
  const out: Record<string, unknown> = {};
  flattenFragment(fragment, out as never, "t");
  assert.equal(out["t.layout.robots"], 3);
  assert.equal(out["t.layout.flags.readonly"], true);
  assert.deepEqual(out["t.list"], ["a", "b"]);
});

test("secret-like keys and secret-shaped values are redacted", () => {
  assert.equal(normalizeScalar("apiToken", "sk_live_1234567890abcdef"), "[redacted]");
  assert.equal(normalizeScalar("password", "hunter2"), "[redacted]");
  assert.equal(normalizeScalar("github_token", "ghp_123456789012345678901234567890123456"), "[redacted]");
  assert.equal(normalizeScalar("repos", "ghp_123456789012345678901234567890123456"), "[redacted]");
  assert.equal(normalizeScalar("name", "hello world"), "hello world");
  assert.equal(normalizeScalar("version", 12.5), 12.5);
});

test("environment provider never exposes sensitive variable values", async () => {
  const previous: Record<string, string | undefined> = {
    API_TOKEN: process.env.API_TOKEN,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    CI: process.env.CI,
  };
  process.env.API_TOKEN = "super-secret-token-value";
  process.env.AWS_SECRET_ACCESS_KEY = "AKIA0000000000000000";
  process.env.CI = "true";
  try {
    const fragment = await ENVIRONMENT_CONTEXT_PROVIDER.collect({ cwd: process.cwd() });
    assert.ok(fragment);
    const normalized: Record<string, unknown> = {};
    flattenFragment({ provider: "environment", data: fragment }, normalized as never, "environment");
    const values = JSON.stringify(normalized);
    assert.ok(!values.includes("super-secret-token-value"));
    assert.ok(!values.includes("AKIA0000000000000000"));
    const sensitiveCount = normalized["environment.sensitiveVarCount"];
    assert.equal(typeof sensitiveCount, "number");
    assert.ok((sensitiveCount as number) >= 2);
    assert.equal(normalized["environment.ci"], true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("collectContext respects custom provider ordering by priority", async () => {
  const order: string[] = [];
  const a: ContextProvider = {
    name: "a",
    priority: 10,
    async collect() {
      order.push("a");
      return { a: 1 };
    },
  };
  const b: ContextProvider = {
    name: "b",
    priority: 1,
    async collect() {
      order.push("b");
      return { b: 2 };
    },
  };
  await collectContext(process.cwd(), { providers: [a, b], timeoutMs: 100 });
  assert.deepEqual(order, ["b", "a"]);
});