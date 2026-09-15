import type { Capability } from "../core/types.ts";
import type { DetectionContext } from "./env.ts";
import { RulesAgentAdapter, type RulesAgentSpec } from "./rules.ts";

/**
 * GitHub Copilot adapter.
 *
 * Copilot reads repository instructions from `.github/copilot-instructions.md`
 * and path-scoped `.github/instructions/*.instructions.md` files (frontmatter
 * `applyTo`). SkillRouter writes managed instruction files with a broad
 * `applyTo: "**"` default.
 */
export const COPILOT_SPEC: RulesAgentSpec = {
  agent: "copilot",
  label: "GitHub Copilot",
  binaryKeys: ["copilot"],
  projectRulesDir: () => ".github/instructions",
  projectDetectPaths: (cwd) => [`${cwd}/.github/copilot-instructions.md`, `${cwd}/.github/instructions`],
  fileSuffix: ".instructions.md",
  frontmatter: (capability: Capability) =>
    [
      "---",
      `applyTo: "**"`,
      `description: ${capability.name.replace(/["\\]/g, "")}`,
      "---",
      "",
    ].join("\n"),
};

export class CopilotAdapter extends RulesAgentAdapter {
  constructor(ctx: DetectionContext) {
    super(COPILOT_SPEC, ctx);
  }
}
