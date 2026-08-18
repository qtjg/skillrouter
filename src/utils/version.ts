export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-.]+))?$/;

export function parseSemVer(input: string): SemVer | null {
  const m = SEMVER_RE.exec(input.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

export function isValidSemVer(input: string): boolean {
  return parseSemVer(input) !== null;
}

export function compareSemVer(a: string, b: string): number {
  const av = parseSemVer(a);
  const bv = parseSemVer(b);
  if (!av || !bv) return a.localeCompare(b);
  for (const key of ["major", "minor", "patch"] as const) {
    if (av[key] !== bv[key]) return av[key] < bv[key] ? -1 : 1;
  }
  if (av.prerelease === bv.prerelease) return 0;
  if (av.prerelease === null) return 1;
  if (bv.prerelease === null) return -1;
  return av.prerelease < bv.prerelease ? -1 : 1;
}

interface RangePart {
  operator: "=" | ">" | ">=" | "<" | "<=" | "^" | "~";
  target: SemVer;
}

const PARTIAL_RE = /^([<>=^~]=?)?\s*v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z-.]+))?$/;

function parsePart(raw: string): RangePart | null {
  const m = PARTIAL_RE.exec(raw.trim());
  if (!m) return null;
  const operator = (m[1] ?? "=").replace("==", "=") as RangePart["operator"];
  return {
    operator,
    target: { major: Number(m[2]), minor: Number(m[3]), patch: Number(m[4] ?? 0), prerelease: m[5] ?? null },
  };
}

export function satisfies(version: string, range: string): boolean {
  const v = parseSemVer(version);
  if (!v) return false;
  const r = range.trim();
  if (r === "" || r === "*" || r === "latest" || r === "x") return true;

  return r.split(/\s*\|\|\s*/).some((orPart) => {
    const andParts = orPart.split(/\s+/).filter(Boolean);
    if (andParts.length === 0) return true;
    return andParts.every((cond) => {
      if (/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(cond.trim())) return compareSemVer(version, cond.trim()) === 0;
      const part = parsePart(cond);
      if (!part) return false;
      const t = part.target;
      switch (part.operator) {
        case "=":
          return cmp(v, t) === 0;
        case ">":
          return cmp(v, t) > 0;
        case ">=":
          return cmp(v, t) >= 0;
        case "<":
          return cmp(v, t) < 0;
        case "<=":
          return cmp(v, t) <= 0;
        case "^": {
          if (cmp(v, t) < 0) return false;
          if (t.major > 0) return v.major === t.major;
          if (t.minor > 0) return v.major === 0 && v.minor === t.minor;
          return v.major === 0 && v.minor === 0 && v.patch === t.patch;
        }
        case "~": {
          if (cmp(v, t) < 0) return false;
          if (t.minor > 0 || t.patch > 0) return v.major === t.major && v.minor === t.minor;
          return v.major === t.major;
        }
      }
    });
  });
}

function cmp(a: SemVer, b: SemVer): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

export function highestVersion(versions: string[]): string | null {
  if (versions.length === 0) return null;
  return versions.reduce((best, v) => (compareSemVer(v, best) > 0 ? v : best));
}
