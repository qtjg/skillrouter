const COLORS: Record<string, number> = {
  reset: 0,
  bold: 1,
  dim: 2,
  italic: 3,
  underline: 4,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
};

let enabled = process.stdout.isTTY && !process.env.NO_COLOR;

export function enableColor(value: boolean): void {
  enabled = value;
}

export function color(text: string, style: string): string {
  const codes = style.split("+").map((s) => COLORS[s.trim()]).filter((c): c is number => c !== undefined);
  if (!enabled || codes.length === 0) return text;
  return `\u001b[${codes.join(";")}m${text}\u001b[0m`;
}

export function bold(text: string): string {
  return color(text, "bold");
}

export function dim(text: string): string {
  return color(text, "dim");
}

export function green(text: string): string {
  return color(text, "green");
}

export function red(text: string): string {
  return color(text, "red");
}

export function yellow(text: string): string {
  return color(text, "yellow");
}

export function cyan(text: string): string {
  return color(text, "cyan");
}

export function magenta(text: string): string {
  return color(text, "magenta");
}

export function gray(text: string): string {
  return color(text, "gray");
}

export function check(text: string): string {
  return `${green("✓")} ${text}`;
}

export function cross(text: string): string {
  return `${red("✗")} ${text}`;
}

export function warn(text: string): string {
  return `${yellow("⚠")} ${text}`;
}
