import type { Storage } from "../storage/types.ts";
import type { Capability, TrustLevel } from "../core/types.ts";
import type { SkillRouterConfig } from "../config/config.ts";
import { scanTextForSecrets, isSensitiveFile, shouldWarnOnFile } from "./secrets.ts";
import { computeRisk } from "./risk.ts";
import { walkFiles } from "../utils/glob.ts";
import { pathExists } from "../utils/fs.ts";
import { readTextChunk } from "./chunk.ts";

export type AuditAction =
  | "init"
  | "doctor"
  | "install"
  | "uninstall"
  | "update"
  | "enable"
  | "disable"
  | "activate"
  | "deactivate"
  | "force-enable"
  | "force-disable"
  | "route"
  | "trust.set"
  | "trust.remove"
  | "source.add"
  | "source.remove"
  | "config.set"
  | "config.unset"
  | "block"
  | "unblock"
  | "verify"
  | "scan";

export async function audit(storage: Storage, actor: string, action: AuditAction, capability: string | null, detail: string | null = null): Promise<void> {
  await storage.addAudit(actor, action, capability, detail);
}

export async function auditTrail(storage: Storage, limit = 50, capability?: string): Promise<import("../storage/types.ts").AuditRow[]> {
  const rows = await storage.getAudit({ limit, capability });
  return rows.map((row) => ({ ...row, level: severityOf(row.action) }));
}

function severityOf(action: string): "fail" | "warn" | "ok" {
  if (["install", "uninstall", "force-enable", "force-disable", "route"].includes(action)) return "warn";
  if (["enable", "disable", "activate", "deactivate", "update"].includes(action)) return "ok";
  return "ok";
}

export type AuditScope = "capability" | "project" | "registry";

export interface AuditFinding {
  id: string;
  scope: AuditScope;
  capabilityId: string | null;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  detail: string | null;
  suggestion: string | null;
  autoFixable: boolean;
}

export interface AuditOptions {
  storage: Storage;
  config: SkillRouterConfig;
  cwd: string;
  scope: AuditScope;
  capabilityId?: string | null;
}

const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".skillrouter", ".cache", "dist", "build", "vendor", ".next", ".turbo"]);

const HIGH_RISK_PATTERNS = new Set(["private-key", "aws-secret", "stripe-secret-key", "stripe-restricted-key", "openai-api-key", "github-token", "npm-token"]);

/** Runs security checks depending on the requested scope. */
export async function runAudit(opts: AuditOptions): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  if (opts.scope === "capability") {
    if (!opts.capabilityId) return findings;
    const capability = await opts.storage.getCapability(opts.capabilityId);
    if (capability) findings.push(...await auditCapability(opts.storage, capability));
  } else if (opts.scope === "project") {
    findings.push(...await auditProjectFiles(opts.cwd, opts.cwd));
    const config = opts.config;
    if (config.security.blocked.length > 0) {
      findings.push({
        id: stableId("blocked-caps"),
        scope: "project",
        capabilityId: null,
        severity: "low",
        title: "Blocked capabilities configured",
        description: `Security config blocks ${config.security.blocked.length} capability id(s) from ever activating.`,
        detail: config.security.blocked.join(", "),
        suggestion: "Review `security.blocked` periodically.",
        autoFixable: false,
      });
    }
  } else if (opts.scope === "registry") {
    const capabilities = await opts.storage.allCapabilities();
    for (const capability of capabilities) {
      const risk = computeRisk(capability);
      if (capability.trust === "blocked") {
        findings.push({
          id: stableId(`${capability.id}:blocked`),
          scope: "registry",
          capabilityId: capability.id,
          severity: "high",
          title: "Capability is blocked",
          description: "This registry row is explicitly blocked in the trust store.",
          detail: "trust=blocked",
          suggestion: "Remove or re-trust it via `skillrouter trust` config.",
          autoFixable: false,
        });
      }
      if (risk.level === "high" && !hasSignature(capability)) {
        findings.push({
          id: stableId(`${capability.id}:unsigned-high`),
          scope: "registry",
          capabilityId: capability.id,
          severity: "high",
          title: "High-risk capability is unsigned",
          description: "High risk + no signature means supply-chain tampering would go unnoticed.",
          detail: `risk=${risk.score}/100`,
          suggestion: "Sign the manifest (`skillrouter sign`) or pin it by hash.",
          autoFixable: false,
        });
      }
    }
  }
  return findings;
}

/** Fixes only safe, reversible findings. Returns ids of fixed findings. */
export async function fixFindings(storage: Storage, cwd: string, findings: AuditFinding[]): Promise<string[]> {
  const fixed: string[] = [];
  for (const finding of findings) {
    if (!finding.autoFixable) continue;
    if (finding.scope === "capability" && finding.detail && finding.detail.startsWith("remove:")) {
      const filePath = finding.detail.slice("remove:".length);
      if (await pathExists(filePath)) {
        const { rm } = await import("node:fs/promises");
        await rm(filePath, { force: true });
        fixed.push(finding.id);
        await audit(storage, "user", "scan", finding.capabilityId, `autofixed: removed ${filePath}`);
      }
    }
  }
  return fixed;
}

async function auditCapability(storage: Storage, capability: Capability): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const risk = computeRisk(capability);
  if (risk.level === "high" || risk.level === "critical") {
    findings.push({
      id: stableId(`${capability.id}:risk`),
      scope: "capability",
      capabilityId: capability.id,
      severity: risk.level,
      title: `Capability risk is ${risk.level.toUpperCase()}`,
      description: `Risk engine scored this capability at ${risk.score}/100.`,
      detail: `risk=${risk.score}/100`,
      suggestion: "Review its permissions before use; consider `skillrouter permissions`.",
      autoFixable: false,
    });
  }
  const row = await storage.getInstalled(capability.id);
  if (!row?.installRoot) {
    findings.push({
      id: stableId(`${capability.id}:not-installed`),
      scope: "capability",
      capabilityId: capability.id,
      severity: "low",
      title: "Not installed (manifest-only check)",
      description: "Only manifest metadata was checked; no files on disk to inspect.",
      detail: null,
      suggestion: "Install it first for a deep scan.",
      autoFixable: false,
    });
    return findings;
  }
  const files = await walkFiles(row.installRoot, { maxDepth: 8, ignore: [...EXCLUDED_DIRS] });
  for (const file of files.slice(0, 200)) {
    const content = (await readTextChunk(file)) ?? "";
    if (isSensitiveFile(file) && !shouldWarnOnFile(file)) continue;
    const matches = scanTextForSecrets(content, file);
    if (matches.length === 0) continue;
    const severest = matches.some((m) => HIGH_RISK_PATTERNS.has(m.pattern)) ? "high" : "medium";
    findings.push({
      id: stableId(`${capability.id}:${file}:secret`),
      scope: "capability",
      capabilityId: capability.id,
      severity: severest,
      title: "Hardcoded secret found in capability files",
      description: `Detected ${matches.length} possible secret(s) in ${file.replace(row.installRoot, "").slice(1)}: ${matches.map((m) => m.pattern).join(", ")}.`,
      detail: severest === "high" ? file : null,
      suggestion: "Move secrets to environment variables or a secret store.",
      autoFixable: false,
    });
  }
  return findings;
}

async function auditProjectFiles(cwd: string, root: string): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const manifestMatches: string[] = [];
  const files = await walkFiles(root, { maxDepth: 6, ignore: [...EXCLUDED_DIRS] });
  let scanned = 0;
  for (const file of files) {
    if (scanned > 400) break;
    if (file.includes(".skillrouter")) continue;
    if (!isSensitiveFile(file) && shouldWarnOnFile(file)) continue;
    scanned += 1;
    const content = (await readTextChunk(file)) ?? "";
    const matches = scanTextForSecrets(content, file);
    if (matches.length === 0) continue;
    const severest = matches.some((m) => HIGH_RISK_PATTERNS.has(m.pattern)) ? "high" : "medium";
    manifestMatches.push(`${file} (${matches.length} match(es))`);
    if (manifestMatches.length > 15) break;
    findings.push({
      id: stableId(`${file}:secret`),
      scope: "project",
      capabilityId: null,
      severity: severest,
      title: "Possible hardcoded secret",
      description: `Found in ${file.replace(root, ".").replace(/^\.[/]?/, "")}.`,
      detail: severest === "high" ? `remove:${file}` : null,
      suggestion: severest === "high" ? "Remove the secret and rotate it; never commit credentials." : "Review; low-confidence match.",
      autoFixable: severest === "high",
    });
  }
  return findings;
}

function hasSignature(capability: Capability): boolean {
  const manifest = capability as unknown as Record<string, unknown>;
  return typeof manifest["signature"] === "object" && manifest["signature"] !== null;
}

function stableId(key: string): string {
  // stable hex id from the key string
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}