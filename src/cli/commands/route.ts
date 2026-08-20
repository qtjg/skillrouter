import type { CliContext, CommandDef } from "../framework.ts";
import { withApp, type AppContext } from "../context.ts";
import { section, line, ok, info, warning, fail, jsonOut, dim, bold, green, yellow, cyan, red, emoji, riskColor, promptYesNo } from "../output.ts";
import { Router } from "../../router/index.ts";
import { expandDependencies } from "../../router/dependency-resolver.ts";
import { analyzeProject } from "../../project/analyzer.ts";
import { getGitContext } from "../../git/context.ts";
import { analyzeTask } from "../../router/analyzer.ts";
import { explainDecision } from "../../router/explainer.ts";
import { refreshAll } from "../../registry/indexer.ts";
import { Runtime, type ConsentFn } from "../../runtime/runtime.ts";
import { getAdapterRegistry } from "../../adapters/registry.ts";
import { readLockfile, writeLockfile } from "../../lockfile/lockfile.ts";
import { audit } from "../../security/audit.ts";
import { globalBus } from "../../core/events.ts";
import type { RouteContext, RouterDecision } from "../../router/types.ts";
import { ROUTER_STRATEGIES, type RouterStrategy } from "../../config/config.ts";
import type { RouteConstraints } from "../../constraints/constraints.ts";
import { collectContext } from "../../context/collect.ts";
import { OutcomeStore } from "../../learning/outcomes.ts";
import { join } from "node:path";

export const routeCommand: CommandDef = {
  name: "route",
  category: "Routing",
  description: "Analyze a task and decide which capabilities to activate",
  usage: "\"<task>\"",
  args: [{ name: "task", required: true, variadic: true, description: "task description" }],
  flags: [
    { name: "dry-run", description: "show the plan without activating or deactivating anything" },
    { name: "yes", short: "y", description: "apply the plan without interactive confirmation" },
    { name: "apply", description: "apply the plan (activate/deactivate) in the connected agents" },
    { name: "strategy", type: "string", description: `override the routing strategy: ${ROUTER_STRATEGIES.join("|")} (default: config router.strategy)` },
    { name: "constraints", type: "string", description: "JSON constraints apply before ranking, e.g. {\"network\":\"forbidden\",\"permissions\":[\"filesystem.read\"],\"maxCost\":3}" },
    { name: "json", description: "machine-readable output" },
  ],
  examples: ["skillrouter route \"audit my authentication changes\"", "skillrouter route \"deploy the app\" --dry-run", "skillrouter route \"write tests\" --apply", "skillrouter route \"migrate the database\" --strategy safe", "skillrouter route \"scan dependencies\" --constraints '{\"network\":\"forbidden\"}'"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const task = ctx.positionals.join(" ");
      if (!task.trim()) throw new Error("Usage: skillrouter route \"<task>\"");

      await refreshAll(app.storage, app.config, app.cwd, app.cwd);
      const project = await analyzeProject(app.cwd);
      const git = await getGitContext(app.cwd);
      const capabilities = await app.storage.allCapabilities();
      const installed = new Map((await app.storage.allInstalled()).map((i) => [i.id, i]));
      const agents = await detectAgentIds(app);

      const strategyFlag = ctx.flags["strategy"];
      let config = app.config;
      if (strategyFlag !== undefined) {
        if (typeof strategyFlag !== "string" || !ROUTER_STRATEGIES.includes(strategyFlag as RouterStrategy)) {
          fail(`--strategy must be one of: ${ROUTER_STRATEGIES.join(", ")}`);
          return 1;
        }
        config = { ...app.config, router: { ...app.config.router, strategy: strategyFlag as RouterStrategy } };
      }

      const constraints = parseConstraints(ctx.flags["constraints"]);
      const context = await collectContext(app.cwd, {
        enabled: app.config.router.context.enabled,
        timeoutMs: app.config.router.context.timeoutMs,
      });
      const outcomes = app.config.learning?.enabled
        ? await new OutcomeStore(app.storage, app.config.learning.maxOutcomes).summaries()
        : undefined;

      const routeCtx: RouteContext = { task, cwd: app.cwd, project, git, capabilities, installed, agents, config, context, constraints, metrics: new Map((await app.storage.allMetrics()).map((m) => [m.capabilityId, m])), outcomes };
      const decision = await new Router().route(routeCtx);

      const dryRun = Boolean(ctx.flags["dry-run"]) || app.config.router.mode === "manual";
      const activations = decision.plan.filter((p) => p.action === "activate");
      const deactivations = decision.plan.filter((p) => p.action === "deactivate");
      const dependencyCheck = expandDependencies(activations.map((a) => a.capabilityId), capabilities);
      const missingInstalledDeps = dependencyCheck.missing.filter((m) => !installed.has(m.id));

      if (ctx.json || ctx.flags["json"]) {
        jsonOut({
          task,
          decisionId: decision.decisionId,
          mode: decision.mode,
          strategy: decision.strategy,
          classification: decision.classification,
          confidence: decision.confidence,
          clarification: decision.clarification,
          latencyMs: decision.latencyMs,
          intent: decision.intent,
          context: decision.context,
          analysis: decision.analysis,
          activate: activations.map((a) => {
            const candidate = decision.scores.find((s) => s.capability.id === a.capabilityId);
            return {
              id: a.capabilityId,
              score: a.score,
              confidence: a.confidence,
              reasons: a.reasons.map((r) => r.text),
              breakdown: candidate?.scoreBreakdownV2 ?? null,
            };
          }),
          deactivate: deactivations.map((a) => ({ id: a.capabilityId, score: a.score })),
          contextUsage: { estimate: decision.contextEstimate, budget: decision.contextBudget },
          dependencies: {
            activationOrder: dependencyCheck.ordered,
            missing: missingInstalledDeps,
            optionalMiss: dependencyCheck.optionalMiss,
            cycles: dependencyCheck.cycles,
          },
          dryRun,
        });
      } else {
        renderRoute(decision, task, activations.length, deactivations.length);
        if (missingInstalledDeps.length > 0) {
          line("");
          warning("Missing required dependencies:");
          for (const dep of missingInstalledDeps) {
            line(`    ${dep.id}${dep.version ? `@${dep.version}` : ""} — needed by ${dep.requiredBy.join(", ")}`);
          }
          info("Install them first: `skillrouter install <capability>`");
        }
      }

      await app.storage.addHistory({
        task,
        project: project.frameworks[0] ?? null,
        decisionId: decision.decisionId,
        activations: activations.map((p) => p.capabilityId).join(","),
        deactivations: deactivations.map((p) => p.capabilityId).join(","),
        selected: activations.map((p) => p.capabilityId).join(","),
        mode: decision.mode,
      });

      if (dryRun) {
        if (!ctx.json) {
          line("");
          info("No changes made.");
        }
        return 0;
      }

      const apply = Boolean(ctx.flags["apply"]);
      const automatic = app.config.router.mode === "automatic" || app.config.router.mode === "autonomous";
      if (!apply && !automatic) {
        if (ctx.flags["yes"]) {
          await applyPlan(app, routeCtx, decision);
        } else {
          const proceed = await promptYesNo(`Apply plan? ${activations.length} activation(s), ${deactivations.length} deactivation(s)`, activations.length > 0);
          if (proceed) await applyPlan(app, routeCtx, decision);
          else info("Plan not applied. Use --apply to apply it.");
        }
      } else if (apply || automatic) {
        await applyPlan(app, routeCtx, decision);
      }
      return 0;
    });
  },
};

async function applyPlan(app: AppContext, ctx: RouteContext, decision: RouterDecision): Promise<void> {
  const adapters = await getAdapterRegistry({ cwd: app.cwd, binaryPaths: new Map() });
  const installed = new Map((await app.storage.allInstalled()).map((i) => [i.id, i]));
  const lockfile = (await readLockfile(app.cwd)) ?? { path: join(app.cwd, "skillrouter.lock"), version: 1, capabilities: new Map() };
  const consent: ConsentFn = async (request) => {
    if (app.json) return false;
    line("");
    warning(`${request.capabilityId} (${request.risk.toUpperCase()}) wants to ${request.action}`);
    info(`Permissions: ${request.permissions.join(", ") || "none"}`, 4);
    info(`Reason: ${request.reason}`, 4);
    return await promptYesNo("Allow?", false);
  };
  const runtime = new Runtime({
    storage: app.storage,
    config: app.config,
    adapters,
    lockfile,
    cwd: app.cwd,
    consent,
  });
  const result = await runtime.executePlan(decision, ctx);
  await writeLockfile(lockfile);
  for (const failure of result.failures) fail(failure.capabilityId ? `${failure.capabilityId}: ${failure.error}` : failure.error);
  if (!app.json) {
    for (const active of result.activated) ok(`Activated ${active.capabilityId}${active.agent ? ` (${active.agent})` : ""}`);
    for (const done of result.deactivated) info(`Deactivated ${done.capabilityId}`, 2);
    for (const skipped of result.skipped) info(`Skipped ${skipped.capabilityId}: ${skipped.reason}`, 2);
  }
  await audit(app.storage, "user", "route", null, `decision=${decision.decisionId} activated=${result.activated.length} deactivated=${result.deactivated.length} failed=${result.failures.length}`);
  globalBus.emit({ event: "task.changed", task: decision.task, project: app.cwd });
  if (result.failures.length > 0) return;
}

export const explainCommand: CommandDef = {
  name: "explain",
  category: "Routing",
  description: "Explain the last routing decision (or a recorded one)",
  flags: [{ name: "id", description: "decision id from history" }],
  examples: ["skillrouter explain"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const history = await app.storage.getHistory({ limit: 20 });
      let decisionId: string | null = null;
      if (typeof ctx.flags["id"] === "string") {
        decisionId = ctx.flags["id"];
        const found = history.find((h) => h.decisionId === decisionId);
        if (!found) {
          warning(`No recorded decision with id "${decisionId}".`);
          return 1;
        }
        decisionId = found.decisionId;
      } else if (history.length > 0) {
        decisionId = history[0]!.decisionId;
      }
      if (!decisionId) {
        line("No routing decisions recorded yet.");
        info("Run `skillrouter route \"<task>\"` first.");
        return 0;
      }

      const entry = history.find((h) => h.decisionId === decisionId)!;
      const task = entry.task;
      const analysis = analyzeTask(task);
      const project = await analyzeProject(app.cwd);
      const git = await getGitContext(app.cwd);
      const capabilities = await app.storage.allCapabilities();
      const installed = new Map((await app.storage.allInstalled()).map((i) => [i.id, i]));
      const agents = await detectAgentIds(app);
      const decision = await new Router().route({
        task,
        cwd: app.cwd,
        project,
        git,
        capabilities,
        installed,
        agents,
        config: app.config,
      });

      const explanation = explainDecision(decision);
      if (ctx.json) {
        jsonOut({ decisionId, ...explanation });
        return 0;
      }
      renderExplanation(explanation);
      return 0;
    });
  },
};

async function detectAgentIds(app: AppContext): Promise<import("../../core/types.ts").AgentId[]> {
  const { detectAll } = await import("../../adapters/env.ts");
  const agents = await detectAll(app.cwd);
  return agents.filter((a) => a.detected).map((a) => a.id);
}

function parseConstraints(raw: unknown): RouteConstraints | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw new Error("--constraints must be a JSON object string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("--constraints must be valid JSON, e.g. '{\"network\":\"forbidden\"}'");
  }
  const allowedKeys = ["network", "maxCost", "maxLatency", "maxLatencyMs", "permissions", "requiredCapabilities", "requiredFramework", "requiredLanguage"];
  const unknown = Object.keys(parsed as Record<string, unknown>).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) throw new Error(`--constraints contains unknown key(s): ${unknown.join(", ")}`);
  if ((parsed as RouteConstraints).network !== undefined && !["allowed", "forbidden"].includes((parsed as RouteConstraints).network!)) {
    throw new Error("constraints.network must be 'allowed' or 'forbidden'");
  }
  return parsed as RouteConstraints;
}

function renderRoute(decision: import("../../router/types.ts").RouterDecision, task: string, activateCount: number, deactivateCount: number): void {
  section("Task analyzed");
  line(`  ${bold(task)}`);
  line("");
  const matchColor = decision.classification === "EXACT_MATCH" ? green : decision.classification === "NO_MATCH" ? red : decision.classification === "WEAK_MATCH" ? yellow : cyan;
  line(`  ${dim("match        ")} ${matchColor(decision.classification)} (top score ${decision.classification === "NO_MATCH" ? "—" : decision.scores[0]?.score + "/100"})`);
  line(`  ${dim("confidence   ")} ${(decision.confidence.value * 100).toFixed(0)}% ${decision.confidence.label} (calibration ${decision.confidence.calibrationVersion})`);
  const domains = decision.analysis.domains.length > 0 ? decision.analysis.domains.join(", ") : dim("none");
  const technologies = decision.analysis.technologies.length > 0 ? decision.analysis.technologies.join(", ") : dim("none");
  const operations = decision.analysis.operations.join(", ");
  line(`  ${dim("domains      ")} ${domains}`);
  line(`  ${dim("technologies ")} ${technologies}`);
  line(`  ${dim("operations   ")} ${operations}`);
  line(`  ${dim("risk         ")} ${riskColor(decision.analysis.riskEstimate)}`);
  if (decision.clarification) {
    line("");
    line(`  ${bold("Clarification needed")}:`);
    line(`    ${decision.clarification.question}`);
    for (const option of decision.clarification.options) line(`    ${dim(`[${option.id}] ${option.label}`)}`);
  }
  line("");
  if (activateCount > 0) {
    line(`  ${bold("Would activate")}:`);
    for (const action of decision.plan) {
      if (action.action === "activate") ok(`${action.capabilityId} — ${action.score}/100 (${action.confidence})`);
    }
  }
  if (deactivateCount > 0) {
    line("");
    line(`  ${bold("Would deactivate")}:`);
    for (const action of decision.plan) {
      if (action.action === "deactivate") line(`    ○ ${dim(action.capabilityId)}`);
    }
  }
  const kept = decision.plan.filter((p) => p.action === "keep");
  if (kept.length > 0) {
    line("");
    info(`Already active: ${kept.map((k) => k.capabilityId).join(", ")}`, 4);
  }
  const ignored = decision.scores
    .filter((s) => s.score > 0 && !decision.plan.some((p) => p.capabilityId === s.capability.id))
    .slice(0, 5);
  if (ignored.length > 0) {
    line("");
    line(`  ${bold("Ignored")}:`);
    for (const score of ignored) line(`    ${emoji("low")} ${dim(score.capability.id)} (${score.score}/100)`);
  }
  line("");
  info(`Mode: ${decision.mode} · ${decision.latencyMs}ms · context ${decision.contextEstimate}/${decision.contextBudget}t`);
}

function renderExplanation(explanation: ReturnType<typeof explainDecision>): void {
  section("Why this decision");
  line(`  Task: ${bold(explanation.task)}`);
  line(`  Match: ${explanation.classification} · confidence ${(explanation.confidence.value * 100).toFixed(0)}% ${explanation.confidence.label}`);
  line("");
  for (const item of explanation.analysis) line(`${" ".repeat(4)}${dim(item)}`);
  line("");
  for (const activation of explanation.activations) {
    line(`${" ".repeat(2)}${green("✓")} ${bold(activation.id)} — ${activation.score}/100 (${activation.confidence}, ${activation.risk})`);
    line(`${" ".repeat(4)}${bold("Signals:")}`);
    for (const signal of activation.signals) line(`${" ".repeat(6)}✓ ${signal}`);
    if (activation.permissions.length > 0) {
      line(`${" ".repeat(4)}${bold("Permissions:")} ${activation.permissions.join(", ")}`);
    }
    line("");
  }
  if (explanation.rejections.length > 0) {
    line(`${" ".repeat(2)}${bold("Rejected")}:`);
    for (const rejection of explanation.rejections) {
      line(`${" ".repeat(4)}✗ ${dim(rejection.id)} — ${rejection.score}/100`);
      for (const reason of rejection.reasons) line(`${" ".repeat(6)}${yellow(reason)}`);
    }
    line("");
  }
  for (const deactivation of explanation.deactivations) {
    line(`${" ".repeat(2)}○ ${dim(deactivation.id)} — no longer relevant`);
  }
  if (explanation.deactivations.length > 0) line("");
  line(`  ${dim("Context: ")}${explanation.context.estimate}/${explanation.context.budget} tokens (${explanation.context.percent}%)`);
  line(`  ${dim("Latency: ")}${explanation.latencyMs}ms · mode ${explanation.mode}${explanation.semanticUsed ? " · semantic" : ""}${explanation.llmUsed ? " · LLM-assisted" : ""}`);
}