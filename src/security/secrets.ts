export interface SecretMatch {
  file: string;
  pattern: string;
  line: number;
}

const SECRET_RULES: Array<{ name: string; regexes: RegExp[] }> = [
  {
    name: "stripe-secret-key",
    regexes: [/sk_live_[a-zA-Z0-9]{16,}/g],
  },
  {
    name: "stripe-restricted-key",
    regexes: [/rk_live_[a-zA-Z0-9]{16,}/g],
  },
  {
    name: "openai-api-key",
    regexes: [/sk-[a-zA-Z0-9]{32,}/g, /sk-proj-[a-zA-Z0-9-_]{20,}/g],
  },
  {
    name: "github-token",
    regexes: [/gh[pousr]_[a-zA-Z0-9]{36,}/g],
  },
  {
    name: "google-api-key",
    regexes: [/AIza[0-9A-Za-z_-]{30,}/g],
  },
  {
    name: "aws-access-key",
    regexes: [/AKIA[0-9A-Z]{16}/g],
  },
  {
    name: "aws-secret",
    regexes: [/[aA][wW][sS]_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+=]{30,}/g],
  },
  {
    name: "private-key",
    regexes: [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]{0,4000}?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  },
  {
    name: "npm-token",
    regexes: [/npm_[a-zA-Z0-9]{36}/g],
  },
  {
    name: "generic-assignment",
    regexes: [/(?:api[_-]?key|secret|token|password|passwd)\s*[=:]\s*["']?[A-Za-z0-9!@#$%^&*._-]{16,}["']?/gi],
  },
  {
    name: "jwt",
    regexes: [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  },
];

export function scanTextForSecrets(content: string, fileName: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  if (content.length > 2 * 1024 * 1024) return matches;
  const lines = content.split("\n");
  for (const rule of SECRET_RULES) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/^\s*(#|\/\/|\/\*|\*)/.test(line)) continue;
      if (rule.regexes.some((re) => re.test(line))) {
        matches.push({ file: fileName, pattern: rule.name, line: i + 1 });
        break;
      }
    }
  }
  return matches;
}

const SENSITIVE_FILE_NAMES = [".env", ".env.production", ".env.local", ".env.development", "id_rsa", "id_ed25519", "credentials.json", "service-account.json", ".npmrc"];

export function isSensitiveFile(fileName: string): boolean {
  const base = fileName.split("/").pop() ?? fileName;
  return SENSITIVE_FILE_NAMES.some((s) => base === s || base.endsWith(`.${s}`));
}

export function shouldWarnOnFile(fileName: string): boolean {
  if (isSensitiveFile(fileName)) return true;
  if (/\.(pem|key|p12|pfx|keystore)$/i.test(fileName)) return true;
  return false;
}