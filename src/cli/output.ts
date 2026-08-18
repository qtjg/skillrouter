import { color, bold, dim, green, red, yellow, cyan, gray, check, cross, warn } from "../utils/color.ts";
import { renderTable } from "../utils/table.ts";

export interface SectionOptions {
  margin?: number;
}

export function section(title: string, options: SectionOptions = {}): void {
  const margin = " ".repeat(options.margin ?? 0);
  process.stdout.write(`\n${margin}${bold(title)}\n`);
}

export function line(text = ""): void {
  process.stdout.write(text + "\n");
}

export function item(text: string, indent = 2): void {
  process.stdout.write(`${" ".repeat(indent)}${text}\n`);
}

export function ok(text: string, indent = 2): void {
  process.stdout.write(`${" ".repeat(indent)}${check(text)}\n`);
}

export function fail(text: string, indent = 2): void {
  process.stdout.write(`${" ".repeat(indent)}${cross(text)}\n`);
}

export function warning(text: string, indent = 2): void {
  process.stdout.write(`${" ".repeat(indent)}${warn(text)}\n`);
}

export function info(text: string, indent = 2): void {
  process.stdout.write(`${" ".repeat(indent)}${dim(text)}\n`);
}

export function table(headers: string[], rows: string[][]): void {
  process.stdout.write(renderTable({ headers, rows }) + "\n");
}

export function riskColor(level: string): string {
  switch (level) {
    case "low":
      return green(level.toUpperCase());
    case "medium":
      return yellow(level.toUpperCase());
    case "high":
      return red(level.toUpperCase());
    case "critical":
      return red(level.toUpperCase()) + "!";
    default:
      return gray(level);
  }
}

export function compatColor(level: string): string {
  switch (level) {
    case "native":
      return green(level);
    case "compatible":
      return cyan(level);
    case "adaptable":
      return yellow(level);
    default:
      return red(level);
  }
}

export function trustColor(level: string): string {
  switch (level) {
    case "verified":
      return green(level);
    case "trusted":
      return cyan(level);
    case "community":
      return yellow(level);
    case "blocked":
      return red(level);
    default:
      return gray(level);
  }
}

export function emoji(level: string): string {
  switch (level) {
    case "low":
      return "🟢";
    case "medium":
      return "🟡";
    case "high":
      return "🟠";
    case "critical":
      return "🔴";
    default:
      return "⚪";
  }
}

export function jsonOut(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export { color, bold, dim, green, red, yellow, cyan, gray };

export function printError(err: unknown): void {
  if (err instanceof Error) {
    process.stderr.write(`${red("Error")}: ${err.message}\n`);
  } else {
    process.stderr.write(`${red("Error")}: ${String(err)}\n`);
  }
}

export async function promptYesNo(question: string, defaultValue: boolean): Promise<boolean> {
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  process.stdout.write(`${question} ${dim(suffix)} `);
  process.stdin.setEncoding("utf8");
  let buffer = "";
  return await new Promise((resolve2) => {
    const onData = (chunk: string) => {
      buffer += chunk;
      if (!buffer.includes("\n") && !buffer.includes("\r")) return;
      process.stdin.removeListener("data", onData);
      const answer = buffer.trim().toLowerCase();
      if (answer === "") return resolve2(defaultValue);
      if (["y", "yes"].includes(answer)) return resolve2(true);
      if (["n", "no"].includes(answer)) return resolve2(false);
      process.stdout.write(`${yellow("Please answer y or n.")} ${suffix} `);
      buffer = "";
      process.stdin.on("data", onData);
    };
    process.stdin.on("data", onData);
  });
}

export function spinner(text: string): { stop: (final: string) => void } {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${dim(text)}...\n`);
    return { stop: () => {} };
  }
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${cyan(frames[i % frames.length]!)} ${dim(text)}`);
    i += 1;
  }, 80);
  return {
    stop: (final: string) => {
      clearInterval(interval);
      process.stdout.write(`\r${gray(final)}\n`);
    },
  };
}