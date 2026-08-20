/**
 * Text normalization + secret redaction for corpus extraction.
 * Normalized, redacted text is what gets fingerprinted and stored, so secrets
 * found in capability bodies never persist and any redaction change is
 * reflected in the content hash.
 */

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // generic key/value assignments and headers
  { pattern: /\b(?:api[_-]?key|apikey|secret|token|password|passwd|authorization|access[_-]?token)\b\s*[:=]\s*["']?[^\s"',;{}][^\n]{0,60}/gi, replacement: "REDACTED" },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, replacement: "Bearer REDACTED" },
  // OpenAI-style keys
  { pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g, replacement: "sk-REDACTED" },
  // GitHub tokens
  { pattern: /\bgh[poaur]_[A-Za-z0-9]{20,}\b/g, replacement: "ghp-REDACTED" },
  // AWS access key ids
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "AKIA-REDACTED" },
  // npm tokens
  { pattern: /\bnpm_[A-Za-z0-9]{20,}\b/g, replacement: "npm-REDACTED" },
  // private ssh keys references
  { pattern: /-----BEGIN (?:RSA|EC|OPENSSH|DSA) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|EC|OPENSSH|DSA) PRIVATE KEY-----/g, replacement: "REDACTED PRIVATE KEY" },
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Collapses CRLF, trims and squeezes runs of blank lines to a single blank line. */
export function normalizeText(raw: string): string {
  let out = raw.replace(/\r\n/g, "\n");
  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/** Conservative token estimate: ~4 characters per token (e.g. OpenAI encodings). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Full body pipeline: normalize, then redact secrets. */
export function prepareText(raw: string): string {
  return redactSecrets(normalizeText(raw));
}