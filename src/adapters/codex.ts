import type { Capability } from "../core/types.ts";
import type { DetectionContext } from "./env.ts";
import { RulesAgentAdapter, type RulesAgentSpec, homePath } from "./rules.ts";

/**
 * OpenAI Codex CLI adapter.
 *
 * Codex picks up custom prompts from `~/.codex/prompts/` and project
 * instructions from `AGENTS.md`. SkillRouter exposes capabilities as managed
 * prompt files so they appear alongside the user's own prompts.
 */
export const CODEX_SPEC: RulesAgentSpec = {
  agent: "codex",
  label: "OpenAI Codex CLI",
  binaryKeys: ["codex"],
  projectRulesDir: () => ".codex/prompts",
  projectDetectPaths: (cwd) => [`${cwd}/AGENTS.md`, `${cwd}/.codex`],
  globalRulesDirs: [homePath(".codex", "prompts")],
  fileSuffix: ".md",
  installNote: "usable from Codex as a custom prompt",
};

export class CodexAdapter extends RulesAgentAdapter {
  constructor(ctx: DetectionContext) {
    super(CODEX_SPEC, ctx);
  }
}

export function isCodexCapability(capability: Capability): boolean {
  return capability.type === "skill";
}
