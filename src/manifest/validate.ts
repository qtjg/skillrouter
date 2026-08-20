import { parse } from "yaml";
import type { Capability, CapabilityRequirements, CapabilityType, Compatibility, Dependency, PermissionSet, RiskLevel, TrustLevel } from "../core/types.ts";
import { CAPABILITY_TYPES, RISK_LEVELS } from "../core/types.ts";
import { ManifestError } from "../utils/errors.ts";
import { isValidCapabilityId } from "../core/ids.ts";
import { isValidSemVer } from "../utils/version.ts";

export const SUPPORTED_SCHEMAS = ["skillrouter/v1"];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ManifestDoc = Record<string, JsonValue>;

export function parseManifestYaml(content: string, path: string): ManifestDoc {
  let raw: unknown;
  try {
    raw = parse(content);
  } catch (err) {
    throw new ManifestError(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`, { path });
  }
  if (raw === null || raw === undefined) {
    throw new ManifestError("Manifest is empty", { path });
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ManifestError("Manifest root must be a YAML mapping (object)", { path });
  }
  return raw as ManifestDoc;
}

interface Problem {
  path: string;
  message: string;
}

function stringList(value: unknown, path: string, problems: Problem[]): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value;
  problems.push({ path, message: "must be a string or an array of strings" });
  return [];
}

function bool(value: unknown, path: string, problems: Problem[], defaultValue = false): boolean {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;
  problems.push({ path, message: "must be a boolean" });
  return defaultValue;
}

function string(value: unknown, path: string, problems: Problem[]): string {
  if (typeof value === "string") return value;
  problems.push({ path, message: "must be a string" });
  return "";
}

function number(value: unknown, path: string, problems: Problem[]): number;
function number(value: unknown, path: string, problems: Problem[], defaultValue: number): number;
function number(value: unknown, path: string, problems: Problem[], defaultValue?: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (defaultValue !== undefined) {
    problems.push({ path, message: "must be a finite number" });
    return defaultValue;
  }
  problems.push({ path, message: "must be a finite number" });
  return 0;
}

export interface ValidationResult {
  problems: Problem[];
  errors: Problem[];
  warnings: Problem[];
}

export function validateManifest(doc: ManifestDoc): ValidationResult {
  const problems: Problem[] = [];
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const push = (p: Problem) => problems.push(p);

  const schema = string(doc["schema"], "schema", problems);
  if (schema && !SUPPORTED_SCHEMAS.includes(schema)) {
    push({ path: "schema", message: `unsupported schema "${schema}" (supported: ${SUPPORTED_SCHEMAS.join(", ")})` });
  } else if (!schema) {
    push({ path: "schema", message: 'missing required field "schema"' });
  }

  const id = string(doc["id"], "id", problems);
  if (!id || !isValidCapabilityId(id)) push({ path: "id", message: `invalid capability id "${id}"` });

  const name = string(doc["name"], "name", problems);
  if (!name) push({ path: "name", message: 'missing required field "name"' });

  const version = string(doc["version"], "version", problems);
  if (!version || !isValidSemVer(version)) push({ path: "version", message: `invalid semver version "${version}"` });

  const description = string(doc["description"], "description", problems);
  if (!description) push({ path: "description", message: 'missing required field "description"' });

  const type = string(doc["type"], "type", problems).toLowerCase();
  if (!CAPABILITY_TYPES.includes(type as CapabilityType)) {
    push({ path: "type", message: `invalid type "${type}" (supported: ${CAPABILITY_TYPES.join(", ")})` });
  }

  const capabilities = stringList(doc["capabilities"], "capabilities", problems);
  const triggers = doc["triggers"];
  if (triggers !== undefined && (typeof triggers !== "object" || Array.isArray(triggers))) {
    push({ path: "triggers", message: "must be a mapping (keywords, intents, technologies, filePatterns, gitPatterns)" });
  } else if (triggers !== undefined) {
    const t = triggers as Record<string, unknown>;
    stringList(t["keywords"], "triggers.keywords", problems);
    stringList(t["intents"], "triggers.intents", problems);
    stringList(t["technologies"], "triggers.technologies", problems);
    stringList(t["filePatterns"], "triggers.filePatterns", problems);
    stringList(t["gitPatterns"], "triggers.gitPatterns", problems);
  }

  const compatibility = doc["compatibility"];
  if (compatibility !== undefined) {
    if (typeof compatibility !== "object" || Array.isArray(compatibility)) {
      push({ path: "compatibility", message: "must be a mapping of agent → native|compatible|adaptable|unsupported" });
    } else {
      for (const [agent, value] of Object.entries(compatibility as Record<string, unknown>)) {
        const v = typeof value === "string" ? value : "";
        const allowed = ["native", "compatible", "adaptable", "unsupported"];
        if (!allowed.includes(v)) {
          push({ path: `compatibility.${agent}`, message: `must be one of ${allowed.join(", ")}` });
        }
      }
    }
  }

  const rawDeps = doc["dependencies"];
  if (rawDeps !== undefined) {
    if (!Array.isArray(rawDeps)) {
      push({ path: "dependencies", message: "must be an array of strings or { id, version?, optional? } objects" });
    } else {
      for (const dep of rawDeps) {
        if (typeof dep === "string") continue;
        if (dep && typeof dep === "object" && !Array.isArray(dep)) {
          const d = dep as Record<string, unknown>;
          if (typeof d["id"] !== "string" || !isValidCapabilityId(d["id"] as string)) {
            push({ path: "dependencies", message: `dependency entry has invalid id` });
          }
          if (d["version"] !== undefined && typeof d["version"] !== "string") push({ path: "dependencies", message: "dependency version must be a string" });
        } else {
          push({ path: "dependencies", message: "dependency entry must be a string or an object" });
        }
      }
    }
  }

  const rawConflicts = doc["conflicts"];
  if (rawConflicts !== undefined && !Array.isArray(rawConflicts)) {
    push({ path: "conflicts", message: "must be an array of capability ids" });
  }

  for (const key of ["enhances", "replaces", "compatibleWith", "fallbacks", "notFor"]) {
    const raw = doc[key];
    if (raw !== undefined && !Array.isArray(raw)) {
      push({ path: key, message: "must be an array of strings" });
    }
  }

  const permissions = validatePermissions(doc["permissions"], problems);

  const risk = doc["risk"];
  if (risk !== undefined) {
    if (typeof risk !== "object" || Array.isArray(risk)) {
      push({ path: "risk", message: "must be a mapping" });
    } else {
      const r = risk as Record<string, unknown>;
      if (r["level"] !== undefined && !RISK_LEVELS.includes(String(r["level"]).toLowerCase() as RiskLevel)) {
        push({ path: "risk.level", message: `must be one of ${RISK_LEVELS.join(", ")}` });
      }
      if (r["score"] !== undefined && typeof r["score"] !== "number") {
        push({ path: "risk.score", message: "must be a number" });
      }
    }
  }

  const context = doc["context"];
  if (context !== undefined && typeof context !== "object" || (context !== undefined && Array.isArray(context))) {
    push({ path: "context", message: "must be a mapping (estimatedTokens, activationLevel, resources)" });
  }

  const metadata = doc["metadata"];
  if (metadata !== undefined) {
    if (typeof metadata !== "object" || Array.isArray(metadata)) {
      push({ path: "metadata", message: "must be a mapping" });
    } else {
      const m = metadata as Record<string, unknown>;
      stringList(m["categories"], "metadata.categories", problems);
      stringList(m["tags"], "metadata.tags", problems);
      for (const [key, label] of [["quality", "0–100"], ["popularity", "0–100"], ["successRate", "0–100"], ["cost", "1–5"], ["latency", "1–5"], ["reliability", "0–1"]] as const) {
        if (m[key] !== undefined && typeof m[key] !== "number") {
          push({ path: `metadata.${key}`, message: `must be a number (${label})` });
        }
      }
    }
  }
  for (const key of ["cost", "latency", "reliability"] as const) {
    if (doc[key] !== undefined && typeof doc[key] !== "number") {
      push({ path: key, message: "must be a number" });
    }
  }

  stringList(doc["resources"], "resources", problems);

  const trust = string(doc["trust"], "trust", problems);
  if (trust && !["verified", "trusted", "community", "unknown", "blocked"].includes(trust)) {
    push({ path: "trust", message: `invalid trust level "${trust}"` });
  }

  if (!capabilities.length && !triggers) {
    warnings.push({ path: "capabilities", message: "no capabilities or triggers declared; the capability will only match by description" });
  }

  const BLOCKING_PATHS = new Set(["schema", "id", "version", "description", "type", "name"]);
  for (const p of problems) {
    if (BLOCKING_PATHS.has(p.path)) errors.push(p);
  }
  return { problems, errors, warnings };
}

function validatePermissions(raw: unknown, problems: Problem[]): void {
  if (raw === undefined || raw === null) return;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    problems.push({ path: "permissions", message: "must be a mapping" });
    return;
  }
  const p = raw as Record<string, unknown>;
  if (p["filesystem"] !== undefined) {
    const fs = p["filesystem"] as Record<string, unknown>;
    if (typeof fs !== "object" || Array.isArray(fs)) {
      problems.push({ path: "permissions.filesystem", message: "must be a mapping" });
    } else {
      bool(fs["read"], "permissions.filesystem.read", problems);
      bool(fs["write"], "permissions.filesystem.write", problems);
      if (fs["paths"] !== undefined) stringList(fs["paths"], "permissions.filesystem.paths", problems);
    }
  }
  if (p["network"] !== undefined) {
    const n = p["network"] as Record<string, unknown>;
    if (typeof n !== "object" || Array.isArray(n)) {
      problems.push({ path: "permissions.network", message: "must be a mapping" });
    } else {
      const allowed = stringList(n["allowed"], "permissions.network.allowed", problems);
      stringList(n["deny"], "permissions.network.deny", problems);
      if (allowed.includes("*") && allowed.length > 1) {
        problems.push({ path: "permissions.network.allowed", message: 'unrestricted network ("*") should not be combined with other entries' });
      }
      if (allowed.includes("*") && !n["explicit"]) {
        problems.push({ path: "permissions.network.allowed", message: 'unrestricted network ("*") requires the capability to be flagged "explicit" or to be reviewed by the user' });
      }
    }
  }
  if (p["shell"] !== undefined) {
    const s = p["shell"] as Record<string, unknown>;
    if (typeof s !== "object" || Array.isArray(s)) {
      problems.push({ path: "permissions.shell", message: "must be a mapping" });
    } else {
      if (s["enabled"] === true) {
        stringList(s["allow"], "permissions.shell.allow", problems);
        stringList(s["deny"], "permissions.shell.deny", problems);
      }
    }
  }
  if (p["environment"] !== undefined && typeof p["environment"] === "object" && !Array.isArray(p["environment"])) {
    const e = p["environment"] as Record<string, unknown>;
    bool(e["read"], "permissions.environment.read", problems);
    stringList(e["variables"], "permissions.environment.variables", problems);
  }
  if (p["credentials"] !== undefined) {
    const c = p["credentials"] as Record<string, unknown>;
    if (typeof c !== "object" || Array.isArray(c)) {
      problems.push({ path: "permissions.credentials", message: "must be a mapping" });
    } else {
      const access = string(c["access"], "permissions.credentials.access", problems);
      if (access && !["none", "explicit", "requested"].includes(access)) {
        problems.push({ path: "permissions.credentials.access", message: 'must be one of "none", "explicit", "requested"' });
      }
      if (c["allowed"] !== undefined) stringList(c["allowed"], "permissions.credentials.allowed", problems);
    }
  }
  if (p["hooks"] !== undefined) {
    const h = p["hooks"] as Record<string, unknown>;
    if (typeof h !== "object" || Array.isArray(h)) {
      problems.push({ path: "permissions.hooks", message: "must be a mapping" });
    } else {
      bool(h["enabled"], "permissions.hooks.enabled", problems);
      if (h["events"] !== undefined) stringList(h["events"], "permissions.hooks.events", problems);
    }
  }
  if (p["mcp"] !== undefined) {
    const m = p["mcp"] as Record<string, unknown>;
    if (typeof m !== "object" || Array.isArray(m)) {
      problems.push({ path: "permissions.mcp", message: "must be a mapping" });
    } else if (m["servers"] !== undefined) {
      stringList(m["servers"], "permissions.mcp.servers", problems);
    }
  }
  if (p["processes"] !== undefined) {
    const pr = p["processes"] as Record<string, unknown>;
    if (typeof pr !== "object" || Array.isArray(pr)) {
      problems.push({ path: "permissions.processes", message: "must be a mapping" });
    } else {
      bool(pr["enabled"], "permissions.processes.enabled", problems);
      if (pr["allow"] !== undefined) stringList(pr["allow"], "permissions.processes.allow", problems);
    }
  }
}

export interface NormalizedDependencies {
  dependencies: Dependency[];
}

export function normalizeManifest(doc: ManifestDoc, manifestPath: string): Capability {
  const problems: Problem[] = [];
  const id = string(doc["id"], "id", problems);
  const version = string(doc["version"], "version", problems);
  const type = (string(doc["type"], "type", problems) || "skill").toLowerCase() as CapabilityType;

  const triggersRaw = doc["triggers"] as Record<string, unknown> | undefined;
  const rawDeps: unknown[] = Array.isArray(doc["dependencies"]) ? (doc["dependencies"] as unknown[]) : [];
  const dependencies: Dependency[] = [];
  for (const dep of rawDeps) {
    if (typeof dep === "string") {
      dependencies.push({ id: dep });
    } else if (dep && typeof dep === "object") {
      const d = dep as Record<string, unknown>;
      dependencies.push({
        id: String(d["id"] ?? ""),
        version: d["version"] !== undefined ? String(d["version"]) : undefined,
        optional: d["optional"] === true,
      });
    }
  }

  let compatibility: Capability["compatibility"] = {};
  const compRaw = doc["compatibility"];
  if (compRaw && typeof compRaw === "object" && !Array.isArray(compRaw)) {
    compatibility = Object.fromEntries(
      Object.entries(compRaw as Record<string, unknown>).map(([agent, value]) => [agent, String(value) as Compatibility]),
    );
  }

  const riskRaw = doc["risk"] as Record<string, unknown> | undefined;
  const contextRaw = doc["context"] as Record<string, unknown> | undefined;
  const metadataRaw = doc["metadata"] as Record<string, unknown> | undefined;
  // PRD §9 exposes cost/latency/reliability at the capability root; accept both
  // locations, with `metadata` winning.
  const metaNum = (key: string): number | undefined => {
    const v = metadataRaw?.[key];
    if (typeof v === "number") return v;
    return typeof doc[key] === "number" ? (doc[key] as number) : undefined;
  };

  const permissions = normalizePermissions(doc["permissions"]);

  const trust = (string(doc["trust"], "trust", problems) as TrustLevel) || "unknown";
  const declaredRisk = riskRaw && typeof riskRaw["level"] === "string" ? (riskRaw["level"].toLowerCase() as RiskLevel) : undefined;

  return {
    id,
    name: string(doc["name"], "name", problems) || id,
    version,
    description: string(doc["description"], "description", problems),
    type,
    schema: string(doc["schema"], "schema", problems) || "skillrouter/v1",
    capabilities: stringList(doc["capabilities"], "capabilities", problems),
    triggers: triggersRaw
      ? {
          keywords: stringList(triggersRaw["keywords"], "triggers.keywords", problems),
          intents: stringList(triggersRaw["intents"], "triggers.intents", problems),
          technologies: stringList(triggersRaw["technologies"], "triggers.technologies", problems),
          filePatterns: stringList(triggersRaw["filePatterns"], "triggers.filePatterns", problems),
          gitPatterns: stringList(triggersRaw["gitPatterns"], "triggers.gitPatterns", problems),
        }
      : undefined,
    compatibility,
    dependencies: dependencies.length > 0 ? dependencies : undefined,
    conflicts: Array.isArray(doc["conflicts"]) ? (doc["conflicts"] as unknown[]).map(String) : undefined,
    enhances: Array.isArray(doc["enhances"]) ? (doc["enhances"] as unknown[]).map(String) : undefined,
    replaces: Array.isArray(doc["replaces"]) ? (doc["replaces"] as unknown[]).map(String) : undefined,
    compatibleWith: Array.isArray(doc["compatibleWith"]) ? (doc["compatibleWith"] as unknown[]).map(String) : undefined,
    fallbacks: Array.isArray(doc["fallbacks"]) ? (doc["fallbacks"] as unknown[]).map(String) : undefined,
    notFor: Array.isArray(doc["notFor"]) ? (doc["notFor"] as unknown[]).map(String) : undefined,
    requirements: normalizeRequirements(doc["requirements"], problems),
    permissions,
    risk: declaredRisk ? { declared: declaredRisk } : undefined,
    context: contextRaw
      ? {
          estimatedTokens: typeof contextRaw["estimatedTokens"] === "number" ? contextRaw["estimatedTokens"] : undefined,
          activationLevel: typeof contextRaw["activationLevel"] === "number" ? (contextRaw["activationLevel"] as 0 | 1 | 2 | 3 | 4 | 5) : undefined,
          resources: Array.isArray(contextRaw["resources"]) ? (contextRaw["resources"] as unknown[]).map(String) : undefined,
        }
      : undefined,
    trust,
    metadata: metadataRaw
      ? {
          categories: Array.isArray(metadataRaw["categories"]) ? (metadataRaw["categories"] as unknown[]).map(String) : undefined,
          tags: Array.isArray(metadataRaw["tags"]) ? (metadataRaw["tags"] as unknown[]).map(String) : undefined,
          license: typeof metadataRaw["license"] === "string" ? metadataRaw["license"] : undefined,
          author: typeof metadataRaw["author"] === "string" ? metadataRaw["author"] : undefined,
          repository: typeof metadataRaw["repository"] === "string" ? metadataRaw["repository"] : undefined,
          homepage: typeof metadataRaw["homepage"] === "string" ? metadataRaw["homepage"] : undefined,
          quality: typeof metadataRaw["quality"] === "number" ? metadataRaw["quality"] : undefined,
          popularity: typeof metadataRaw["popularity"] === "number" ? metadataRaw["popularity"] : undefined,
          successRate: typeof metadataRaw["successRate"] === "number" ? metadataRaw["successRate"] : undefined,
          cost: metaNum("cost"),
          latency: metaNum("latency"),
          latencyMs: metaNum("latencyMs"),
          reliability: metaNum("reliability"),
          gitWrites: typeof metadataRaw?.["gitWrites"] === "boolean" ? metadataRaw["gitWrites"] : typeof doc["gitWrites"] === "boolean" ? doc["gitWrites"] : undefined,
        }
      : undefined,
    resources: stringList(doc["resources"], "resources", problems),
    manifestPath,
  };
}

function normalizeRequirements(raw: unknown, problems: Problem[]): CapabilityRequirements | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    problems.push({ path: "requirements", message: "must be a mapping (language, framework, runtime, network)" });
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  return {
    language: stringList(r["language"], "requirements.language", problems),
    framework: stringList(r["framework"], "requirements.framework", problems),
    runtime: stringList(r["runtime"], "requirements.runtime", problems),
    network: typeof r["network"] === "boolean" ? r["network"] : undefined,
  };
}

function normalizePermissions(raw: unknown): PermissionSet | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const p = raw as Record<string, unknown>;
  const out: PermissionSet = {};
  const fs = p["filesystem"];
  if (fs && typeof fs === "object" && !Array.isArray(fs)) {
    out.filesystem = {
      read: (fs as Record<string, unknown>)["read"] === true,
      write: (fs as Record<string, unknown>)["write"] === true,
      paths: Array.isArray((fs as Record<string, unknown>)["paths"]) ? ((fs as Record<string, unknown>)["paths"] as unknown[]).map(String) : undefined,
    };
  }
  const net = p["network"];
  if (net && typeof net === "object" && !Array.isArray(net)) {
    out.network = {
      allowed: Array.isArray((net as Record<string, unknown>)["allowed"]) ? ((net as Record<string, unknown>)["allowed"] as unknown[]).map(String) : [],
      deny: Array.isArray((net as Record<string, unknown>)["deny"]) ? ((net as Record<string, unknown>)["deny"] as unknown[]).map(String) : undefined,
    };
  }
  const shell = p["shell"];
  if (shell && typeof shell === "object" && !Array.isArray(shell)) {
    out.shell = {
      enabled: (shell as Record<string, unknown>)["enabled"] === true,
      allow: Array.isArray((shell as Record<string, unknown>)["allow"]) ? ((shell as Record<string, unknown>)["allow"] as unknown[]).map(String) : undefined,
      deny: Array.isArray((shell as Record<string, unknown>)["deny"]) ? ((shell as Record<string, unknown>)["deny"] as unknown[]).map(String) : undefined,
    };
  }
  const env = p["environment"];
  if (env && typeof env === "object" && !Array.isArray(env)) {
    out.environment = {
      read: (env as Record<string, unknown>)["read"] === true,
      variables: Array.isArray((env as Record<string, unknown>)["variables"]) ? ((env as Record<string, unknown>)["variables"] as unknown[]).map(String) : undefined,
    };
  }
  const cred = p["credentials"];
  if (cred && typeof cred === "object" && !Array.isArray(cred)) {
    const access = String((cred as Record<string, unknown>)["access"] ?? "none");
    out.credentials = {
      access: access === "explicit" || access === "requested" ? access : "none",
      allowed: Array.isArray((cred as Record<string, unknown>)["allowed"]) ? ((cred as Record<string, unknown>)["allowed"] as unknown[]).map(String) : undefined,
    };
  }
  const hooks = p["hooks"];
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    out.hooks = {
      enabled: (hooks as Record<string, unknown>)["enabled"] === true,
      events: Array.isArray((hooks as Record<string, unknown>)["events"]) ? ((hooks as Record<string, unknown>)["events"] as unknown[]).map(String) : undefined,
    };
  }
  const mcp = p["mcp"];
  if (mcp && typeof mcp === "object" && !Array.isArray(mcp)) {
    out.mcp = {
      servers: Array.isArray((mcp as Record<string, unknown>)["servers"]) ? ((mcp as Record<string, unknown>)["servers"] as unknown[]).map(String) : undefined,
    };
  }
  const proc = p["processes"];
  if (proc && typeof proc === "object" && !Array.isArray(proc)) {
    out.processes = {
      enabled: (proc as Record<string, unknown>)["enabled"] === true,
      allow: Array.isArray((proc as Record<string, unknown>)["allow"]) ? ((proc as Record<string, unknown>)["allow"] as unknown[]).map(String) : undefined,
    };
  }
  if (Object.keys(out).length === 0) return undefined;
  return out;
}

export function formatProblems(problems: Problem[]): string[] {
  return problems.map((p) => (p.path ? `${p.path}: ${p.message}` : p.message));
}