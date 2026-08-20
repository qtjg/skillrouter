#!/usr/bin/env node
import { CommandRegistry, execute } from "./framework.ts";
import { initCommand, doctorCommand, statusCommand, configCommand } from "./commands/setup.ts";
import { searchCommand, infoCommand, findCommand } from "./commands/search.ts";
import { installCommand, uninstallCommand, updateCommand, sourceCommand } from "./commands/capabilities.ts";
import { enableCommand, disableCommand, forceEnableCommand, forceDisableCommand, activateCommand, deactivateCommand, activeCommand } from "./commands/state.ts";
import { routeCommand, explainCommand } from "./commands/route.ts";
import { scanCommand, permissionsCommand, trustCommand, keysCommand, trustCheckCommand, signCommand, signaturesCommand } from "./commands/security.ts";
import { logsCommand, verifyCommand, exportCommand, auditCommand, selfTestCommand } from "./commands/misc.ts";
import { statsCommand } from "./commands/stats.ts";
import { learnCommand } from "./commands/learn.ts";
import { reputationCommand } from "./commands/reputation.ts";
import { contextCommand } from "./commands/context.ts";
import { classifyCommand } from "./commands/classify.ts";
import { indexCommand } from "./commands/corpus.ts";
import { retrieveCommand } from "./commands/retrieve.ts";
import { duplicatesCommand } from "./commands/duplicates.ts";
import { qualityCommand, neighborsCommand } from "./commands/quality.ts";
import { planCommand } from "./commands/plan.ts";
import { gapsCommand } from "./commands/gaps.ts";
import { decomposeCommand, workflowCommand } from "./commands/workflow.ts";
import { pathToFileURL } from "node:url";

export function buildRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  // Setup
  registry.register(initCommand);
  registry.register(doctorCommand);
  registry.register(statusCommand);
  registry.register(configCommand);
  // Registry & search
  registry.register(searchCommand);
  registry.register(infoCommand);
  registry.register(findCommand);
  // Corpus
  registry.register(indexCommand);
  registry.register(retrieveCommand);
  registry.register(duplicatesCommand);
  registry.register(qualityCommand);
  registry.register(neighborsCommand);
  registry.register(planCommand);
  registry.register(gapsCommand);
  registry.register(decomposeCommand);
  registry.register(workflowCommand);
  // Capabilities
  registry.register(installCommand);
  registry.register(uninstallCommand);
  registry.register(updateCommand);
  registry.register(sourceCommand);
  // Runtime state
  registry.register(enableCommand);
  registry.register(disableCommand);
  registry.register(forceEnableCommand);
  registry.register(forceDisableCommand);
  registry.register(activateCommand);
  registry.register(deactivateCommand);
  registry.register(activeCommand);
  // Routing
  registry.register(routeCommand);
  registry.register(explainCommand);
  // Security
  registry.register(scanCommand);
  registry.register(permissionsCommand);
  registry.register(trustCommand);
  registry.register(trustCheckCommand);
  registry.register(keysCommand);
  registry.register(signCommand);
  registry.register(signaturesCommand);
  // Misc
  registry.register(logsCommand);
  registry.register(verifyCommand);
  registry.register(exportCommand);
  registry.register(auditCommand);
  registry.register(selfTestCommand);
  // Reliability
  registry.register(statsCommand);
  registry.register(learnCommand);
  registry.register(reputationCommand);
  // Context
  registry.register(contextCommand);
  registry.register(classifyCommand);
  return registry;
}

export async function main(argv: string[]): Promise<number> {
  const registry = buildRegistry();
  return await execute(argv, registry);
}

const isEntry = (() => {
  try {
    const self = pathToFileURL(process.argv[1] ?? "").href;
    return self === import.meta.url || self.endsWith("src/cli/index.ts");
  } catch {
    return false;
  }
})();

if (isEntry) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}

export default main;