import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSemVer, isValidSemVer, compareSemVer, satisfies, highestVersion } from "../../src/utils/version.ts";

test("parseSemVer parses full and partial forms", () => {
  assert.deepEqual(parseSemVer("1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: null });
  assert.deepEqual(parseSemVer("v1.2.3"), { major: 1, minor: 2, patch: 3, prerelease: null });
  assert.deepEqual(parseSemVer("1.2.3-rc.1"), { major: 1, minor: 2, patch: 3, prerelease: "rc.1" });
  assert.equal(parseSemVer("1.2"), null);
  assert.equal(parseSemVer("abc"), null);
});

test("isValidSemVer accepts only valid versions", () => {
  assert.equal(isValidSemVer("1.0.0"), true);
  assert.equal(isValidSemVer("v2.3.4"), true);
  assert.equal(isValidSemVer("0.0.1-beta.2"), true);
  assert.equal(isValidSemVer("1.0"), false);
  assert.equal(isValidSemVer("1.0.0.0"), false);
  assert.equal(isValidSemVer(""), false);
});

test("compareSemVer orders versions", () => {
  assert.equal(compareSemVer("1.0.0", "1.0.0"), 0);
  assert.ok(compareSemVer("1.2.0", "1.1.9") > 0);
  assert.ok(compareSemVer("0.9.0", "1.0.0") < 0);
  assert.ok(compareSemVer("2.0.0-rc.1", "2.0.0") < 0);
  assert.ok(compareSemVer("1.0.0-alpha", "1.0.0-beta") < 0);
});

test("satisfies supports exact, ranges, && and ||", () => {
  assert.equal(satisfies("1.2.3", "1.2.3"), true);
  assert.equal(satisfies("1.2.3", ">=1.0.0 <2.0.0"), true);
  assert.equal(satisfies("2.5.0", ">=1.0.0 <2.0.0"), false);
  assert.equal(satisfies("1.9.0", "^1.2.0"), true);
  assert.equal(satisfies("2.0.0", "^1.2.0"), false);
  assert.equal(satisfies("1.3.9", "~1.2.0"), false);
  assert.equal(satisfies("1.2.9", "~1.2.0"), true);
  assert.equal(satisfies("3.0.0", "1.0.0 || 3.0.0"), true);
  assert.equal(satisfies("2.0.0", "1.0.0 || 3.0.0"), false);
  assert.equal(satisfies("9.9.9", "*"), true);
  assert.equal(satisfies("1.2.3", "latest"), true);
  assert.equal(satisfies("1.2.3", ">=2.0.0"), false);
});

test("highestVersion picks the newest", () => {
  assert.equal(highestVersion(["1.0.0", "2.0.0", "1.9.0"]), "2.0.0");
  assert.equal(highestVersion([]), null);
  assert.equal(highestVersion(["1.0.0-rc.1", "1.0.0"]), "1.0.0");
});