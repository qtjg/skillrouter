import type { TaskAnalysis, Operation } from "./types.ts";
import type { RiskLevel } from "../core/types.ts";
import { normalizePhrases, tokenize, expandAliases } from "../utils/text.ts";

const DOMAIN_TABLE: Array<{ domains: string[]; tokens: string[] }> = [
  { domains: ["web-development"], tokens: ["web", "frontend", "backend", "nextjs", "react", "vue", "svelte", "api", "html", "css", "browser", "saas", "dashboard"] },
  { domains: ["authentication"], tokens: ["auth", "authentication", "login", "oauth", "jwt", "session", "sso", "sign-in", "signin", "credentials", "password"] },
  { domains: ["payments"], tokens: ["payment", "payments", "stripe", "checkout", "billing", "invoice", "subscription", "recurring", "refund"] },
  { domains: ["database"], tokens: ["database", "db", "sql", "postgres", "postgresql", "mysql", "mongo", "redis", "schema", "migration", "prisma", "drizzle", "query"] },
  { domains: ["devops"], tokens: ["docker", "deploy", "deployment", "kubernetes", "k8s", "ci", "cd", "pipeline", "infrastructure", "terraform", "cloud"] },
  { domains: ["security"], tokens: ["security", "audit", "vulnerability", "xss", "csrf", "injection", "cve", "sanitize", "encryption", "secure"] },
  { domains: ["testing"], tokens: ["test", "testing", "tests", "unit", "integration-test", "e2e", "playwright", "cypress", "vitest", "jest", "coverage"] },
  { domains: ["frontend"], tokens: ["ui", "frontend", "component", "design", "layout", "css", "tailwind", "responsive", "accessibility"] },
  { domains: ["backend"], tokens: ["backend", "server", "api", "rest", "graphql", "endpoint", "middleware", "service"] },
  { domains: ["documentation"], tokens: ["documentation", "docs", "readme", "comment", "manual"] },
  { domains: ["data"], tokens: ["pipeline", "etl", "analytics", "data", "dataset", "streaming"] },
  { domains: ["ai"], tokens: ["ai", "llm", "model", "prompt", "agent", "rag", "embedding", "openai", "anthropic", "gemini"] },
];

const OPERATION_TABLE: Array<{ operation: Operation; tokens: string[] }> = [
  { operation: "implementation", tokens: ["build", "create", "implement", "add", "write", "make", "develop", "integrate", "construct", "set-up", "setup"] },
  { operation: "configuration", tokens: ["configure", "config", "setup", "setting", "environment", "enable", "disable"] },
  { operation: "testing", tokens: ["test", "testing", "spec", "coverage", "assert", "e2e", "unit"] },
  { operation: "debugging", tokens: ["debug", "bug", "fix", "error", "crash", "issue", "failing", "broken", "trace", "stack-trace", "segfault"] },
  { operation: "refactoring", tokens: ["refactor", "clean", "restructure", "optimize", "rename", "extract", "simplify", "rewrite", "modernize"] },
  { operation: "security-review", tokens: ["audit", "security", "review-security", "vulnerability", "harden", "penetration"] },
  { operation: "deployment", tokens: ["deploy", "release", "ship", "publish", "production", "rollout", "launch"] },
  { operation: "design", tokens: ["design", "ui", "mockup", "prototype", "wireframe", "styling"] },
  { operation: "documentation", tokens: ["document", "documentation", "readme", "writeup", "explain"] },
  { operation: "review", tokens: ["review", "check", "inspect", "verify", "validate", "approve"] },
  { operation: "migration", tokens: ["migrate", "migration", "upgrade", "downgrade", "port", "convert"] },
];

const TECHNOLOGY_ALIASES: Record<string, string[]> = {
  nextjs: ["next", "next.js", "nextjs"],
  react: ["react", "reactjs"],
  supabase: ["supabase"],
  stripe: ["stripe"],
  "next-auth": ["nextauth", "next-auth", "authjs"],
  typescript: ["typescript", "ts"],
  javascript: ["javascript", "js"],
  postgresql: ["postgres", "postgresql", "pg", "psql"],
  docker: ["docker", "dockerfile", "container"],
  prisma: ["prisma"],
  drizzle: ["drizzle"],
  tailwind: ["tailwind", "tailwindcss"],
  vitest: ["vitest"],
  jest: ["jest"],
  playwright: ["playwright"],
  cypress: ["cypress"],
  oauth: ["oauth", "oauth2"],
  jwt: ["jwt", "jsonwebtoken"],
  graphql: ["graphql", "gql", "apollo"],
  express: ["express", "expressjs"],
  nestjs: ["nest", "nestjs"],
  vercel: ["vercel"],
  aws: ["aws", "amazon-web-services", "s3", "lambda", "ec2"],
  gcp: ["gcp", "google-cloud"],
  kubernetes: ["kubernetes", "k8s"],
  terraform: ["terraform"],
  git: ["git", "github", "gitlab"],
  nextauth: [],
  mongodb: ["mongodb", "mongo"],
  redis: ["redis", "ioredis"],
  python: ["python", "django", "fastapi", "flask", "pip"],
  svelte: ["svelte", "sveltekit"],
  vue: ["vue", "vuejs", "nuxt", "nuxtjs"],
  websocket: ["websocket", "ws", "socket", "socket.io"],
  webhook: ["webhook", "webhooks"],
  api: ["api", "rest", "endpoint", "graphql"],
  "ci-cd": ["ci", "cd", "pipeline", "github-actions"],
};

export function isTechnologyToken(token: string): boolean {
  for (const forms of Object.values(TECHNOLOGY_ALIASES)) {
    if (forms.includes(token)) return true;
  }
  return false;
}

export function canonicalTechnology(token: string): string | null {
  for (const [canonical, forms] of Object.entries(TECHNOLOGY_ALIASES)) {
    if (token === canonical || forms.includes(token)) return canonical;
  }
  return null;
}

export function analyzeTask(task: string): TaskAnalysis {
  const normalizedTokens = [...normalizePhrases(task)];
  const tokens = tokenize(task);
  const aliases = new Set<string>();
  for (const token of tokens) {
    for (const alias of expandAliases(token)) aliases.add(alias);
  }

  const technologies = new Set<string>();
  for (const token of normalizedTokens) {
    const canonical = canonicalTechnology(token);
    if (canonical) technologies.add(canonical);
  }

  const domains = new Set<string>();
  for (const { domains: ds, tokens: dt } of DOMAIN_TABLE) {
    if (dt.some((t) => aliases.has(t) || normalizedTokens.includes(t))) {
      for (const d of ds) domains.add(d);
    }
  }
  if (technologies.has("nextjs") || technologies.has("react") || technologies.has("svelte") || technologies.has("vue")) {
    domains.add("web-development");
    domains.add("frontend");
  }
  if (technologies.has("postgresql") || technologies.has("supabase") || technologies.has("prisma") || technologies.has("drizzle")) {
    domains.add("database");
  }
  if (technologies.has("stripe")) domains.add("payments");
  if (technologies.has("oauth") || technologies.has("jwt") || technologies.has("nextauth")) domains.add("authentication");
  if (technologies.has("docker") || technologies.has("kubernetes") || technologies.has("vercel") || technologies.has("aws") || technologies.has("gcp")) {
    domains.add("devops");
  }

  const operations = new Set<Operation>();
  for (const { operation, tokens: ot } of OPERATION_TABLE) {
    if (ot.some((t) => aliases.has(t) || normalizedTokens.includes(t))) operations.add(operation);
  }
  if (operations.size === 0) operations.add("implementation");

  let riskEstimate: RiskLevel = "low";
  const riskTerms = ["security", "audit", "auth", "credential", "payment", "production", "deploy", "money", "billing"];
  if (riskTerms.some((t) => aliases.has(t) || normalizedTokens.includes(t))) riskEstimate = "medium";
  if (operations.has("security-review") || domains.has("security") || ["stripe", "payment", "billing", "production"].some((t) => aliases.has(t))) {
    riskEstimate = "high";
  }

  return {
    task,
    normalized: { tokens: new Set(normalizedTokens), phrases: new Set(normalizedTokens) },
    tokens,
    technologies: [...technologies],
    domains: [...domains],
    operations: [...operations],
    riskEstimate,
  };
}

export function describeAnalysis(analysis: TaskAnalysis): string[] {
  const parts: string[] = [];
  if (analysis.domains.length > 0) parts.push(`domains: ${analysis.domains.join(", ")}`);
  if (analysis.technologies.length > 0) parts.push(`technologies: ${analysis.technologies.join(", ")}`);
  if (analysis.operations.length > 0) parts.push(`operations: ${analysis.operations.join(", ")}`);
  parts.push(`risk: ${analysis.riskEstimate}`);
  return parts;
}