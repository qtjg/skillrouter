import { SkillRouterError, UsageError, formatError } from "../utils/errors.ts";
import { color, bold, dim, red } from "../utils/color.ts";
import { createRequire } from "node:module";

export type FlagType = "string" | "boolean" | "number";

export interface FlagDef {
  name: string;
  short?: string;
  type?: FlagType;
  description: string;
}

export interface ArgDef {
  name: string;
  required?: boolean;
  variadic?: boolean;
  description?: string;
}

export interface CommandDef {
  name: string;
  aliases?: string[];
  category: string;
  description: string;
  usage?: string;
  flags?: FlagDef[];
  args?: ArgDef[];
  examples?: string[];
  handler: (ctx: CliContext) => Promise<number | void>;
  hidden?: boolean;
}

export interface ParsedFlags {
  [key: string]: string | number | boolean | undefined;
}

export interface CliContext {
  cwd: string;
  command: string;
  positionals: string[];
  flags: ParsedFlags;
  json: boolean;
}

export class CommandRegistry {
  private commands = new Map<string, CommandDef>();

  register(command: CommandDef): void {
    this.commands.set(command.name, command);
    for (const alias of command.aliases ?? []) this.commands.set(alias, command);
  }

  get(name: string): CommandDef | undefined {
    return this.commands.get(name);
  }

  all(): CommandDef[] {
    return [...new Set(this.commands.values())];
  }
}

interface ParsedArgv {
  flags: ParsedFlags;
  positionals: string[];
}

export function parseArgs(argv: string[], defs: FlagDef[]): ParsedArgv {
  const flags: ParsedFlags = {};
  const positionals: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const token = argv[i]!;
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      let name = token.slice(2);
      let value: string | undefined;
      const eq = name.indexOf("=");
      if (eq !== -1) {
        value = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      const def = defs.find((d) => d.name === name);
      if (!def) throw new UsageError(`Unknown flag --${name}`, `Run \`skillrouter --help\` for supported flags.`);
      const type = def.type ?? "boolean";
      if (type === "boolean") {
        flags[name] = value === undefined ? true : value !== "false";
      } else if (value === undefined) {
        const next = argv[i + 1];
        if (next === undefined) throw new UsageError(`Flag --${name} requires a value`);
        flags[name] = type === "number" ? Number(next) : next;
        i += 1;
      } else {
        flags[name] = type === "number" ? Number(value) : value;
      }
    } else if (token.startsWith("-") && token.length > 1) {
      const short = token.slice(1);
      const def = defs.find((d) => d.short === short);
      if (!def) throw new UsageError(`Unknown flag -${short}`);
      const type = def.type ?? "boolean";
      if (type === "boolean") {
        flags[def.name] = true;
      } else {
        const next = argv[i + 1];
        if (next === undefined) throw new UsageError(`Flag -${short} requires a value`);
        flags[def.name] = type === "number" ? Number(next) : next;
        i += 1;
      }
    } else {
      positionals.push(token);
    }
    i += 1;
  }
  return { flags, positionals };
}

export async function execute(argv: string[], registry: CommandRegistry): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    renderHelp(registry);
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`${versionLine()}\n`);
    return 0;
  }

  const commandName = argv[0]!;
  const command = registry.get(commandName);
  if (!command) {
    process.stderr.write(`${red(`Unknown command "${commandName}"`)}\n\n`);
    renderHelp(registry);
    return 2;
  }

  const json = argv.includes("--json");
  try {
    let parsed;
    try {
      parsed = parseArgs(argv.slice(1).filter((a) => a !== "--json"), command.flags ?? []);
    } catch (err) {
      if (err instanceof UsageError) throw err;
      throw err;
    }
    const optional: string[] = [];
    for (const arg of command.args ?? []) {
      if (!arg.required && !arg.variadic) continue;
      if (arg.required && parsed.positionals.length === 0) {
        throw new UsageError(`Missing required argument <${arg.name}>`, command.usage ? `Usage: ${command.usage}` : undefined);
      }
      if (arg.variadic) {
        optional.push(...parsed.positionals.slice(0));
        break;
      }
    }
    void optional;

    for (const flag of command.flags ?? []) {
      if (typeof parsed.flags[flag.name] === "number" && !Number.isFinite(parsed.flags[flag.name])) {
        throw new UsageError(`Flag --${flag.name} must be a number`);
      }
    }

    const ctx: CliContext = {
      cwd: process.cwd(),
      command: command.name,
      positionals: parsed.positionals,
      flags: parsed.flags,
      json,
    };
    const result = await command.handler(ctx);
    return typeof result === "number" ? result : 0;
  } catch (err) {
    if (err instanceof SkillRouterError) {
      process.stderr.write(`${red(err.name === "SkillRouterError" ? "Error" : err.name)}: ${err.message}\n`);
      if (err.hint) process.stderr.write(`${dim(`Hint: ${err.hint}`)}\n`);
    } else if (err instanceof Error) {
      process.stderr.write(`${red("Error")}: ${err.message}\n`);
    } else {
      process.stderr.write(`${red("Error")}: ${formatError(err)}\n`);
    }
    return err instanceof SkillRouterError ? err.exitCode : 1;
  }
}

function versionLine(): string {
  const pkg = getVersion();
  return `skillrouter ${pkg ?? "dev"}`;
}

function getVersion(): string | null {
  try {
    const require2 = createRequire(import.meta.url);
    for (const candidate of ["../../package.json", "../../../package.json", "../../../../package.json"]) {
      try {
        const pkg = require2(candidate) as { version?: string };
        if (pkg && typeof pkg.version === "string") return pkg.version;
      } catch {
        // try next
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function renderHelp(registry: CommandRegistry, command?: CommandDef): void {
  if (command) {
    renderCommandHelp(command);
    return;
  }
  const out: string[] = [];
  out.push(bold("SkillRouter — The capability router for AI agents."));
  out.push("");
  out.push(dim("Usage: skillrouter <command> [options] [args]"));
  out.push("");
  const byCategory = new Map<string, CommandDef[]>();
  for (const cmd of registry.all()) {
    if (cmd.hidden) continue;
    const list = byCategory.get(cmd.category) ?? [];
    list.push(cmd);
    byCategory.set(cmd.category, list);
  }
  for (const [category, commands] of byCategory) {
    out.push(bold(category));
    for (const cmd of commands.sort((a, b) => a.name.localeCompare(b.name))) {
      const usage = cmd.usage ?? commandUsage(cmd);
      out.push(`  ${color(cmd.name.padEnd(22), "cyan")}${usage || ""}`);
      out.push(`  ${dim(cmd.description)}`);
    }
    out.push("");
  }
  out.push(dim("Run `skillrouter <command> --help` for command details."));
  process.stdout.write(out.join("\n") + "\n");
}

function commandUsage(cmd: CommandDef): string {
  const parts: string[] = [];
  for (const arg of cmd.args ?? []) {
    parts.push(arg.variadic ? `...<${arg.name}>` : arg.required ? `<${arg.name}>` : `[${arg.name}]`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function renderCommandHelp(command: CommandDef): void {
  const out: string[] = [];
  out.push(bold(command.description));
  out.push("");
  out.push(`Usage: skillrouter ${command.name}${command.usage ? " " + command.usage : commandUsage(command)}`);
  if (command.aliases?.length) out.push(dim(`Aliases: ${command.aliases.join(", ")}`));
  if (command.args?.length) {
    out.push("");
    out.push(bold("Arguments:"));
    for (const arg of command.args) {
      out.push(`  ${color(arg.name.padEnd(18), "cyan")}${arg.required ? "required" : "optional"}${arg.description ? ` — ${dim(arg.description)}` : ""}`);
    }
  }
  if (command.flags?.length) {
    out.push("");
    out.push(bold("Options:"));
    for (const flag of command.flags) {
      const short = flag.short ? `-${flag.short}, ` : "    ";
      out.push(`  ${short}--${flag.name.padEnd(16)}${dim(flag.description)}`);
    }
  }
  if (command.examples?.length) {
    out.push("");
    out.push(bold("Examples:"));
    for (const example of command.examples) {
      out.push(`  ${dim("$")} ${example}`);
    }
  }
  out.push("");
  out.push(dim("Global flags: --json (machine-readable output)"));
  process.stdout.write(out.join("\n") + "\n");
}