import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

export async function sha256Dir(dir: string, walk: (d: string) => Promise<string[]>): Promise<string> {
  const files = (await walk(dir)).filter((f) => !f.endsWith(".hash")).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.replace(dir + "/", ""));
    hash.update("\0");
    hash.update(await sha256File(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}
