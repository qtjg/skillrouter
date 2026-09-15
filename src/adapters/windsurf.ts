import type { DetectionContext } from "./env.ts";
import { RulesAgentAdapter, type RulesAgentSpec, homePath } from "./rules.ts";

/**
 * Windsurf adapter.
 *
 * Windsurf loads workspace rules from `.windsurf/rules/` and global rules
 * from `~/.codeium/windsurf/rules/` (newer builds use `~/.windsurf/rules/`).
 * Both global locations are considered for detection and discovery.
 */
export const WINDSURF_SPEC: RulesAgentSpec = {
  agent: "windsurf",
  label: "Windsurf",
  binaryKeys: ["windsurf"],
  projectRulesDir: () => ".windsurf/rules",
  globalRulesDirs: [homePath(".windsurf", "rules"), homePath(".codeium", "windsurf", "rules")],
  fileSuffix: ".md",
};

export class WindsurfAdapter extends RulesAgentAdapter {
  constructor(ctx: DetectionContext) {
    super(WINDSURF_SPEC, ctx);
  }
}
