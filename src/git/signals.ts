import { matchesGlob } from "../utils/glob.ts";
import { normalizePhrases } from "../utils/text.ts";

/**
 * Git signal inference: maps changed/staged file paths to coarse task signals
 * (authentication, security, database, testing, …) used by the router to
 * adjust capability relevance. Pure function of file paths — no git calls.
 */

export const GIT_SIGNAL_PATTERNS: Array<{ signals: string[]; patterns: string[] }> = [
  { signals: ["authentication"], patterns: ["**/auth/**", "**/login/**", "**/middleware*", "**/*oauth*", "**/*session*", "**/*jwt*", "**/*token*"] },
  { signals: ["security"], patterns: ["**/*security*", "**/*audit*", "**/*vulnerab*", "**/csrf*", "**/*csp*", "**/*sanitize*", "**/*escape*"] },
  { signals: ["database"], patterns: ["**/migrations/**", "**/*migration*", "**/schema.prisma", "**/schema.sql", "**/drizzle/**", "**/*.sql"] },
  { signals: ["testing"], patterns: ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/tests/**", "**/test/**", "**/*.e2e.*"] },
  { signals: ["frontend"], patterns: ["**/components/**", "**/*.jsx", "**/*.tsx", "**/*.css", "**/*.scss", "**/*.html", "**/pages/**", "**/app/page*"] },
  { signals: ["api"], patterns: ["**/api/**", "**/routes/**", "**/controllers/**", "**/handlers/**", "**/*endpoint*"] },
  { signals: ["deployment"], patterns: ["**/Dockerfile*", "**/docker-compose*", "**/*.yml", "**/*.yaml", "**/.github/workflows/**", "**/Procfile", "**/vercel.json", "**/netlify.toml"] },
  { signals: ["documentation"], patterns: ["**/*.md", "**/docs/**"] },
  { signals: ["typescript"], patterns: ["**/*.ts", "**/*.tsx"] },
  { signals: ["ui"], patterns: ["**/*.css", "**/*.scss", "**/*.less", "**/*.tailwind*", "**/theme/**", "**/styles/**"] },
  { signals: ["payments"], patterns: ["**/*stripe*", "**/*payment*", "**/*checkout*", "**/*billing*"] },
  { signals: ["webhook"], patterns: ["**/*webhook*"] },
  { signals: ["subscription"], patterns: ["**/*subscription*", "**/*billing*", "**/*plan*"] },
  { signals: ["workflow"], patterns: ["**/.github/workflows/**"] },
  { signals: ["refactoring"], patterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"] },
];

export function inferGitSignals(files: string[]): string[] {
  const signals = new Set<string>();
  if (files.length === 0) return [];
  const aliasCache = new Map<string, string>();
  const aliasOf = (signal: string): string => {
    const cached = aliasCache.get(signal);
    if (cached) return cached;
    const alias = [...normalizePhrases(signal)][0] ?? signal;
    aliasCache.set(signal, alias);
    return alias;
  };
  for (const file of files) {
    for (const { signals: sigs, patterns } of GIT_SIGNAL_PATTERNS) {
      if (matchesGlob(file, patterns)) {
        for (const s of sigs) signals.add(aliasOf(s));
      }
    }
  }
  return [...signals];
}