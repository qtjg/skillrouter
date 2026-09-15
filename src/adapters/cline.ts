import type { DetectionContext } from "./env.ts";
import { RulesAgentAdapter, type RulesAgentSpec, homePath } from "./rules.ts";

/**
 * Cline (VS Code) adapter.
 *
 * Cline reads project rules from `.clinerules/` and global rules from
 * `~/.cline/rules/`. Capability payloads are exposed as managed markdown
 * rule files that Cline loads into the system prompt.
 */
export const CLINE_SPEC: RulesAgentSpec = {
  agent: "cline",
  label: "Cline",
  binaryKeys: [],
  projectRulesDir: () => ".clinerules",
  globalRulesDirs: [homePath(".cline", "rules")],
  fileSuffix: ".md",
};

export class ClineAdapter extends RulesAgentAdapter {
  constructor(ctx: DetectionContext) {
    super(CLINE_SPEC, ctx);
  }
}
