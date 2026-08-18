import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isAbsolute } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readTextSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export async function writeTextAtomic(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  await import("node:fs/promises").then((m) => m.rename(tmp, path));
}

export async function copyFileSafe(from: string, to: string): Promise<void> {
  await ensureDir(dirname(to));
  await import("node:fs/promises").then((m) => m.copyFile(from, to));
}

export async function copyDirRecursive(from: string, to: string): Promise<void> {
  const { copyFile } = await import("node:fs/promises");
  const entries = await readdir(from, { withFileTypes: true });
  await ensureDir(to);
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(src, dest);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      await copyFile(src, dest);
    }
  }
}

export async function removeDir(path: string): Promise<void> {
  await import("node:fs/promises").then((m) => m.rm(path, { recursive: true, force: true }));
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function resolvePath(base: string, p: string): string {
  return isAbsolute(p) ? p : join(base, p);
}
