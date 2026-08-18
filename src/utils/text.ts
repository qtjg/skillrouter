const ALIASES: Record<string, string[]> = {
  nextjs: ["nextjs", "next.js", "next", "next-js"],
  supabase: ["supabase"],
  stripe: ["stripe", "stripe.com"],
  nodejs: ["node", "nodejs", "node.js"],
  typescript: ["typescript", "ts"],
  javascript: ["javascript", "js"],
  react: ["react", "reactjs", "react.js"],
  postgres: ["postgres", "postgresql", "pg", "psql"],
  oauth: ["oauth", "oauth2", "oauth-2"],
  jwt: ["jwt", "jsonwebtoken", "token"],
  docker: ["docker", "container", "containers", "dockerfile", "docker-compose"],
  kubernetes: ["kubernetes", "k8s", "k8s-"],
  testing: ["testing", "tests", "test", "unit-test", "testing-library"],
  debugging: ["debugging", "debug", "bug"],
  security: ["security", "secure", "audit", "vulnerability", "vulnerabilities", "cve", "xss", "csrf"],
  authentication: ["authentication", "auth", "login", "sign-in", "sign-in", "signin", "credentials"],
  authorization: ["authorization", "rbac", "permissions", "roles", "access-control"],
  payments: ["payments", "payment", "billing", "checkout", "invoices", "invoice", "billing"],
  subscription: ["subscription", "subscriptions", "recurring", "plans"],
  deployment: ["deployment", "deploy", "release", "production", "ci/cd", "cicd", "pipeline"],
  cloud: ["cloud", "aws", "gcp", "azure", "vercel", "netlify", "render", "fly.io", "heroku"],
  database: ["database", "db", "schema", "migration", "migrations", "sql"],
  frontend: ["frontend", "front-end", "front end", "ui", "css", "html", "tailwind", "sass", "component"],
  backend: ["backend", "back-end", "back end", "api", "server", "rest"],
  api: ["api", "rest", "graphql", "endpoint", "endpoints", "http"],
  graphql: ["graphql", "gql", "apollo"],
  workflow: ["workflow", "automation", "pipeline"],
  vscode: ["vscode", "visual-studio-code"],
  python: ["python", "py", "django", "flask", "fastapi"],
  go: ["golang", "go", "go-lang"],
  rust: ["rust", "cargo"],
  jest: ["jest"],
  vitest: ["vitest", "vite"],
  playwright: ["playwright"],
  cypress: ["cypress"],
  e2e: ["e2e", "end-to-end", "end to end"],
  seo: ["seo", "search-engine"],
  accessibility: ["accessibility", "a11y", "wcag"],
  markdown: ["markdown", "md", "docs", "documentation"],
  git: ["git", "github", "gitlab", "bitbucket"],
  prisma: ["prisma"],
  drizzle: ["drizzle"],
  express: ["express", "expressjs"],
  fastify: ["fastify"],
  nextauth: ["nextauth", "next-auth", "next-auth.js"],
  redis: ["redis"],
  mongodb: ["mongodb", "mongo"],
  websocket: ["websocket", "websockets", "ws", "socket.io", "socket-io"],
  sse: ["sse", "server-sent-events", "server sent events"],
  webhook: ["webhook", "webhooks", "stripe-webhook"],
  rate_limit: ["rate-limit", "rate limiting", "rate limiting"],
  caching: ["caching", "cache", "cdntion"],
  monitoring: ["monitoring", "observability", "metrics", "tracing", "telemetry", "logs"],
  backup: ["backup", "backups", "restore"],
  migration: ["migration", "migrations", "schema-change", "schema changes"],
  refactoring: ["refactoring", "refactor", "refactor"],
  code_review: ["code-review", "code review", "review"],
  pr_review: ["pr-review", "pull-request", "pull request"],
  design: ["design", "ui-design", "ux", "ui", "figma"],
  svelte: ["svelte", "sveltekit"],
  vue: ["vue", "vuejs", "nuxt"],
  angular: ["angular", "ng"],
  tailwind: ["tailwind", "tailwindcss", "tailwind-css"],
  shadcn: ["shadcn", "shadcn-ui"],
  supabase_auth: ["supabase-auth", "supabase auth"],
  weather: ["weather"],
  slack: ["slack", "slack-api", "slack bot"],
  github_api: ["github-api", "github api", "gh"],
};

export function normalizeToken(token: string): string {
  return token.trim().toLowerCase().replace(/[^a-z0-9+#_-]/g, "").replace(/[_]/g, "-");
}

export function expandAliases(term: string): Set<string> {
  const normalized = normalizeToken(term);
  const out = new Set<string>([normalized]);
  for (const [canonical, forms] of Object.entries(ALIASES)) {
    if (forms.some((f) => normalizeToken(f) === normalized)) {
      for (const f of forms) out.add(normalizeToken(f));
      out.add(canonical);
    }
  }
  return out;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#._-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !["the", "and", "for", "with", "into", "your", "this", "that", "from"].includes(t));
}

export function normalizePhrases(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of tokenize(text)) {
    for (const alias of expandAliases(token)) out.add(alias);
  }
  const sentences = text.toLowerCase().split(/[,;.?!\n]/).filter((s) => s.trim().length > 0);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length >= 3 && trimmed.length <= 64) out.add(trimmed);
  }
  return out;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}
