import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const OUTPUT_TS = fileURLToPath(new URL("../../src/cli/output.ts", import.meta.url));

function runPromptScript(answer: boolean, stdinMode: "ignore" | "pipe"): Promise<{ stdout: string; code: number | null }> {
  const script = [
    `const m = await import(${JSON.stringify("file://" + OUTPUT_TS)});`,
    `const v = await m.promptYesNo("Proceed?", ${answer ? "true" : "false"});`,
    `console.log("RESOLVED:" + v);`,
  ].join("\n");
  const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    stdio: [stdinMode, "pipe", "pipe"],
  });
  let stdout = "";
  if (!child.stdout) throw new Error("child stdout unavailable");
  child.stdout.on("data", (c) => (stdout += c));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("promptYesNo did not settle within 5s (non-TTY stdin hang regression)"));
    }, 5000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, code });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test("promptYesNo resolves to the default when stdin is closed (CI/agents, no TTY)", async () => {
  const { stdout } = await runPromptScript(true, "ignore");
  assert.ok(stdout.includes("RESOLVED:true"), `expected default resolution, got: ${stdout}`);
});

test("promptYesNo resolves to false-default when stdin is closed and default is no", async () => {
  const { stdout } = await runPromptScript(false, "ignore");
  assert.ok(stdout.includes("RESOLVED:false"), `expected default resolution, got: ${stdout}`);
});

test("promptYesNo still reads a piped y/n answer", async () => {
  // stdinMode "pipe" with no data written would hang forever pre-fix only when
  // closed; here we actually write an answer, so the pipe path must still work.
  const script = [
    `const m = await import(${JSON.stringify("file://" + OUTPUT_TS)});`,
    `const v = await m.promptYesNo("Proceed?", false);`,
    `console.log("RESOLVED:" + v);`,
  ].join("\n");
  const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  let stdout = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stdin.write("y\n");
  child.stdin.end();
  const [code] = await once(child, "close");
  clearTimeout(timer);
  assert.equal(code, 0);
  assert.ok(stdout.includes("RESOLVED:true"), `expected piped answer to win, got: ${stdout}`);
});
