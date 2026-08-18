import { test } from "node:test";
import assert from "node:assert/strict";
import { scanTextForSecrets, isSensitiveFile, shouldWarnOnFile } from "../../src/security/secrets.ts";

test("scanTextForSecrets detects common key formats", () => {
  const content = [
    "# safe comment",
    "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
    "OPENAI_API_KEY=sk-1234567890123456789012345678901234567890abcdef",
    "git remote url = https://github.com/org/repo.git",
  ].join("\n");
  const matches = scanTextForSecrets(content, ".env");
  const patterns = matches.map((m) => m.pattern);
  assert.ok(patterns.includes("aws-access-key"));
  assert.ok(patterns.includes("openai-api-key"));
  assert.equal(matches.find((m) => m.pattern === "aws-access-key")?.line, 2);
});

test("scanTextForSecrets ignores commented lines", () => {
  const content = "# sk-1234567890123456789012345678901234567890abcdef\nonly_comment_line";
  assert.deepEqual(scanTextForSecrets(content, "config.txt"), []);
});

test("scanTextForSecrets catches generic assignments", () => {
  const matches = scanTextForSecrets('api_key = "super-secret-value-1234"', "app.ts");
  assert.ok(matches.some((m) => m.pattern === "generic-assignment"));
});

test("scanTextForSecrets finds private keys and JWTs", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAqNFw==\n-----END RSA PRIVATE KEY-----";
  assert.ok(scanTextForSecrets(pem, "key.pem").some((m) => m.pattern === "private-key"));
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  assert.ok(scanTextForSecrets(jwt, "token.txt").some((m) => m.pattern === "jwt"));
});

test("scanTextForSecrets skips big files", () => {
  const big = "a".repeat(2 * 1024 * 1024 + 1);
  assert.deepEqual(scanTextForSecrets(big, "big.txt"), []);
});

test("isSensitiveFile matches basenames only", () => {
  assert.equal(isSensitiveFile(".env"), true);
  assert.equal(isSensitiveFile("config/.env.production"), true);
  assert.equal(isSensitiveFile("src/.env.example"), false);
  assert.equal(isSensitiveFile("credentials.json"), true);
  assert.equal(isSensitiveFile("README.md"), false);
});

test("shouldWarnOnFile flags key material", () => {
  assert.equal(shouldWarnOnFile("server.key"), true);
  assert.equal(shouldWarnOnFile("cert.pem"), true);
  assert.equal(shouldWarnOnFile("src/main.ts"), false);
  assert.equal(shouldWarnOnFile(".env"), true);
});