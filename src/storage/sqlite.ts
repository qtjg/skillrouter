import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import type { Capability, CapabilityState, TrustLevel } from "../core/types.ts";
import { ensureDir } from "../utils/fs.ts";
import { SkillRouterError } from "../utils/errors.ts";
import { installedAgentsJson, parseAgentsJson, type Storage, type InstalledCapabilityRow, type RoutingHistoryRow, type AuditRow, type PreferenceRow, type TrustRow, type RouterCacheRow } from "./types.ts";

function toInstalledRow(raw: Record<string, unknown>): InstalledCapabilityRow {
  return {
    id: String(raw.id),
    version: String(raw.version),
    state: raw.state as CapabilityState,
    installRoot: (raw.install_root as string | null) ?? null,
    agents: parseAgentsJson(raw.agents as string),
    installedAt: String(raw.installed_at),
    updatedAt: String(raw.updated_at),
    sourceType: (raw.source_type as string | null) ?? null,
    sourceLocation: (raw.source_location as string | null) ?? null,
  };
}

const MIGRATIONS: string[] = [
  // migration 1: initial schema
  `
  CREATE TABLE capabilities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    json TEXT NOT NULL,
    indexed_at TEXT NOT NULL
  );
  CREATE INDEX idx_capabilities_type ON capabilities(type);
  CREATE INDEX idx_capabilities_indexed_at ON capabilities(indexed_at);

  CREATE TABLE installed (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    state TEXT NOT NULL,
    install_root TEXT,
    agents TEXT NOT NULL DEFAULT '[]',
    installed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_type TEXT,
    source_location TEXT
  );

  CREATE TABLE routing_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    task TEXT NOT NULL,
    project TEXT,
    decision_id TEXT,
    activations TEXT NOT NULL DEFAULT '[]',
    deactivations TEXT NOT NULL DEFAULT '[]',
    selected TEXT NOT NULL DEFAULT '[]',
    mode TEXT NOT NULL DEFAULT 'assisted'
  );
  CREATE INDEX idx_routing_history_ts ON routing_history(ts);

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    capability TEXT,
    detail TEXT
  );
  CREATE INDEX idx_audit_capability ON audit_log(capability);
  CREATE INDEX idx_audit_ts ON audit_log(ts);

  CREATE TABLE preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE trust (
    capability_id TEXT PRIMARY KEY,
    trust TEXT NOT NULL,
    note TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE router_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    ts TEXT NOT NULL
  );
  `,
];

export class SqliteStorage implements Storage {
  private db: DatabaseSync | null = null;
  private readonly path: string;
  readonly dataDir: string;

  constructor(path: string) {
    this.path = path;
    this.dataDir = path === ":memory:" ? dirname(process.cwd()) : dirname(path);
  }

  async init(): Promise<void> {
    if (this.path !== ":memory:") {
      await ensureDir(dirname(this.path));
    }
    try {
      this.db = new DatabaseSync(this.path);
    } catch (err) {
      throw new SkillRouterError("E_STORAGE", `Failed to open storage database at ${this.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    const current = this.db!.prepare("PRAGMA user_version").get() as { user_version: number };
    let version = current.user_version;
    while (version < MIGRATIONS.length) {
      this.db!.exec(`BEGIN;`);
      try {
        this.db!.exec(MIGRATIONS[version]!);
        version += 1;
        this.db!.exec(`PRAGMA user_version = ${version};`);
        this.db!.exec(`COMMIT;`);
      } catch (err) {
        this.db!.exec(`ROLLBACK;`);
        throw new SkillRouterError("E_STORAGE", `Storage migration ${version} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private get connection(): DatabaseSync {
    if (!this.db) throw new SkillRouterError("E_STORAGE", "Storage not initialized; call init() first");
    return this.db;
  }

  async upsertCapability(capability: Capability): Promise<void> {
    this.connection
      .prepare(
        `INSERT INTO capabilities (id, name, version, type, description, json, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version, type = excluded.type,
           description = excluded.description, json = excluded.json, indexed_at = excluded.indexed_at`,
      )
      .run(capability.id, capability.name, capability.version, capability.type, capability.description, JSON.stringify(capability), new Date().toISOString());
  }

  async getCapability(id: string): Promise<Capability | null> {
    const row = this.connection.prepare("SELECT json FROM capabilities WHERE id = ?").get(id) as { json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.json) as Capability;
  }

  async allCapabilities(): Promise<Capability[]> {
    const rows = this.connection.prepare("SELECT json FROM capabilities ORDER BY id").all() as Array<{ json: string }>;
    return rows.map((r) => JSON.parse(r.json) as Capability);
  }

  async removeCapability(id: string): Promise<void> {
    this.connection.prepare("DELETE FROM capabilities WHERE id = ?").run(id);
  }

  async getInstalled(id: string): Promise<InstalledCapabilityRow | null> {
    const row = this.connection.prepare("SELECT * FROM installed WHERE id = ?").get(id);
    if (!row) return null;
    return toInstalledRow(row as Record<string, unknown>);
  }

  async setInstalledState(id: string, state: CapabilityState, patch: Partial<InstalledCapabilityRow>): Promise<void> {
    const existing = this.connection.prepare("SELECT * FROM installed WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    const now = new Date().toISOString();
    if (!existing) {
      this.connection
        .prepare(
          `INSERT INTO installed (id, version, state, install_root, agents, installed_at, updated_at, source_type, source_location)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          patch.id!,
          patch.version!,
          state,
          patch.installRoot ?? null,
          installedAgentsJson(patch.agents ?? []),
          now,
          now,
          patch.sourceType ?? null,
          patch.sourceLocation ?? null,
        );
      return;
    }
    this.connection
      .prepare(
        `UPDATE installed SET version = ?, state = ?, install_root = ?, agents = ?, updated_at = ?, source_type = ?, source_location = ? WHERE id = ?`,
      )
      .run(
        patch.version ?? (existing.version as string),
        state,
        patch.installRoot ?? (existing.install_root as string | null) ?? null,
        installedAgentsJson(patch.agents ?? parseAgentsJson(existing.agents as string)),
        now,
        patch.sourceType ?? (existing.source_type as string | null) ?? null,
        patch.sourceLocation ?? (existing.source_location as string | null) ?? null,
        id,
      );
  }

  async allInstalled(): Promise<InstalledCapabilityRow[]> {
    const rows = this.connection.prepare("SELECT * FROM installed ORDER BY id").all();
    return rows.map((row) => toInstalledRow(row as Record<string, unknown>));
  }

  async getHistory(filter: { task?: string; limit?: number } = {}): Promise<RoutingHistoryRow[]> {
    const limit = filter.limit ?? 50;
    if (filter.task) {
      return this.connection.prepare(`SELECT * FROM routing_history WHERE task LIKE ? ORDER BY ts DESC LIMIT ?`).all(`%${filter.task}%`, limit) as unknown as RoutingHistoryRow[];
    }
    return this.connection.prepare(`SELECT * FROM routing_history ORDER BY ts DESC LIMIT ?`).all(limit) as unknown as RoutingHistoryRow[];
  }

  async addHistory(entry: Omit<RoutingHistoryRow, "id" | "ts">): Promise<void> {
    this.connection
      .prepare(`INSERT INTO routing_history (ts, task, project, decision_id, activations, deactivations, selected, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        new Date().toISOString(),
        entry.task,
        entry.project,
        entry.decisionId,
        JSON.stringify(entry.activations),
        JSON.stringify(entry.deactivations),
        JSON.stringify(entry.selected),
        entry.mode,
      );
  }

  async addAudit(actor: string, action: string, capability: string | null, detail: string | null): Promise<void> {
    this.connection
      .prepare(`INSERT INTO audit_log (ts, actor, action, capability, detail) VALUES (?, ?, ?, ?, ?)`)
      .run(new Date().toISOString(), actor, action, capability, detail);
  }

  async getAudit(options: { limit?: number; capability?: string } = {}): Promise<AuditRow[]> {
    const limit = options.limit ?? 100;
    if (options.capability) {
      return this.connection.prepare(`SELECT * FROM audit_log WHERE capability = ? ORDER BY ts DESC LIMIT ?`).all(options.capability, limit) as unknown as AuditRow[];
    }
    return this.connection.prepare(`SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?`).all(limit) as unknown as AuditRow[];
  }

  async getPreference(key: string): Promise<string | null> {
    const row = this.connection.prepare("SELECT value FROM preferences WHERE key = ?").get(key) as PreferenceRow | undefined;
    return row?.value ?? null;
  }

  async setPreference(key: string, value: string): Promise<void> {
    this.connection
      .prepare(`INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, value);
  }

  async allPreferences(): Promise<PreferenceRow[]> {
    return this.connection.prepare("SELECT * FROM preferences ORDER BY key").all() as unknown as PreferenceRow[];
  }

  async getTrust(capabilityId: string): Promise<TrustRow | null> {
    const row = this.connection.prepare("SELECT * FROM trust WHERE capability_id = ?").get(capabilityId) as TrustRow | undefined;
    return row ?? null;
  }

  async setTrust(capabilityId: string, trust: TrustLevel, note?: string): Promise<void> {
    this.connection
      .prepare(
        `INSERT INTO trust (capability_id, trust, note, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(capability_id) DO UPDATE SET trust = excluded.trust, note = excluded.note, updated_at = excluded.updated_at`,
      )
      .run(capabilityId, trust, note ?? null, new Date().toISOString());
  }

  async removeTrust(capabilityId: string): Promise<void> {
    this.connection.prepare("DELETE FROM trust WHERE capability_id = ?").run(capabilityId);
  }

  async allTrust(): Promise<TrustRow[]> {
    return this.connection.prepare("SELECT * FROM trust ORDER BY capability_id").all() as unknown as TrustRow[];
  }

  async getRouterCache(key: string): Promise<string | null> {
    const row = this.connection.prepare("SELECT value FROM router_cache WHERE key = ?").get(key) as RouterCacheRow | undefined;
    return row?.value ?? null;
  }

  async setRouterCache(key: string, value: string): Promise<void> {
    this.connection
      .prepare(`INSERT INTO router_cache (key, value, ts) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, ts = excluded.ts`)
      .run(key, value, new Date().toISOString());
  }
}