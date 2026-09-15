import { join } from "node:path";
import type { Capability } from "../core/types.ts";
import type { DetectionContext } from "./env.ts";
import { RulesAgentAdapter, type RulesAgentSpec, homePath } from "./rules.ts";

/**
 * Cursor adapter.
 *
 * Cursor loads project rules from `.cursor/rules/*.mdc` (MDC format with
 * frontmatter) and legacy `.cursorrules`. SkillRouter writes managed MDC
 * rule files with a descriptive, non-always-on default.
 */
export const CURSOR_SPEC: RulesAgentSpec = {
  agent: "cursor",
  label: "Cursor",
  binaryKeys: ["cursor", "cursor-agent"],
  projectRulesDir: () => join(".cursor", "rules"),
  projectDetectPaths: (cwd) => [`${cwd}/.cursorrules`, `${cwd}/.cursor`],
  globalRulesDirs: [homePath(".cursor", "rules")],
  fileSuffix: ".mdc",
  frontmatter: (capability: Capability) =>
    [
      "---",
      `description: ${capability.name.replace(/["\\]/g, "")}`,
      "globs:",
      "alwaysApply: false",
      "---",
      "",
    ].join("\n"),
};

export class CursorAdapter extends RulesAgentAdapter {
  constructor(ctx: DetectionContext) {
    super(CURSOR_SPEC, ctx);
  }
}
