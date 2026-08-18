// Run with: node --experimental-transform-types examples/routing/example.ts   (Node 22.x)
//
// The SkillRouter programmatic API, end to end:
//   1. build a RouteContext from project + git context,
//   2. route a task through the Router,
//   3. summarize the decision with explainDecision().

import { Router } from "../../src/router/index.ts";
import { explainDecision } from "../../src/router/explainer.ts";
import { mockCapabilities, mockInstalled } from "../../src/utils/mockdata.ts";
import { analyzeProject } from "../../src/project/analyzer.ts";
import { getGitContext } from "../../src/git/context.ts";
import { DEFAULT_CONFIG } from "../../src/config/config.ts";
import type { RouteContext } from "../../src/router/types.ts";

// The router works in any directory; "." is passed through as the context
// root while project and git analysis inspect the real working directory.
const cwd = ".";

const ctx: RouteContext = {
  task: "write unit tests for the CLI",
  cwd,
  project: await analyzeProject(process.cwd()),
  git: await getGitContext(process.cwd()),
  capabilities: mockCapabilities(),
  installed: mockInstalled(),
  agents: ["opencode"],
  config: DEFAULT_CONFIG,
};

const decision = await new Router().route(ctx);
const summary = explainDecision(decision);

console.log(`Task: ${summary.task}`);
console.log(`Mode: ${summary.mode}${summary.semanticUsed ? " (semantic pass used)" : ""}${summary.llmUsed ? " (llm rerank used)" : ""}`);
console.log(`Analysis: ${summary.analysis.join("; ")}`);
console.log(`Context estimate: ${summary.context.estimate} of ${summary.context.budget} tokens (${summary.context.percent}%)`);
console.log(`Latency: ${summary.latencyMs} ms`);
console.log("");

console.log("Activations:");
if (summary.activations.length === 0) {
  console.log("  (none)");
} else {
  for (const activation of summary.activations) {
    console.log(`  ${activation.id}: score ${activation.score}/100, confidence ${activation.confidence}`);
    console.log(`    signals: ${activation.signals.join(", ")}`);
    console.log(`    permissions: ${activation.permissions.join(", ") || "none"}`);
  }
}

console.log("");
console.log("Kept active:");
if (summary.kept.length === 0) {
  console.log("  (none)");
} else {
  for (const kept of summary.kept) {
    console.log(`  ${kept.id}: score ${kept.score}/100`);
  }
}

console.log("");
console.log("Deactivations:");
if (summary.deactivations.length === 0) {
  console.log("  (none)");
} else {
  for (const deactivation of summary.deactivations) {
    console.log(`  ${deactivation.id}: score ${deactivation.score}/100`);
  }
}