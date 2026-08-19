import { analyzeTask } from "../router/analyzer.ts";
import { normalizePhrases, expandAliases } from "../utils/text.ts";
import type { NormalizedContext } from "../context/types.ts";

export type IntentType = "coding" | "debugging" | "testing" | "research" | "documentation" | "refactoring" | "security" | "deployment" | "analysis" | "generation";

export const INTENTS: IntentType[] = ["coding", "debugging", "testing", "research", "documentation", "refactoring", "security", "deployment", "analysis", "generation"];

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  signals: string[];
  domain: string | null;
  language: string[];
  operations: string[];
}

/** Pluggable intent classifier; the rule-based implementation is the default. */
export interface IntentClassifier {
  classify(task: string, context?: NormalizedContext): Promise<IntentResult> | IntentResult;
}

const INTENT_TABLE: Array<{ intent: IntentType; tokens: string[]; discriminators: Set<string> }> = [
  { intent: "coding", tokens: ["build", "create", "implement", "add", "write", "make", "develop", "integrate", "construct", "set-up", "setup", "configure", "config", "feature", "module", "function", "change", "update", "modify", "code"], discriminators: new Set(["implement", "build"]) },
  { intent: "debugging", tokens: ["debug", "bug", "fix", "error", "crash", "issue", "failing", "broken", "trace", "stack-trace", "segfault", "exception", "diagnose", "hang", "freeze", "not-working", "error-message", "inspect"], discriminators: new Set(["fix", "debug", "bug"]) },
  { intent: "testing", tokens: ["test", "testing", "spec", "coverage", "assert", "e2e", "unit", "integration-test", "playwright", "cypress", "vitest", "jest", "test-suite", "regression"], discriminators: new Set(["test", "coverage"]) },
  { intent: "research", tokens: ["research", "find", "investigate", "look-up", "search", "compare", "evaluate", "explore", "understand", "learn", "how-to", "analyze-options"], discriminators: new Set(["research", "investigate", "look-up"]) },
  { intent: "documentation", tokens: ["document", "documentation", "readme", "changelog", "writeup", "comment", "docstring", "guide", "api-docs", "explain", "tutorial"], discriminators: new Set(["documentation", "readme", "docstring"]) },
  { intent: "refactoring", tokens: ["refactor", "clean", "restructure", "optimize", "rename", "extract", "simplify", "rewrite", "modernize", "deduplicate", "split", "modularize", "migrate", "upgrade"], discriminators: new Set(["refactor", "rewrite", "simplify"]) },
  { intent: "security", tokens: ["audit", "security", "vulnerability", "xss", "csrf", "injection", "cve", "sanitize", "encryption", "harden", "threat", "penetration", "auth", "permission", "secret"], discriminators: new Set(["audit", "vulnerability", "harden"]) },
  { intent: "deployment", tokens: ["deploy", "release", "ship", "publish", "production", "rollout", "launch", "cd", "pipeline", "ci", "infrastructure"], discriminators: new Set(["deploy", "rollout"]) },
  { intent: "analysis", tokens: ["analyze", "analysis", "review", "check", "inspect", "verify", "validate", "approve", "profile", "benchmark", "measure", "scan", "assess", "trace", "monitor"], discriminators: new Set(["benchmark", "profile"]) },
  { intent: "generation", tokens: ["generate", "design", "ui", "mockup", "prototype", "wireframe", "scaffold", "template", "boilerplate", "styling", "create-component"], discriminators: new Set(["generate", "scaffold", "wireframe"]) },
];

const LANGUAGE_TABLE: Array<[string, string[]]> = [
  ["typescript", ["typescript", "ts", "tsx"]],
  ["javascript", ["javascript", "js", "jsx", "node", "nodejs"]],
  ["python", ["python", "django", "fastapi", "flask", "pip"]],
  ["go", ["go", "golang"]],
  ["rust", ["rust", "cargo"]],
  ["java", ["java", "spring"]],
  ["csharp", ["csharp", "c#", "dotnet", ".net"]],
  ["ruby", ["ruby", "rails"]],
  ["php", ["php", "laravel"]],
  ["swift", ["swift", "ios"]],
  ["kotlin", ["kotlin", "android"]],
];

/** Deterministic rule-based classifier (PRD §Phase E). No LLM dependency. */
export class RuleBasedIntentClassifier implements IntentClassifier {
  classify(task: string, context?: NormalizedContext): IntentResult {
    const analysis = analyzeTask(task);
    const normalized = [...normalizePhrases(task)];
    const aliases = new Set<string>();
    for (const token of tokenizeTask(task)) {
      for (const alias of expandAliases(token)) aliases.add(alias);
    }
    const haystack = new Set<string>([...normalized, ...aliases]);

    const scores = new Map<IntentType, { score: number; hits: string[] }>();
    for (const { intent, tokens, discriminators } of INTENT_TABLE) {
      const hits = tokens.filter((t) => haystack.has(t));
      const weighted = hits.reduce((sum, hit) => sum + (discriminators.has(hit) ? 3 : 1), 0);
      scores.set(intent, { score: weighted, hits });
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
    let [bestIntent, best] = ranked[0]!;
    const second = ranked[1]?.[1]?.score ?? 0;

    let confidence: number;
    if (best.score === 0) {
      bestIntent = "analysis";
      confidence = 0.05;
    } else {
      const spread = best.score / (best.score + second);
      const strength = Math.min(1, best.score / 3);
      confidence = Math.round(Math.min(0.95, spread * strength) * 100) / 100;
    }

    const languages = [];
    for (const [language, forms] of LANGUAGE_TABLE) {
      if (forms.some((t) => haystack.has(t)) || (context && typeof context.fields["project.language"] === "object" && Array.isArray(context.fields["project.language"]) && (context.fields["project.language"] as string[]).includes(language))) {
        languages.push(language);
      }
    }

    return {
      intent: bestIntent,
      confidence,
      signals: best.hits.slice(0, 5),
      domain: analysis.domains[0] ?? null,
      language: languages,
      operations: analysis.operations,
    };
  }
}

export const classifyIntent = new RuleBasedIntentClassifier().classify.bind(new RuleBasedIntentClassifier());

function tokenizeTask(task: string): string[] {
  return task.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}