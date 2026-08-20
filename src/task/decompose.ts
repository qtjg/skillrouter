import type { TaskAnalysis, Operation } from "../router/types.ts";
import { analyzeTask } from "../router/analyzer.ts";

/**
 * Task decomposition (PRD §14). A deterministic cookbook planner: an explicit
 * task sequence ("a, then b, then c") is kept as-is; otherwise a recipe
 * composed from the task's operations (and domains) yields an ordered stage
 * list. Every subtask carries the parent's domains/technologies so it can be
 * routed independently.
 */

export interface Subtask {
  id: string;
  description: string;
  stage: string | null;
  source: "explicit" | "recipe";
  operations: Operation[];
  domains: string[];
  technologies: string[];
}

export interface Decomposition {
  task: string;
  subtasks: Subtask[];
  /** 0–1: how confident we are the stage list is faithful to the ask. */
  confidence: number;
  note: string | null;
}

interface Recipe {
  id: string;
  operation: Operation;
  stages: string[];
}

const RECIPES: Recipe[] = [
  { id: "security-review", operation: "security-review", stages: ["map the attack surface", "scan dependencies for vulnerabilities", "audit credentials and secrets handling", "harden the identified issues", "verify the fixes"] },
  { id: "deployment", operation: "deployment", stages: ["build the artifacts", "run the test suite", "deploy to the target environment", "verify the rollout"] },
  { id: "migration", operation: "migration", stages: ["dry-run the migration", "apply the migration", "verify the migrated data"] },
  { id: "testing", operation: "testing", stages: ["write the test cases", "run the suite", "fix the failures detected"] },
  { id: "debugging", operation: "debugging", stages: ["reproduce the failure", "inspect logs and stack traces", "fix the root cause", "verify the fix"] },
  { id: "refactoring", operation: "refactoring", stages: ["enumerate the current structure", "apply the refactor incrementally", "re-run tests after each pass"] },
  { id: "configuration", operation: "configuration", stages: ["inspect the current configuration", "apply the settings change", "validate the configuration"] },
  { id: "documentation", operation: "documentation", stages: ["draft the documentation", "review for accuracy", "publish the docs"] },
  { id: "design", operation: "design", stages: ["sketch the design options", "prototype the chosen approach", "review the prototype"] },
  { id: "review", operation: "review", stages: ["inspect the changes", "verify against the requirements", "report findings"] },
  { id: "implementation", operation: "implementation", stages: ["understand the current code", "implement the change", "add tests", "verify the change"] },
];

/** Operation priority: the most consequential operation drives the recipe. */
const OPERATION_PRIORITY: Operation[] = [
  "security-review", "deployment", "migration", "testing", "debugging", "refactoring", "configuration", "documentation", "design", "review", "implementation",
];

const CONNECTOR = /\s+(?:and\s+)?(?:then|afterwards|afterward|later|next|after)\s+|\s*;\s*|\s*➜\s*|\s*->\s*/i;

/** Splits an explicitly sequenced task, e.g. "write tests, then deploy". */
export function splitConnectors(task: string): string[] {
  return task
    .split(CONNECTOR)
    .map((part) => part.trim().replace(/,\s*$/, ""))
    .filter((part) => part.length > 3);
}

function stagesFor(analysis: TaskAnalysis): { stages: string[]; note: string | null } {
  const ops = OPERATION_PRIORITY.filter((op) => analysis.operations.includes(op));
  const picked = ops.slice(0, 2);
  if (picked.length === 0) {
    return { stages: ["understand the task", "implement it", "verify the result"], note: null };
  }
  const stages: string[] = [];
  for (const op of picked) {
    const recipe = RECIPES.find((r) => r.operation === op);
    if (!recipe) continue;
    for (const stage of recipe.stages) {
      if (!stages.includes(stage)) stages.push(stage);
    }
  }
  const more = ops.length > picked.length ? ` (${ops.length - picked.length} more operations folded into ${picked.join("/")})` : "";
  return { stages: stages.slice(0, 10), note: picked.length > 1 ? `combined recipe: ${picked.join(" + ")}${more}` : null };
}

export function decomposeTask(task: string): Decomposition {
  const analysis = analyzeTask(task);
  const explicit = splitConnectors(task);

  if (explicit.length >= 2) {
    return {
      task,
      subtasks: explicit.map((part, i) => ({
        id: `subtask-${i + 1}`,
        description: part,
        stage: null,
        source: "explicit" as const,
        operations: [...analysis.operations],
        domains: [...analysis.domains],
        technologies: [...analysis.technologies],
      })),
      confidence: 0.9,
      note: "explicit task sequence preserved",
    };
  }

  const { stages, note } = stagesFor(analysis);
  const techSuffix = analysis.technologies.length > 0 ? ` using ${analysis.technologies.join(", ")}` : "";
  return {
    task,
    subtasks: stages.map((stage, i) => ({
      id: `subtask-${i + 1}`,
      description: `${stage}${techSuffix}`,
      stage,
      source: "recipe" as const,
      operations: [...analysis.operations],
      domains: [...analysis.domains],
      technologies: [...analysis.technologies],
    })),
    confidence: 0.7,
    note,
  };
}