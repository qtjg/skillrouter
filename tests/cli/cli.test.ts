import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
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
      const parsed = JSON.parse(captured.out) as { decisionId: string; mode: string; strategy: string; dryRun: boolean; activate: unknown[] };
      assert.equal(typeof parsed.decisionId, "string");
      assert.equal(parsed.mode, "assisted");
      assert.equal(parsed.strategy, "balanced");
      assert.equal(parsed.dryRun, true);
      assert.ok(Array.isArray(parsed.activate));
    } finally {
      release();
    }
  });
});

test("main route --strategy overrides the config strategy", async () => {
  await withCleanEnv(async () => {
    await writeFile(join(process.cwd(), "skillrouter.yaml"), "project:\n  name: cli-test\n", "utf8");
    capture();
    try {
      const code = await main(["route", "write unit tests for the API", "--json", "--dry-run", "--strategy", "safe"]);
      assert.equal(code, 0);
      const parsed = JSON.parse(captured.out) as { strategy: string };
      assert.equal(parsed.strategy, "safe");
    } finally {
      release();
    }
  });
});

test("main route rejects an invalid --strategy", async () => {
  await withCleanEnv(async () => {
    await writeFile(join(process.cwd(), "skillrouter.yaml"), "project:\n  name: cli-test\n", "utf8");
    capture();
    try {
      const code = await main(["route", "write unit tests for the API", "--dry-run", "--strategy", "bogus"]);
      assert.equal(code, 1);
      assert.match(captured.out, /--strategy must be one of/);
    } finally {
      release();
    }
  });
});

test("main route --json surfaces intent, contextUsage and per-activation breakdown", async () => {
  await withCleanEnv(async () => {
    const skillDir = join(process.cwd(), "skills", "test-writer");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skillrouter.yaml"),
      `schema: skillrouter/v1
id: test-writer
name: Test Writer
version: 1.0.0
description: Writes unit tests for TypeScript projects
type: skill
triggers:
  keywords: [test, unit, coverage]
  intents: [write tests, add tests]
`,
      "utf8",
    );
    capture();
    try {
      let code = await main(["source", "add", "cli-src", join(process.cwd(), "skills")]);
      assert.equal(code, 0);
      capture();
      code = await main(["route", "write unit tests for the API", "--json", "--dry-run"]);
      assert.equal(code, 0);
      const parsed = JSON.parse(captured.out) as {
        intent: { type: string; confidence: number };
        contextUsage: { estimate: number; budget: number };
        activate: { id: string; breakdown: { total: number } | null }[];
      };
      assert.equal(parsed.intent.type, "testing");
      assert.ok(parsed.intent.confidence > 0);
      assert.ok(parsed.contextUsage.budget > 0);
      assert.ok(parsed.activate.some((a) => a.id === "test-writer"));
      const withBreakdown = parsed.activate.find((a) => a.breakdown !== null);
      assert.ok(withBreakdown);
      assert.ok(withBreakdown.breakdown!.total > 0 && withBreakdown.breakdown!.total <= 1);
    } finally {
      release();
    }
  });
});

test("main route --constraints eliminates network capabilities and rejects bad JSON", async () => {
  await withCleanEnv(async () => {
    const skillDir = join(process.cwd(), "skills", "deployer");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "skillrouter.yaml"),
      `schema: skillrouter/v1
id: deployer
name: Deployer
version: 1.0.0
description: builds and deploys applications
type: skill
triggers:
  keywords: [deploy, docker]
permissions:
  network:
    allowed: ["*"]
`,
      "utf8",
    );
    capture();
    try {
      let code = await main(["source", "add", "cli-src", join(process.cwd(), "skills")]);
      assert.equal(code, 0);
      capture();
      code = await main(["route", "deploy the docker image", "--json", "--dry-run", "--constraints", '{"network":"forbidden"}']);
      assert.equal(code, 0);
      const parsed = JSON.parse(captured.out) as { activate: { id: string }[]; deactivate: { id: string }[] };
      const selected = [...parsed.activate, ...parsed.deactivate].map((a) => a.id);
      assert.ok(!selected.includes("deployer"), "network capability must be eliminated");
    } finally {
      release();
    }
    capture();
    try {
      const code = await main(["route", "write tests", "--dry-run", "--constraints", "not-json"]);
      assert.equal(code, 1);
      assert.match(captured.err, /--constraints must be valid JSON/);
    } finally {
      release();
    }
    capture();
    try {
      const code = await main(["route", "write tests", "--dry-run", "--constraints", '{"bogusKey":true}']);
      assert.equal(code, 1);
      assert.match(captured.err, /unknown key/);
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

test("main learn records outcomes visible in stats and audit", async () => {
  await withCleanEnv(async () => {
    const manifestDir = join(process.cwd(), "skills", "web-search");
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, "skillrouter.yaml"),
      `schema: skillrouter/v1
id: web-search
name: Web Search
version: 1.0.0
description: research the web
type: skill
fallbacks:
  - browser-search
`,
      "utf8",
    );
    const browserDir = join(process.cwd(), "skills", "browser-search");
    await mkdir(browserDir, { recursive: true });
    await writeFile(
      join(browserDir, "skillrouter.yaml"),
      `schema: skillrouter/v1
id: browser-search
name: Browser Search
version: 1.0.0
description: browser research
type: skill
`,
      "utf8",
    );
    capture();
    try {
      let code = await main(["source", "add", "builtin", join(process.cwd(), "skills")]);
      assert.equal(code, 0);
      capture();
      code = await main(["learn", "web-search", "--failure", "--task", "research pricing"]);
      assert.equal(code, 0);
      assert.match(captured.out, /Recorded failure for web-search/);
      assert.match(captured.out, /Fallback suggested: browser-search/);

      capture();
      code = await main(["stats", "--json"]);
      assert.equal(code, 0);
      const stats = JSON.parse(captured.out) as { capabilities: Array<{ id: string; tasks: number; failures: number }> };
      assert.equal(stats.capabilities.length, 1);
      assert.equal(stats.capabilities[0]!.tasks, 1);
      assert.equal(stats.capabilities[0]!.failures, 1);

      capture();
      code = await main(["audit", "--json"]);
      assert.equal(code, 0);
      const audit = JSON.parse(captured.out) as Array<{ action: string; capability: string }>;
      assert.ok(audit.some((e) => e.action === "learn-failure" && e.capability === "web-search"));
    } finally {
      release();
    }
  });
});

test("main context --json reports normalized context fields without secrets", async () => {
  const previous = { API_TOKEN: process.env.API_TOKEN, CI: process.env.CI };
  process.env.API_TOKEN = "cli-secret-value-12345";
  delete process.env.CI;
  try {
    await withCleanEnv(async () => {
      await writeFile(join(process.cwd(), "package.json"), JSON.stringify({ name: "ctx" }), "utf8");
      capture();
      try {
        const code = await main(["context", "--json"]);
        assert.equal(code, 0);
        const parsed = JSON.parse(captured.out) as { fields: Record<string, unknown>; warnings: string[]; timeline: unknown[] };
        assert.equal(typeof parsed.fields, "object");
        assert.ok(Array.isArray(parsed.timeline));
        assert.ok(!JSON.stringify(captured.out).includes("cli-secret-value-12345"), "secret value must never appear in context output");
      } finally {
        release();
      }
    });
  } finally {
    if (previous.API_TOKEN === undefined) delete process.env.API_TOKEN;
    else process.env.API_TOKEN = previous.API_TOKEN;
    if (previous.CI === undefined) delete process.env.CI;
    else process.env.CI = previous.CI;
  }
});

test("main classify --json returns intent classification", async () => {
  await withCleanEnv(async () => {
    await writeFile(join(process.cwd(), "package.json"), JSON.stringify({ name: "intent-test", dependencies: { react: "18.0.0" } }), "utf8");
    capture();
    try {
      const code = await main(["classify", "fix this React error", "--json"]);
      assert.equal(code, 0);
      const parsed = JSON.parse(captured.out) as { intent: string; confidence: number; domain: string | null };
      assert.equal(parsed.intent, "debugging");
      assert.ok(parsed.confidence > 0.4);
      assert.equal(typeof parsed.domain, "string");
    } finally {
      release();
    }
  });
});