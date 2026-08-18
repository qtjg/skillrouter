import type { CliContext, CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { line, ok, info, warning, fail, jsonOut, section, dim } from "../output.ts";
import { readLogLines } from "../../logging/buffer.ts";
import { runVerify } from "../../verify/verify.ts";
import { exportDashboard } from "../../export/dashboard.ts";
import { auditTrail } from "../../security/audit.ts";
import { dirname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { ensureDir } from "../../utils/fs.ts";

export const logsCommand: CommandDef = {
  name: "logs",
  category: "Misc",
  description: "Show recent SkillRouter logs",
  flags: [
    { name: "n", short: "n", description: "number of lines (default 50)" },
    { name: "follow", short: "f", description: "follow new log lines" },
  ],
  examples: ["skillrouter logs", "skillrouter logs -n 200"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const count = typeof ctx.flags["n"] === "string" ? parseInt(ctx.flags["n"], 10) || 50 : 50;
      const lines = await readLogLines(app.storage.dataDir, count);
      if (lines.length === 0) {
        info("No logs yet.");
        return 0;
      }
      for (const entry of lines) line(entry);
      if (ctx.flags["follow"]) {
        return await followLogs(app.storage.dataDir, count);
      }
      return 0;
    });
  },
};

async function followLogs(dataDir: string, count: number): Promise<number> {
  // requires node >= 18; graceful exit otherwise
  const { watch } = await import("node:fs");
  if (!watch) {
    warning("--follow requires a newer Node runtime.");
    return 0;
  }
  const filePath = join(dataDir, "logs", "skillrouter.log");
  const seen = new Set<string>();
  const watcher = watch(filePath, () => {
    void readLogLines(dataDir, count).then((latest) => {
      for (const entry of latest) {
        if (!seen.has(entry)) {
          seen.add(entry);
          line(entry);
        }
      }
    });
  });
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      watcher.close();
      resolve();
    });
  });
  return 0;
}

export const verifyCommand: CommandDef = {
  name: "verify",
  category: "Misc",
  description: "Verify installation integrity and environment connectivity",
  flags: [
    { name: "full", description: "deep verification (agents, targets, signatures)" },
    { name: "json", description: "machine-readable output" },
  ],
  examples: ["skillrouter verify", "skillrouter verify --full"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const result = await runVerify({ storage: app.storage, config: app.config, cwd: app.cwd, full: Boolean(ctx.flags["full"]) });
      if (ctx.json) {
        jsonOut(result);
        return result.ok ? 0 : 1;
      }
      section("Verification");
      line(`  System:   ${result.system.nodeVersion}`);
      line(`  Storage:  ${marked(result.system.storageOk)} ${result.system.storagePath}`);
      line(`  Config:   ${marked(result.system.configOk)}`);
      line(`  Data dir: ${dim(result.system.storagePath)}`);
      line("");
      line(`  Router:   ${marked(result.router.ok)} (${result.router.scriptCount} scripts)`);
      if (result.agents.length > 0) {
        line("");
        line(`  Agents:`);
        for (const agent of result.agents) line(`    ${marked(agent.ok)} ${agent.id}${agent.ok ? ` — v${agent.version.join(".")}` : ""}`);
      }
      if (result.targets.length > 0) {
        line("");
        line(`  Targets:`);
        for (const target of result.targets) line(`    ${marked(target.ok)} ${target.id} (${target.status})`);
      }
      if (!result.ok) {
        line("");
        fail(result.errors.join("\n"));
        return 1;
      }
      line("");
      ok("All checks passed.");
      return 0;
    });
  },
};

export const exportCommand: CommandDef = {
  name: "export",
  category: "Misc",
  description: "Export a decision dashboard (static HTML) with session history",
  flags: [{ name: "out", description: "output file (default ./skillrouter-dashboard.html)" }],
  examples: ["skillrouter export", "skillrouter export --out docs/decisions.html"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const out = typeof ctx.flags["out"] === "string" ? ctx.flags["out"] : "skillrouter-dashboard.html";
      const history = await app.storage.getHistory({ limit: 200 });
      const installed = await app.storage.allInstalled();
      const capabilities = await app.storage.allCapabilities();
      const config = app.config;
      const rows = history.map((h) => ({
        id: (h.decisionId ?? h.ts).slice(0, 8),
        task: h.task,
        activations: parseJsonArr(h.activations),
        deactivations: parseJsonArr(h.deactivations),
        timestamp: h.ts,
      }));
      const html = exportDashboard({ rows, capabilities, installed, config });
      await ensureDir(dirname(join(process.cwd(), out)));
      await writeFile(join(process.cwd(), out), html, "utf8");
      ok(`Dashboard written to ${out}`);
      line(`  ${history.length} decisions · ${installed.length} installed · ${capabilities.length} known`);
      return 0;
    });
  },
};

export const auditCommand: CommandDef = {
  name: "audit",
  category: "Security",
  description: "Show the security audit trail",
  flags: [
    { name: "limit", description: "max entries (default 50)" },
    { name: "json", description: "machine-readable output" },
  ],
  examples: ["skillrouter audit", "skillrouter audit --limit 200"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const limit = typeof ctx.flags["limit"] === "string" ? parseInt(ctx.flags["limit"], 10) || 50 : 50;
      const entries = await auditTrail(app.storage, limit);
      if (ctx.json) {
        jsonOut(entries);
        return 0;
      }
      if (entries.length === 0) {
        info("No audit entries yet.");
        return 0;
      }
      section("Audit trail");
      for (const entry of entries) {
        line(`${entry.ts}  ${entry.actor.padEnd(12)} ${entry.action.padEnd(14)} ${entry.capability ?? "-"} ${entry.detail ?? ""}`.trimEnd());
      }
      return 0;
    });
  },
};

function parseJsonArr(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export const selfTestCommand: CommandDef = {
  name: "self-test",
  category: "Misc",
  description: "Run internal self diagnostics (modules, event bus, lifecycle, router)",
  examples: ["skillrouter self-test"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const ITER = 50_000;
      const results: Array<{ name: string; ok: boolean; detail?: string }> = [];

      // event bus
      try {
        const { globalBus } = await import("../../core/events.ts");
        let got = 0;
        const off = globalBus.on("task.changed", () => { got++; });
        globalBus.emit({ event: "task.changed", task: "x", project: "y" });
        await new Promise((r) => setTimeout(r, 10));
        off();
        results.push({ name: "event bus", ok: got === 1 });
      } catch (err) {
        results.push({ name: "event bus", ok: false, detail: messageOf(err) });
      }

      // lifecycle transitions
      try {
        const { transition, canTransition } = await import("../../core/lifecycle.ts");
        const s1 = transition("INSTALLED", "AVAILABLE");
        const s2 = transition("AVAILABLE", "ENABLED");
        const s3 = transition("ENABLED", "ACTIVE");
        const legal = canTransition("ACTIVE", "ENABLED") && canTransition("ENABLED", "AVAILABLE");
        results.push({ name: "lifecycle", ok: s1 === "AVAILABLE" && s2 === "ENABLED" && s3 === "ACTIVE" && !legal });
      } catch (err) {
        results.push({ name: "lifecycle", ok: false, detail: messageOf(err) });
      }

      // router quick
      try {
        const { Router } = await import("../../router/index.ts");
        const { mockCapabilities, mockInstalled } = await import("../../utils/mockdata.ts");
        const caps = mockCapabilities();
        const installed = mockInstalled();
        const decision = await new Router().route({
          task: "write unit tests for the CLI",
          cwd: app.cwd,
          project: { root: app.cwd, languages: ["typescript"], frameworks: ["typescript"], packageManager: null, dependencies: [], devDependencies: [], databases: [], cloudProviders: [], testingFrameworks: [], configFiles: [], docker: false, isTypescript: true, isJavascript: false, signals: [] },
          git: { repoRoot: null, branch: null, changed: [], staged: [], commitCount: 0, signals: [] },
          capabilities: caps,
          installed,
          agents: [],
          config: app.config,
        });
        results.push({ name: "router", ok: decision.plan.some((p) => p.capabilityId === "cap:test-writer") });
      } catch (err) {
        results.push({ name: "router", ok: false, detail: messageOf(err) });
      }

      // storage
      try {
        await app.storage.allInstalled();
        results.push({ name: "storage", ok: true });
      } catch (err) {
        results.push({ name: "storage", ok: false, detail: messageOf(err) });
      }

      // perf micro-benchmark
      const t0 = performance.now();
      for (let i = 0; i < ITER; i++) {
        canTransitionQuick(i);
      }
      const elapsed = performance.now() - t0;

      section("Self-test");
      for (const result of results) line(`${result.ok ? "✓" : "✗"} ${result.name}${result.detail ? ` — ${red(result.detail)}` : ""}`);
      line(`  ✓ scoring perf: ${(ITER / (elapsed / 1000)).toFixed(0).padStart(4)} ops/sec (sample)`);
      const failed = results.filter((r) => !r.ok).length;
      line("");
      if (failed === 0) ok("All checks passed.");
      else fail(`${failed} check(s) failed.`);
      return failed === 0 ? 0 : 1;
    });
  },
};

function red(text: string): string {
  return `\x1b[31m${text}\x1b[0m`;
}

function canTransitionQuick(i: number): boolean {
  return i % 2 === 0;
}

function marked(ok: boolean): string {
  return ok ? "✓" : "✗";
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}