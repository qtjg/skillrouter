export class SkillRouterError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly hint?: string;

  constructor(code: string, message: string, options?: { exitCode?: number; hint?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "SkillRouterError";
    this.code = code;
    this.exitCode = options?.exitCode ?? 1;
    this.hint = options?.hint;
  }
}

export class UsageError extends SkillRouterError {
  constructor(message: string, hint?: string) {
    super("E_USAGE", message, { exitCode: 2, hint });
    this.name = "UsageError";
  }
}

export class ConfigError extends SkillRouterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("E_CONFIG", message, { exitCode: 1, hint: "Fix the configuration file, or run `skillrouter config reset` to restore defaults.", cause: options?.cause });
    this.name = "ConfigError";
  }
}

export class ManifestError extends SkillRouterError {
  constructor(message: string, options?: { cause?: unknown; path?: string }) {
    const prefix = options?.path ? `[${options.path}] ` : "";
    super("E_MANIFEST", `${prefix}${message}`, { exitCode: 1, hint: "See docs/manifest.md for the skillrouter/v1 manifest specification.", cause: options?.cause });
    this.name = "ManifestError";
  }
}

export class NotFoundError extends SkillRouterError {
  constructor(message: string) {
    super("E_NOT_FOUND", message, { exitCode: 1, hint: "Use `skillrouter search <query>` to find available capabilities." });
    this.name = "NotFoundError";
  }
}

export class SecurityError extends SkillRouterError {
  constructor(message: string, hint?: string) {
    super("E_SECURITY", message, { exitCode: 1, hint: hint ?? "Capabilities are untrusted by default. Audit the capability before installing it." });
    this.name = "SecurityError";
  }
}

export class AdapterError extends SkillRouterError {
  constructor(message: string, options?: { cause?: unknown; agent?: string }) {
    const prefix = options?.agent ? `[${options.agent}] ` : "";
    super("E_ADAPTER", `${prefix}${message}`, { exitCode: 1, hint: "See docs/adapters.md. The agent may need to be restarted after changes.", cause: options?.cause });
    this.name = "AdapterError";
  }
}

export class InstallationError extends SkillRouterError {
  constructor(message: string, options?: { cause?: unknown; hint?: string }) {
    super("E_INSTALL", message, { exitCode: 1, hint: options?.hint ?? "No changes were committed; the previous state was restored.", cause: options?.cause });
    this.name = "InstallationError";
  }
}

export class RouterError extends SkillRouterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("E_ROUTER", message, { exitCode: 1, hint: "Run `skillrouter explain` to see why the router made a decision.", cause: options?.cause });
    this.name = "RouterError";
  }
}

export class GitError extends SkillRouterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("E_GIT", message, { exitCode: 1, hint: "SkillRouter continues without Git context when the project is not a Git repository.", cause: options?.cause });
    this.name = "GitError";
  }
}

export function isSkillRouterError(err: unknown): err is SkillRouterError {
  return err instanceof SkillRouterError;
}

export function formatError(err: unknown): string {
  if (err instanceof SkillRouterError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
