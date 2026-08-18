import { join, basename } from "node:path";
import type { Capability } from "../core/types.ts";
import type { Storage } from "../storage/types.ts";
import { ensureDir, copyDirRecursive, removeDir, pathExists, readTextSafe, writeTextAtomic } from "../utils/fs.ts";
import { sha256Dir } from "../utils/hash.ts";
import { InstallationError } from "../utils/errors.ts";
import { walkFiles } from "../utils/glob.ts";
import { globalBus } from "../core/events.ts";
import { audit } from "../security/audit.ts";
import { computeRisk } from "../security/risk.ts";
import { scanTextForSecrets, shouldWarnOnFile } from "../security/secrets.ts";
import { logger } from "../logging/logger.ts";
import type { Lockfile } from "../lockfile/lockfile.ts";

export interface InstallOptions {
  dryRun?: boolean;
  force?: boolean;
  requireConsent?: boolean;
  autoApprove?: boolean;
  agents?: string[];
}

export interface InstallOutcome {
  capabilityId: string;
  version: string;
  targetDir: string;
  backup: string | null;
}

export interface InstallSummary {
  outcome: InstallOutcome | null;
  problems: string[];
  risk: string;
  riskScore: number;
  dryRun: boolean;
}

export class CapabilityInstaller {
  constructor(private readonly projectRoot: string, private readonly storage: Storage | null = null) {}

  private installedDir(): string {
    return join(this.projectRoot, ".skillrouter", "installed");
  }

  private backupsDir(): string {
    return join(this.projectRoot, ".skillrouter", "backups");
  }

  targetFor(capability: Capability): string {
    return join(this.installedDir(), `${capability.id}@${capability.version}`);
  }

  /** Check a capability for policy/security problems prior to install. */
  async auditInstall(sourceDir: string, capability: Capability, options: InstallOptions = {}): Promise<InstallSummary> {
    const problems: string[] = [];
    const risk = computeRisk(capability);

    if (risk.level === "critical" && !options.force) {
      problems.push(`Critical risk capability (${risk.score}/100). Pass --force to install anyway.`);
    }
    if ((risk.level === "high" || risk.level === "critical") && options.requireConsent !== false && !options.autoApprove && !options.force) {
      problems.push(`Risk level ${risk.level.toUpperCase()} (${risk.score}/100) requires explicit consent (--yes).`);
    }

    const files = await walkFiles(sourceDir, { ignore: [] }).catch(() => []);
    for (const file of files) {
      const relative = file.replace(sourceDir + "/", "");
      if (shouldWarnOnFile(basename(file))) {
        problems.push(`Contains sensitive file: ${relative}`);
      }
      const content = await readTextSafe(file);
      if (content && content.length < 2 * 1024 * 1024) {
        const matches = scanTextForSecrets(content, relative);
        if (matches.length > 0) {
          problems.push(`Potential secrets detected (${matches.map((m) => `${m.file}:${m.line} (${m.pattern})`).join(", ")})`);
          break;
        }
      }
    }
    void options;
    return { outcome: null, problems, risk: risk.level, riskScore: risk.score, dryRun: options.dryRun ?? false };
  }

  /**
   * Transactional install: prepare → validate → backup → install → verify → commit.
   * Throws on failure; the previous state (if any) is always restored.
   */
  async install(capability: Capability, sourceDir: string, options: InstallOptions = {}, lockfile: Lockfile | null = null): Promise<InstallSummary> {
    const auditResult = await this.auditInstall(sourceDir, capability, options);
    if (auditResult.problems.length > 0 && !options.force) {
      if (options.dryRun) {
        return { ...auditResult, dryRun: true };
      }
      throw new InstallationError(`Refusing to install ${capability.id}@${capability.version}:\n  - ${auditResult.problems.join("\n  - ")}`, {
        hint: "Resolve the issues above, or pass --force (--yes) to override.",
      });
    }

    if (options.dryRun) {
      return { ...auditResult, outcome: null, dryRun: true };
    }

    const targetDir = this.targetFor(capability);
    await ensureDir(this.installedDir());

    let backupDir: string | null = null;
    if (await pathExists(targetDir)) {
      backupDir = join(this.backupsDir(), `${capability.id}@${capability.version}-${Date.now()}`);
      await ensureDir(this.backupsDir());
      await copyDirRecursive(targetDir, backupDir);
      logger.info(`Backed up existing installation to ${backupDir}`);
    }

    const committed = await this.stageInstall(capability, sourceDir, targetDir);
    if (!committed) {
      if (backupDir && (await pathExists(backupDir))) {
        await removeDir(targetDir);
        await copyDirRecursive(backupDir, targetDir);
        logger.warn(`Rolled back ${capability.id} to previous version`);
      }
      throw new InstallationError(`Installation of ${capability.id}@${capability.version} failed verification; previous state restored.`);
    }

    if (lockfile) {
      lockfile.capabilities.set(capability.id, {
        version: capability.version,
        hash: await sha256Dir(targetDir, walkFiles),
        source: capability.source ? { type: capability.source.type, location: capability.source.location, url: capability.source.url, commit: capability.source.commit } : null,
      });
    }

    if (this.storage) {
      await this.storage.upsertCapability(capability);
      await this.storage.setInstalledState(capability.id, "INSTALLED", {
        id: capability.id,
        version: capability.version,
        installRoot: targetDir,
        agents: options.agents ?? [],
        sourceType: capability.source?.type ?? "local",
        sourceLocation: capability.source?.location ?? sourceDir,
      });
      await audit(this.storage, "cli", "install", capability.id, `version=${capability.version} risk=${auditResult.risk}`);
    }

    globalBus.emit({ event: "capability.installed", id: capability.id, version: capability.version });
    logger.info(`Installed ${capability.id}@${capability.version} → ${targetDir}`);

    return { ...auditResult, outcome: { capabilityId: capability.id, version: capability.version, targetDir, backup: backupDir }, problems: [], dryRun: false };
  }

  private async stageInstall(capability: Capability, sourceDir: string, targetDir: string): Promise<boolean> {
    const stageRoot = join(this.projectRoot, ".skillrouter", ".staging");
    await ensureDir(stageRoot);
    const stageDir = join(stageRoot, `${capability.id}-${Date.now()}`);

    try {
      await copyDirRecursive(sourceDir, stageDir);
      await removeDir(targetDir);
      await copyDirRecursive(stageDir, targetDir);

      const expected = await sha256Dir(stageDir, walkFiles);
      const actual = await sha256Dir(targetDir, walkFiles);
      if (actual !== expected) return false;

      const hashFile = join(targetDir, ".skillrouter.hash");
      await writeTextAtomic(hashFile, `${actual}\n`);

      const manifestContent = (await readTextSafe(join(targetDir, "skillrouter.yaml"))) ?? (await readTextSafe(join(targetDir, "manifest.yaml")));
      if (manifestContent === null) return false;

      return true;
    } catch {
      return false;
    } finally {
      await removeDir(stageDir);
    }
  }

  async uninstall(
    capabilityId: string,
    installed: { version: string; installRoot: string | null },
    options: { dryRun?: boolean } = {},
  ): Promise<{ removed: boolean; backup: string | null }> {
    if (options.dryRun) return { removed: true, backup: null };
    if (!installed.installRoot) {
      throw new InstallationError(`Capability ${capabilityId} has no install root recorded`);
    }
    const backupDir = join(this.backupsDir(), `${capabilityId}@${installed.version}-uninstall-${Date.now()}`);
    await ensureDir(this.backupsDir());
    if (await pathExists(installed.installRoot)) {
      await copyDirRecursive(installed.installRoot, backupDir);
    }
    await removeDir(installed.installRoot);
    if (this.storage) {
      await this.storage.removeCapability(capabilityId);
      await audit(this.storage, "cli", "uninstall", capabilityId, `backup=${backupDir}`);
    }
    return { removed: true, backup: backupDir };
  }

  /** Verify an installed capability directory contains a valid manifest and matching hash. */
  async verifyInstalled(capabilityId: string, installed: { installRoot: string | null }): Promise<{ ok: boolean; problems: string[] }> {
    if (!installed.installRoot || !(await pathExists(installed.installRoot))) {
      return { ok: false, problems: ["install root missing"] };
    }
    const problems: string[] = [];
    const hashFile = await readTextSafe(join(installed.installRoot, ".skillrouter.hash"));
    if (hashFile) {
      const actual = await sha256Dir(installed.installRoot, walkFiles).catch(() => null);
      if (actual && actual !== hashFile.trim()) problems.push("content hash mismatch");
    }
    const manifestContent = (await readTextSafe(join(installed.installRoot, "skillrouter.yaml"))) ?? (await readTextSafe(join(installed.installRoot, "manifest.yaml")));
    if (manifestContent === null) problems.push("manifest not found");
    return { ok: problems.length === 0, problems };
  }
}