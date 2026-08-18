import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256, sha256File, sha256Dir, fileExists } from "../../src/utils/hash.ts";

test("sha256 hashes known vectors", () => {
  assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  assert.equal(sha256(Buffer.from("hello")), sha256("hello"));
});

test("sha256File hashes file contents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-hash-"));
  try {
    const file = join(dir, "data.txt");
    await writeFile(file, "hello world");
    assert.equal(await sha256File(file), sha256("hello world"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sha256Dir produces stable hash and excludes .hash files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-dir-"));
  try {
    await writeFile(join(dir, "b.txt"), "bb");
    await writeFile(join(dir, "a.txt"), "aa");
    await writeFile(join(dir, "ignored.hash"), "skip");
    const walk = async (d: string): Promise<string[]> =>
      ["a.txt", "b.txt", "ignored.hash"].map((name) => join(d, name));
    const expected = sha256("a.txt\0" + sha256("aa") + "\0" + "b.txt\0" + sha256("bb") + "\0");
    assert.equal(await sha256Dir(dir, walk), expected);
    const repeated = await sha256Dir(dir, walk);
    assert.equal(repeated, expected);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fileExists detects files and missing paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sr-exists-"));
  try {
    const file = join(dir, "present.txt");
    await writeFile(file, "x");
    assert.equal(await fileExists(file), true);
    assert.equal(await fileExists(join(dir, "missing.txt")), false);
    assert.equal(await fileExists(dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});