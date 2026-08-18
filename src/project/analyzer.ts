import { join, basename } from "node:path";
import { readTextSafe, pathExists } from "../utils/fs.ts";

export interface ProjectAnalysis {
  root: string;
  languages: string[];
  frameworks: string[];
  packageManager: string | null;
  dependencies: string[];
  devDependencies: string[];
  databases: string[];
  cloudProviders: string[];
  testingFrameworks: string[];
  configFiles: string[];
  docker: boolean;
  isTypescript: boolean;
  isJavascript: boolean;
  signals: string[];
}

const MANAGERS = [
  { file: "pnpm-lock.yaml", name: "pnpm" },
  { file: "yarn.lock", name: "yarn" },
  { file: "package-lock.json", name: "npm" },
  { file: "bun.lockb", name: "bun" },
  { file: "bun.lock", name: "bun" },
];

function normalizeDep(name: string): string {
  const scoped = name.startsWith("@") ? name.split("/")[1] ?? name : name;
  return scoped.toLowerCase();
}

export async function analyzeProject(root: string): Promise<ProjectAnalysis> {
  const analysis: ProjectAnalysis = {
    root,
    languages: [],
    frameworks: [],
    packageManager: null,
    dependencies: [],
    devDependencies: [],
    databases: [],
    cloudProviders: [],
    testingFrameworks: [],
    configFiles: [],
    docker: false,
    isTypescript: false,
    isJavascript: false,
    signals: [],
  };

  const pkg = await readJson(join(root, "package.json"));
  if (pkg) {
    analysis.isJavascript = true;
    for (const manager of MANAGERS) {
      if (await pathExists(join(root, manager.file))) {
        analysis.packageManager = manager.name;
        break;
      }
    }
    if (!analysis.packageManager) analysis.packageManager = "npm";
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const depNames = Object.keys(deps).map(normalizeDep);
    analysis.dependencies = depNames;
    analysis.devDependencies = Object.keys(pkg.devDependencies ?? {}).map(normalizeDep);

    detectNodeSignals(analysis);
  }

  const pyproject = await readTextSafe(join(root, "pyproject.toml"));
  if (pyproject) {
    analysis.languages.push("python");
    if (/django/i.test(pyproject)) analysis.frameworks.push("django");
    if (/fastapi/i.test(pyproject)) analysis.frameworks.push("fastapi");
    if (/flask/i.test(pyproject)) analysis.frameworks.push("flask");
    analysis.signals.push("pyproject.toml");
    analysis.configFiles.push("pyproject.toml");
  }
  if (await pathExists(join(root, "requirements.txt"))) {
    analysis.languages.push("python");
    analysis.configFiles.push("requirements.txt");
  }
  if (await pathExists(join(root, "Cargo.toml"))) {
    analysis.languages.push("rust");
    analysis.configFiles.push("Cargo.toml");
  }
  if (await pathExists(join(root, "go.mod"))) {
    analysis.languages.push("go");
    analysis.signals.push("go.mod");
    analysis.configFiles.push("go.mod");
  }
  if (await pathExists(join(root, "Dockerfile"))) {
    analysis.docker = true;
    analysis.cloudProviders.push("docker");
    analysis.signals.push("Dockerfile");
  }
  if (await pathExists(join(root, "docker-compose.yml")) || await pathExists(join(root, "docker-compose.yaml"))) {
    analysis.docker = true;
    analysis.signals.push("docker-compose");
  }

  for (const file of ["tsconfig.json", "tsconfig.app.json"]) {
    if (await pathExists(join(root, file))) {
      analysis.isTypescript = true;
      analysis.languages.push("typescript");
      analysis.configFiles.push(file);
      break;
    }
  }

  const configCandidates = [
    "next.config.js",
    "next.config.ts",
    "next.config.mjs",
    "vite.config.ts",
    "vite.config.js",
    "nuxt.config.ts",
    "svelte.config.js",
    "vitest.config.ts",
    "jest.config.js",
    "jest.config.ts",
    "playwright.config.ts",
    "cypress.config.ts",
    "eslint.config.js",
    "eslint.config.mjs",
    ".eslintrc.json",
    "prisma",
    "drizzle.config.ts",
    "supabase",
    ".github",
    ".env",
    ".env.example",
    "turbo.json",
    "nx.json",
  ];
  for (const candidate of configCandidates) {
    if (await pathExists(join(root, candidate))) analysis.configFiles.push(candidate);
  }

  detectFrameworksFromFiles(analysis, root);

  dedupe(analysis);
  return analysis;
}

function detectNodeSignals(analysis: ProjectAnalysis): void {
  const deps = analysis.dependencies;
  const includes = (...names: string[]) => names.some((n) => deps.includes(n));

  if (includes("next", "next.js")) {
    analysis.frameworks.push("nextjs");
    analysis.languages.push("typescript");
  }
  if (includes("react", "react-dom", "react-native")) analysis.frameworks.push("react");
  if (includes("vue", "nuxt", "nuxt3")) analysis.frameworks.push("vue");
  if (includes("svelte", "sveltekit", "@sveltejs/kit")) analysis.frameworks.push("svelte");
  if (includes("express")) analysis.frameworks.push("express");
  if (includes("fastify")) analysis.frameworks.push("fastify");
  if (includes("@nestjs/core")) analysis.frameworks.push("nestjs");
  if (includes("@supabase/supabase-js")) {
    analysis.frameworks.push("supabase");
    analysis.databases.push("postgresql");
    analysis.cloudProviders.push("supabase");
  }
  if (includes("stripe", "@stripe/stripe-js", "stripe-react")) analysis.frameworks.push("stripe");
  if (includes("prisma", "@prisma/client")) analysis.databases.push("prisma");
  if (includes("drizzle-orm")) analysis.databases.push("drizzle");
  if (includes("pg", "postgres", "postgresql", "@postgres")) analysis.databases.push("postgresql");
  if (includes("mysql2", "mysql")) analysis.databases.push("mysql");
  if (includes("mongodb", "mongoose")) analysis.databases.push("mongodb");
  if (includes("redis", "ioredis")) analysis.databases.push("redis");
  if (includes("vitest", "vite")) analysis.testingFrameworks.push("vitest");
  if (includes("jest")) analysis.testingFrameworks.push("jest");
  if (includes("@playwright/test", "playwright")) analysis.testingFrameworks.push("playwright");
  if (includes("cypress")) analysis.testingFrameworks.push("cypress");
  if (includes("next-auth", "@auth/core", "@auth/nextjs", "@supabase/ssr")) analysis.frameworks.push("nextauth");
  if (includes("graphql", "@apollo/client", "apollo-server")) analysis.frameworks.push("graphql");
  if (includes("tailwindcss")) analysis.frameworks.push("tailwind");
  if (includes("aws-sdk", "@aws-sdk/client-s3", "@aws-sdk/client-lambda")) analysis.cloudProviders.push("aws");
  if (includes("@google-cloud/storage", "firebase", "firebase-admin")) analysis.cloudProviders.push("gcp");
  if (includes("azure", "@azure/identity")) analysis.cloudProviders.push("azure");
  if (includes("vercel", "@vercel/node")) analysis.cloudProviders.push("vercel");
  if (includes("typescript")) analysis.languages.push("typescript");
  if (includes("@opencode-ai/opencode")) analysis.frameworks.push("opencode");
}

function detectFrameworksFromFiles(analysis: ProjectAnalysis, root: string): void {
  const files = new Set(analysis.configFiles.map((f) => basename(f)));
  if (files.has("next.config.js") || files.has("next.config.ts") || files.has("next.config.mjs")) {
    analysis.frameworks.push("nextjs");
    analysis.isJavascript = true;
  }
  if (files.has("vite.config.ts") || files.has("vite.config.js")) analysis.frameworks.push("vite");
  if (files.has("vitest.config.ts") || files.has("vitest.config.js")) analysis.testingFrameworks.push("vitest");
  if (files.has("jest.config.js") || files.has("jest.config.ts")) analysis.testingFrameworks.push("jest");
  if (files.has("playwright.config.ts") || files.has("playwright.config.js")) analysis.testingFrameworks.push("playwright");
  if (files.has("cypress.config.ts") || files.has("cypress.config.js")) analysis.testingFrameworks.push("cypress");
  if (files.has("prisma") || files.has("prisma/schema.prisma")) analysis.databases.push("prisma");
  if (files.has("drizzle.config.ts") || files.has("drizzle.config.js")) analysis.databases.push("drizzle");
  if (files.has("supabase") || files.has("supabase/config.toml")) analysis.cloudProviders.push("supabase");
  if (files.has("tailwind.config.js") || files.has("tailwind.config.ts")) analysis.frameworks.push("tailwind");
  if (analysis.docker) analysis.cloudProviders.push("docker");
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  const content = await readTextSafe(path);
  if (content === null) return null;
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function dedupe(analysis: ProjectAnalysis): void {
  const dedupeArray = (arr: string[]) => [...new Set(arr)].sort();
  analysis.languages = dedupeArray(analysis.languages);
  analysis.frameworks = dedupeArray(analysis.frameworks);
  analysis.dependencies = dedupeArray(analysis.dependencies);
  analysis.devDependencies = dedupeArray(analysis.devDependencies);
  analysis.databases = dedupeArray(analysis.databases);
  analysis.cloudProviders = dedupeArray(analysis.cloudProviders);
  analysis.testingFrameworks = dedupeArray(analysis.testingFrameworks);
  analysis.configFiles = dedupeArray(analysis.configFiles);
  analysis.signals = dedupeArray(analysis.signals);

  if (!analysis.isJavascript && !analysis.languages.includes("typescript") && !analysis.isTypescript) {
    if (analysis.configFiles.length > 0 || analysis.docker || analysis.languages.length > 0) {
      // project detected via config files
    }
  }
}