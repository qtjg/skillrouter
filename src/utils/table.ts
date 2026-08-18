import { color } from "./color.ts";

export interface TableOptions {
  headers: string[];
  rows: string[][];
  maxWidth?: number;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

export function renderTable(opts: TableOptions): string {
  const maxWidth = opts.maxWidth ?? 120;
  const widths = opts.headers.map((h, i) => {
    const max = Math.max(h.length, ...opts.rows.map((r) => stripAnsi(r[i] ?? "").length));
    return Math.min(max, maxWidth / Math.max(opts.headers.length, 1));
  });

  const renderRow = (cells: string[]) => {
    const truncated = cells.map((cell, i) => {
      const stripped = stripAnsi(cell);
      if (stripped.length > widths[i]!) {
        const visible: string[] = [];
        let visCount = 0;
        let j = 0;
        while (j < cell.length && visCount < widths[i]! - 1) {
          const m = /\u001b\[[0-9;]*m/.exec(cell.slice(j));
          if (m && m.index === 0) {
            visible.push(m[0]);
            j += m[0].length;
          } else {
            visible.push(cell[j]!);
            visCount += 1;
            j += 1;
          }
        }
        return `${visible.join("")}…`;
      }
      return cell;
    });
    return ` ${truncated.map((c, i) => c.padEnd(widths[i]!)).join("│")}`;
  };

  const header = renderRow(opts.headers);
  const sep = `─${widths.map((w) => "─".repeat(w)).join("─┼─")}─`;
  const lines = [header, sep, ...opts.rows.map(renderRow)];
  return lines.join("\n");
}

export function renderKV(entries: Array<[string, string]>, indent = 2): string {
  const width = Math.max(...entries.map(([k]) => k.length));
  return entries.map(([k, v]) => `${" ".repeat(indent)}${color(k.padEnd(width), "bold")}  ${v}`).join("\n");
}
