import { test } from "node:test";
import assert from "node:assert/strict";
import { parseManifestYaml, validateManifest, normalizeManifest, formatProblems, SUPPORTED_SCHEMAS } from "../../src/manifest/validate.ts";
import { loadManifestFromContent, loadManifestFile } from "../../src/manifest/index.ts";
import { ManifestError } from "../../src/utils/errors.ts";

const VALID = `schema: skillrouter/v1
id: stripe-payments
name: Stripe Payments
version: 1.2.0
description: Handles Stripe checkout flows and webhook verification.
type: skill
triggers:
  keywords: [checkout, refund]
  technologies: [stripe]
compatibility:
  opencode: native
permissions:
  filesystem:
    read: true
    write: false
  network:
    allowed: [api.stripe.com]
risk:
  level: low
metadata:
  tags: [payments]
`;

test("validateManifest accepts a well-formed manifest", () => {
  const result = validateManifest(parseManifestYaml(VALID, "valid.yaml"));
  assert.deepEqual(result.errors, []);
});

test("validateManifest reports missing and invalid fields as errors", () => {
  const result = validateManifest(
    parseManifestYaml(
      `schema: skillrouter/v99
id: Bad Id!
name: ""
version: not-a-version
type: weird
description: ""
`,
      "bad.yaml",
    ),
  );
  const paths = result.errors.map((e) => e.path);
  for (const p of ["schema", "id", "version", "description", "type", "name"]) assert.ok(paths.includes(p), `expected error at ${p}`);
  assert.ok(result.problems.some((p) => p.path === "schema" && p.message.includes("unsupported schema")));
});

test("validateManifest warns when no triggers or capabilities", () => {
  const result = validateManifest(
    parseManifestYaml(
      `schema: skillrouter/v1
id: lonely-cap
name: Lonely
version: 1.0.0
description: x
type: skill
`,
      "lonely.yaml",
    ),
  );
  assert.ok(result.warnings.length >= 1);
  assert.deepEqual(result.errors, []);
});

test("validateManifest flags unrestricted network without explicit flag", () => {
  const doc = parseManifestYaml(
    `schema: skillrouter/v1
id: wide-net
name: Wide
version: 1.0.0
description: x
type: skill
permissions:
  network:
    allowed: ["*"]
`,
    "wide.yaml",
  );
  const noExplicit = validateManifest(doc);
  assert.ok(noExplicit.problems.some((p) => p.path === "permissions.network.allowed" && p.message.includes("requires the capability to be flagged")));
});

test("parseManifestYaml rejects invalid roots", () => {
  assert.throws(() => parseManifestYaml("- a\n- b", "arr.yaml"), ManifestError);
  assert.throws(() => parseManifestYaml("{{{{", "bad.yaml"), ManifestError);
  assert.throws(() => parseManifestYaml("", "empty.yaml"), ManifestError);
});

test("normalizeManifest converts to Capability", () => {
  const cap = normalizeManifest(parseManifestYaml(VALID, "stripe.yaml"), "stripe.yaml");
  assert.equal(cap.id, "stripe-payments");
  assert.equal(cap.version, "1.2.0");
  assert.equal(cap.type, "skill");
  assert.deepEqual(cap.triggers?.technologies, ["stripe"]);
  assert.equal(cap.permissions?.network?.allowed[0], "api.stripe.com");
  assert.equal(cap.risk?.declared, "low");
  assert.equal(cap.manifestPath, "stripe.yaml");
});

test("normalizeManifest carries fallback chains through", () => {
  const content = `schema: skillrouter/v1
id: web-search
name: Web Search
version: 1.0.0
description: research the web
type: skill
fallbacks:
  - browser-search
  - http-fetch
`;
  const cap = normalizeManifest(parseManifestYaml(content, "web-search.yaml"), "web-search.yaml");
  assert.deepEqual(cap.fallbacks, ["browser-search", "http-fetch"]);
});

test("validateManifest rejects non-array fallbacks", () => {
  const doc = parseManifestYaml(
    `schema: skillrouter/v1
id: web-search
name: Web Search
version: 1.0.0
description: research the web
type: skill
fallbacks: browser-search
`,
    "web-search.yaml",
  );
  const report = validateManifest(doc);
  assert.ok(report.problems.some((p) => p.path === "fallbacks" && p.message.includes("array")));
});

test("loadManifestFromContent rejects manifests with fatal problems", () => {
  assert.throws(
    () => loadManifestFromContent("id: no-schema\nname: X\nversion: 1.0.0\n", "f.yaml"),
    (err: unknown) => err instanceof ManifestError && err.message.includes("Invalid manifest"),
  );
});

test("loadManifestFromContent strict mode rejects warnings too", () => {
  const content = `schema: skillrouter/v1
id: strict-cap
name: Strict
version: 1.0.0
description: x
type: skill
`;
  const opts = { strict: true };
  assert.throws(() => loadManifestFromContent(content, "s.yaml", opts), ManifestError);
  assert.doesNotThrow(() => loadManifestFromContent(content, "s.yaml"));
});

test("loadManifestFile reads and normalizes a fixture", async () => {
  const cap = await loadManifestFile("tests/fixtures/stripe-skill.yaml");
  assert.ok(cap);
  assert.equal(cap.id, "stripe-payments");
  assert.equal(cap.metadata?.author, "SkillRouter Examples");
  const nextjs = await loadManifestFile("tests/fixtures/nextjs-skill.yaml");
  assert.equal(nextjs?.id, "nextjs-optimizer");
  assert.equal(nextjs?.type, "plugin");
  const missing = await loadManifestFile("tests/fixtures/does-not-exist.yaml");
  assert.equal(missing, null);
});

test("formatProblems renders path-prefixed lines", () => {
  const lines = formatProblems([{ path: "id", message: "invalid" }, { path: "", message: "bare" }]);
  assert.deepEqual(lines, ["id: invalid", "bare"]);
});

test("SUPPORTED_SCHEMAS contains skillrouter/v1", () => {
  assert.deepEqual(SUPPORTED_SCHEMAS, ["skillrouter/v1"]);
});