import type { CliContext, CommandDef } from "../framework.ts";
import { withApp } from "../context.ts";
import { line, ok, info, warning, fail, jsonOut, section, table, dim, bold } from "../output.ts";
import { runAudit, fixFindings } from "../../security/audit.ts";
import { updatePermissions, describeCapabilityPermissions, trustedSources, addTrustedSource, isSourceTrusted, removeTrustedSource } from "../../security/permissions.ts";
import { generateKeyPair, publicKeyFrom } from "../../security/keys.ts";

const permissionStrings = describeCapabilityPermissions;

function normalizeCapId(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

export const scanCommand: CommandDef = {
  name: "scan",
  category: "Security",
  description: "Scan a capability, project, or registry for security issues",
  usage: "[capability|project]",
  args: [{ name: "target", required: false, description: 'capability id, "project", or registry' }],
  flags: [
    { name: "fix", description: "apply safe fixes automatically" },
    { name: "json", description: "machine-readable output" },
  ],
  examples: ["skillrouter scan", "skillrouter scan security-audit", "skillrouter scan project --fix"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const target = ctx.positionals[0] ?? "project";
      const scope = target === "project" ? "project" : target === "registry" ? "registry" : "capability";
      const capabilityId = scope === "capability" ? normalizeCapId(target, "cap:") : null;
      const findings = await runAudit({
        storage: app.storage,
        config: app.config,
        cwd: app.cwd,
        scope,
        capabilityId,
      });
      const fix = Boolean(ctx.flags["fix"]);
      const fixed = fix ? await fixFindings(app.storage, app.cwd, findings) : [];

      if (ctx.json) {
        jsonOut({ scope, findings: findings.map((f) => ({ ...f, fixed: fixed.includes(f.id) })) });
        return 0;
      }
      if (findings.length === 0) {
        ok(`No issues found in ${scope}.`);
        return 0;
      }
      section(`Audit: ${scope}`);
      for (const finding of findings) {
        const label = finding.severity === "critical" ? "●" : finding.severity === "high" ? "●" : "○";
        const color = finding.severity === "critical" || finding.severity === "high" ? "red" : finding.severity === "medium" ? "yellow" : "green";
        line(`${label} [${finding.severity.toUpperCase()}] ${finding.capabilityId ?? "project"} · ${finding.title}`);
        line(`${" ".repeat(4)}${dim(finding.description)}`);
        if (finding.capabilityId && finding.detail) line(`${" ".repeat(4)}${bold("Detail:")} ${finding.detail}`);
        if (fixed.includes(finding.id)) info(`${" ".repeat(4)}✓ fixed`, 4);
        else if (finding.suggestion) info(`${" ".repeat(4)}→ ${finding.suggestion}`, 4);
      }
      const criticals = findings.filter((f) => f.severity === "critical").length;
      const highs = findings.filter((f) => f.severity === "high").length;
      const mediums = findings.filter((f) => f.severity === "medium").length;
      line("");
      fail(`${criticals + highs} critical/high, ${mediums} medium, ${findings.length - criticals - highs - mediums} low`);
      if (capabilityId) {
        const installed = await app.storage.getInstalled(capabilityId);
        if (!installed) warning(`Could not install-scope this capability; only manifest checks were run.`, 2);
      }
      return fix ? 0 : 0;
    });
  },
};

export const permissionsCommand: CommandDef = {
  name: "permissions",
  category: "Security",
  description: "Review or update capability permissions",
  usage: "[capability]",
  args: [{ name: "capability", required: false, description: "capability id" }],
  flags: [
    { name: "add", description: "add a permission (comma-separated list)" },
    { name: "remove", description: "remove a permission (comma-separated list)" },
    { name: "grant", description: "" }, // placeholder to keep parity with design
    { name: "json", description: "machine-readable output" },
  ],
  examples: ["skillrouter permissions", "skillrouter permissions security-audit", "skillrouter permissions stripe-expert --add net:http --remove fs:write"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const target = ctx.positionals[0];
      const active = new Map((await app.storage.allInstalled()).map((i) => [i.id, i]));
      const all = new Map((await app.storage.allCapabilities()).map((c) => [c.id, c]));
      const add = typeof ctx.flags["add"] === "string" && ctx.flags["add"].length > 0 ? ctx.flags["add"].split(",").map((s) => s.trim()) : [];
      const remove = typeof ctx.flags["remove"] === "string" && ctx.flags["remove"].length > 0 ? ctx.flags["remove"].split(",").map((s) => s.trim()) : [];

      if (target) {
        const id = normalizeCapId(target, "cap:");
        const capability = all.get(id);
        const installedOne = active.get(id);
        if (!capability) {
          fail(`Unknown capability "${id}".`);
          return 1;
        }
        const current = installedOne ? Array.from(capability.permissions ? permissionStrings(capability.permissions) : []) : permissionStrings(capability.permissions);
        if (add.length > 0 || remove.length > 0) {
          if (!installedOne) {
            fail(`${id} is not installed; permissions are only editable on installed capabilities.`);
            return 1;
          }
          const next = Array.from(new Set([...current.filter((p) => !remove.includes(p)), ...add]));
          await updatePermissions(app.storage, id, next);
          ok(`Updated permissions for ${id}`);
          info(`Now: ${next.join(", ") || "(none)"}`, 2);
          if (ctx.json) jsonOut({ id, permissions: next });
          return 0;
        }
        line(`Permissions for ${bold(id)}:`);
        if (current.length === 0) line(`  ${dim("(none)")}`);
        for (const p of current) line(`  ✓ ${p}`);
        return 0;
      }

      // summary across all installed capabilities
      const rows: string[][] = [];
      for (const [id, row] of active) {
        const capability = all.get(id);
        rows.push([id, capability ? (permissionStrings(capability.permissions).join("\n") || dim("(none)")) : dim("(none)")]);
      }
      if (rows.length === 0) {
        line("No capabilities installed yet.");
        info("Run `skillrouter install <capability>` first.");
        return 0;
      }
      table(["capability", "permissions"], rows);
      return 0;
    });
  },
};

export const trustCommand: CommandDef = {
  name: "trust",
  category: "Security",
  description: "Manage trusted sources (registries/forges)",
  usage: "list|<source>",
  args: [{ name: "source", required: false, description: "registry URL or source name" }],
  flags: [
    { name: "add", description: "add the source to the trust list" },
    { name: "remove", description: "remove the source from the trust list" },
    { name: "json", description: "machine-readable output" },
  ],
  examples: ["skillrouter trust", "skillrouter trust github:acme --add", "skillrouter trust github:acme --remove"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const sourceArg = ctx.positionals[0];
      if (typeof ctx.flags["add"] === "string" || ctx.flags["add"] === true) {
        if (!sourceArg) {
          fail("Usage: skillrouter trust <source> --add");
          return 1;
        }
        const source = normalizeSource(sourceArg);
        await addTrustedSource(app.storage, source);
        ok(`Trusted ${source}`);
        return 0;
      }
      if (typeof ctx.flags["remove"] === "string" || ctx.flags["remove"] === true) {
        if (!sourceArg) {
          fail("Usage: skillrouter trust <source> --remove");
          return 1;
        }
        const source = normalizeSource(sourceArg);
        await removeTrustedSource(app.storage, source);
        ok(`Untrusted ${source}`);
        return 0;
      }
      const sources = await trustedSources(app.storage);
      if (ctx.json) {
        jsonOut({ sources });
        return 0;
      }
      section("Trusted sources");
      if (sources.length === 0) line("  (none)");
      for (const s of sources) line(`  ✓ ${s}`);
      line("");
      info("Add: `skillrouter trust <source> --add`");
      return 0;
    });
  },
};

export const keysCommand: CommandDef = {
  name: "keys",
  category: "Security",
  description: "Manage signing keys for capability verification",
  flags: [
    { name: "generate", description: "generate a new keypair into the data directory" },
    { name: "show", description: "show the current public key" },
  ],
  examples: ["skillrouter keys --generate", "skillrouter keys --show"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      if (ctx.flags["generate"]) {
        await generateKeyPair(app.storage);
        ok(`Keypair generated (${app.storage.dataDir}/keys/)`);
        return 0;
      }
      if (ctx.flags["show"]) {
        const publicKey = await publicKeyFrom(app.storage);
        if (!publicKey) {
          fail("No public key found. Run `skillrouter keys --generate`.");
          return 1;
        }
        line(publicKey);
        return 0;
      }
      line("Usage: skillrouter keys --generate | --show");
      return 1;
    });
  },
};

export const trustCheckCommand: CommandDef = {
  name: "trust-check",
  category: "Security",
  description: "Check whether a source is trusted",
  usage: "<source>",
  args: [{ name: "source", required: true, description: "registry URL or source name" }],
  examples: ["skillrouter trust-check github:acme"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const source = ctx.positionals[0]!;
      const trusted = await isSourceTrusted(app.storage, source);
      if (trusted) ok(`${source} is trusted`);
      else {
        warning(`${source} is NOT trusted`);
        return 1;
      }
      return 0;
    });
  },
};

export const signCommand: CommandDef = {
  name: "sign",
  category: "Security",
  description: "Sign a capability manifest (publish-stage)",
  usage: "<manifest.json>",
  args: [{ name: "manifest", required: true, description: "path to a manifest file" }],
  examples: ["skillrouter sign dist/manifest.json"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const manifestPath = ctx.positionals[0]!;
      const { signManifest } = await import("../../security/sign.ts");
      const result = await signManifest(manifestPath, app.storage);
      if (!result) {
        fail("Signing failed. Ensure a keypair exists (skillrouter keys --generate).");
        return 1;
      }
      ok(`Manifest signed: ${result.publicKeyFingerprint}`);
      return 0;
    });
  },
};

export const signaturesCommand: CommandDef = {
  name: "signatures",
  category: "Security",
  description: "Verify the signature chain of installed capabilities",
  flags: [{ name: "json", description: "machine-readable output" }],
  examples: ["skillrouter signatures"],
  handler: async (ctx) => {
    return withApp(ctx, async (app) => {
      const { verifyInstallChain } = await import("../../security/verify.ts");
      const installed = await app.storage.allInstalled();
      const results = await verifyInstallChain(app.storage, installed.map((r) => r.id));
      if (ctx.json) {
        jsonOut(results);
        return results.every((r) => r.status === "valid") ? 0 : 1;
      }
      section("Signature status");
      for (const result of results) {
        const status = result.status === "valid" ? "✓" : result.status === "unsigned" ? "—" : "✗";
        line(`${status} ${result.capabilityId} ${result.status}${result.reason ? ` — ${result.reason}` : ""}`);
      }
      return results.some((r) => r.status === "invalid") ? 1 : 0;
    });
  },
};

function normalizeSource(value: string): string {
  return value.trim();
}