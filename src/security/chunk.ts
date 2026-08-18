import { readFile } from "node:fs/promises";

const MAX_BYTES = 256 * 1024;

export async function readTextChunk(filePath: string): Promise<string | null> {
  try {
    const handle = await readFile(filePath);
    if (handle.byteLength > MAX_BYTES) return null;
    return handle.toString("utf8");
  } catch {
    return null;
  }
}