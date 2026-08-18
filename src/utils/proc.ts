import { execFile } from "node:child_process";

export interface ProcResult {
  stdout: string;
  stderr: string;
  code: number;
  ok: boolean;
}

export function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<ProcResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeoutMs ?? 30000, env: { ...process.env, ...opts.env }, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
      resolve({ stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", code, ok: code === 0 });
    });
  });
}

export async function which(binary: string): Promise<string | null> {
  const result = await run("sh", ["-c", `command -v ${binary.replace(/[^a-zA-Z0-9_-]/g, "")} 2>/dev/null || true`]);
  const path = result.stdout.trim();
  return path.length > 0 ? path : null;
}
