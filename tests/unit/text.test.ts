import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeToken, expandAliases, tokenize, normalizePhrases, slugify, levenshtein } from "../../src/utils/text.ts";

test("normalizeToken lowercases and strips punctuation", () => {
  assert.equal(normalizeToken("  Next.JS!  "), "nextjs");
  assert.equal(normalizeToken("TypeScript"), "typescript");
  assert.equal(normalizeToken("unit_test"), "unit-test");
});

test("expandAliases expands canonical and aliases", () => {
  const set = expandAliases("next.js");
  assert.ok(set.has("nextjs"));
  assert.ok(set.has("next-js"));
  assert.ok(set.has("next"));
  const plain = expandAliases("unknown-term");
  assert.deepEqual([...plain], ["unknown-term"]);
});

test("tokenize splits words and drops stopwords", () => {
  assert.deepEqual(tokenize("Write tests for the API"), ["write", "tests", "api"]);
  assert.deepEqual(tokenize("deploy to production"), ["deploy", "to", "production"]);
});

test("normalizePhrases keeps tokens and short sentences", () => {
  const set = normalizePhrases("handle stripe webhooks");
  assert.ok(set.has("stripe"));
  assert.ok(set.has("webhooks"));
  assert.ok(set.has("handle stripe webhooks"));
});

test("slugify produces url-safe slugs", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("  --Fix Me--  "), "fix-me");
  assert.equal(slugify("x".repeat(100)).length, 64);
});

test("levenshtein distances", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("same", "same"), 0);
  assert.equal(levenshtein("abc", "abcde"), 2);
});