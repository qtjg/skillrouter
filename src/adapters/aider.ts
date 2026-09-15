import type { DetectionContext } from "./env.ts";
import { RulesAgentAdapter, type RulesAgentSpec } from "./rules.ts";

/**
 * Aider adapter.
 *
 * Aider has no plugin directory; it consumes instructions through files
 * passed with `--read` (commonly configured via `.aider.conf.yml`).
 * SkillRouter writes capability payloads to `.aider/skills/` and the install
 * result carries the exact `--read` line to add for automatic pickup.
 */
export const AIDER_SPEC: RulesAgentSpec = {
  agent: "aider",
  label: "Aider",
  binaryKeys: ["aider"],
  projectRulesDir: () => ".aider/skills",
  projectDetectPaths: (cwd) => [`${cwd}/.aider.conf.yml`, `${cwd}/.aider.conf.yaml`, `${cwd}/CONVENTIONS.md`, `${cwd}/.aider`],
  fileSuffix: ".md",
  installNote: "add `--read .aider/skills/<file>.md` to .aider.conf.yml for automatic pickup",
};

export class AiderAdapter extends RulesAgentAdapter {
  constructor(ctx: DetectionContext) {
    super(AIDER_SPEC, ctx);
  }
}
