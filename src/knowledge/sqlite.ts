// ══════════════════════════════════════════════════════════════
// KNOWLEDGE STORE — SQLite Backend
// ══════════════════════════════════════════════════════════════

import Database from "better-sqlite3";
import type {
  ScreenshotRow,
  EntityRow,
  Fact,
  FactInput,
  ProfileKV,
  ConversationRow,
  ScreenshotMeta,
} from "./types.js";

// ── Schema ───────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS screenshots (
  id                   TEXT PRIMARY KEY,
  file_name            TEXT NOT NULL,
  original_path        TEXT NOT NULL,
  local_path           TEXT NOT NULL,
  uploaded_at          TEXT NOT NULL,
  file_size_kb         REAL NOT NULL,
  analyzed             INTEGER NOT NULL DEFAULT 0,
  analyzed_at          TEXT,
  source_app           TEXT,
  category             TEXT,
  summary              TEXT,
  detailed_description TEXT
);

CREATE TABLE IF NOT EXISTS entities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  screenshot_id TEXT NOT NULL REFERENCES screenshots(id),
  entity_type   TEXT NOT NULL,
  entity_value  TEXT NOT NULL,
  extra_json    TEXT,
  UNIQUE(screenshot_id, entity_type, entity_value)
);
CREATE INDEX IF NOT EXISTS idx_entities_type  ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_value ON entities(entity_value);

CREATE TABLE IF NOT EXISTS facts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_type  TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  source     TEXT NOT NULL,
  evidence   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fact_type, fact_value, source)
);
CREATE INDEX IF NOT EXISTS idx_facts_type ON facts(fact_type);

CREATE TABLE IF NOT EXISTS profile_kv (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,
  confidence   REAL DEFAULT 1.0,
  sources_json TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id        TEXT PRIMARY KEY,
  query     TEXT NOT NULL,
  intent    TEXT NOT NULL,
  response  TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_ts ON conversations(timestamp);

CREATE TABLE IF NOT EXISTS profile_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const SEED_META = `
INSERT OR IGNORE INTO profile_meta (key, value) VALUES ('version', '0');
INSERT OR IGNORE INTO profile_meta (key, value) VALUES ('total_screenshots', '0');
INSERT OR IGNORE INTO profile_meta (key, value) VALUES ('last_updated', '');
`;

// ── SQLite Wrapper ───────────────────────────────────────────

export class SQLiteStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.db.exec(SEED_META);
  }

  close(): void {
    this.db.close();
  }

  // ── Screenshots ──────────────────────────────────────────

  saveScreenshot(meta: ScreenshotMeta): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO screenshots
        (id, file_name, original_path, local_path, uploaded_at, file_size_kb,
         analyzed, analyzed_at, source_app, category, summary, detailed_description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      meta.id, meta.fileName, meta.originalPath, meta.localPath,
      meta.uploadedAt, meta.fileSizeKB,
      meta.analyzed ? 1 : 0, meta.analyzedAt ?? null,
      meta.sourceApp ?? null, meta.category ?? null,
      meta.summary ?? null, meta.detailedDescription ?? null
    );

    // Save entities
    if (meta.entities) {
      this.saveEntitiesForScreenshot(meta.id, meta.entities);
    }

    // Update total count
    const count = this.db.prepare("SELECT COUNT(*) as c FROM screenshots").get() as { c: number };
    this.setMeta("total_screenshots", String(count.c));
    this.setMeta("last_updated", new Date().toISOString());
  }

  updateScreenshot(id: string, updates: Partial<ScreenshotMeta>): void {
    const existing = this.getScreenshot(id);
    if (!existing) return;

    const merged = {
      id: existing.id,
      fileName: existing.fileName,
      originalPath: existing.originalPath,
      localPath: existing.localPath,
      uploadedAt: existing.uploadedAt,
      fileSizeKB: existing.fileSizeKB,
      analyzed: updates.analyzed ?? (existing.analyzed === 1),
      analyzedAt: updates.analyzedAt ?? existing.analyzedAt ?? undefined,
      sourceApp: updates.sourceApp ?? existing.sourceApp ?? undefined,
      category: updates.category ?? existing.category ?? undefined,
      summary: updates.summary ?? existing.summary ?? undefined,
      detailedDescription: updates.detailedDescription ?? existing.detailedDescription ?? undefined,
      entities: updates.entities,
      userFacts: updates.userFacts,
    } as ScreenshotMeta;

    this.saveScreenshot(merged);
  }

  getScreenshot(id: string): ScreenshotRow | null {
    return this.db.prepare("SELECT * FROM screenshots WHERE id = ?").get(id) as ScreenshotRow | undefined ?? null;
  }

  getAllScreenshots(): ScreenshotRow[] {
    return this.db.prepare("SELECT * FROM screenshots ORDER BY uploaded_at DESC").all() as ScreenshotRow[];
  }

  getScreenshotsByCategory(category: string): ScreenshotRow[] {
    return this.db.prepare("SELECT * FROM screenshots WHERE category = ? ORDER BY uploaded_at DESC").all(category) as ScreenshotRow[];
  }

  getAnalyzedScreenshots(): ScreenshotRow[] {
    return this.db.prepare("SELECT * FROM screenshots WHERE analyzed = 1 ORDER BY uploaded_at DESC").all() as ScreenshotRow[];
  }

  getUnanalyzedScreenshots(): ScreenshotRow[] {
    return this.db.prepare("SELECT * FROM screenshots WHERE analyzed = 0").all() as ScreenshotRow[];
  }

  // ── Entities ─────────────────────────────────────────────

  private saveEntitiesForScreenshot(screenshotId: string, entities: Record<string, unknown>): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO entities (screenshot_id, entity_type, entity_value, extra_json)
      VALUES (?, ?, ?, ?)
    `);

    const batch = this.db.transaction(() => {
      for (const [key, val] of Object.entries(entities)) {
        if (val == null) continue;

        if (Array.isArray(val)) {
          for (const item of val) {
            if (typeof item === "string") {
              insert.run(screenshotId, key, item, null);
            } else if (typeof item === "object") {
              // e.g. songs: [{title, artist}]
              const label = (item as Record<string, string>).title
                ?? (item as Record<string, string>).name
                ?? JSON.stringify(item);
              insert.run(screenshotId, key, label, JSON.stringify(item));
            }
          }
        } else if (typeof val === "string") {
          insert.run(screenshotId, key, val, null);
        }
      }
    });
    batch();
  }

  getEntitiesByScreenshot(screenshotId: string): EntityRow[] {
    return this.db.prepare("SELECT * FROM entities WHERE screenshot_id = ?").all(screenshotId) as EntityRow[];
  }

  getEntitiesByType(entityType: string): EntityRow[] {
    return this.db.prepare("SELECT * FROM entities WHERE entity_type = ?").all(entityType) as EntityRow[];
  }

  getEntitiesByValue(entityValue: string): EntityRow[] {
    return this.db.prepare("SELECT * FROM entities WHERE entity_value = ?").all(entityValue) as EntityRow[];
  }

  getAllEntities(): EntityRow[] {
    return this.db.prepare("SELECT * FROM entities").all() as EntityRow[];
  }

  // ── Facts ────────────────────────────────────────────────

  addFact(input: FactInput): void {
    this.db.prepare(`
      INSERT INTO facts (fact_type, fact_value, confidence, source, evidence)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(fact_type, fact_value, source) DO UPDATE SET
        confidence = MAX(facts.confidence, excluded.confidence),
        evidence = COALESCE(excluded.evidence, facts.evidence),
        updated_at = datetime('now')
    `).run(input.factType, input.factValue, input.confidence, input.source, input.evidence ?? null);
  }

  reinforceFact(factType: string, factValue: string, newSource: string): void {
    // Increase confidence for all matching facts, cap at 1.0
    this.db.prepare(`
      UPDATE facts SET
        confidence = MIN(1.0, confidence + 0.05),
        updated_at = datetime('now')
      WHERE fact_type = ? AND fact_value = ?
    `).run(factType, factValue);

    // Also add a new source row if it doesn't exist
    this.addFact({
      factType,
      factValue,
      confidence: 0.6,
      source: newSource,
    });
  }

  getFactsByType(factType: string): Fact[] {
    return this.db.prepare(
      "SELECT * FROM facts WHERE fact_type = ? ORDER BY confidence DESC"
    ).all(factType) as Fact[];
  }

  getTopFact(factType: string): string | null {
    const row = this.db.prepare(
      "SELECT fact_value FROM facts WHERE fact_type = ? ORDER BY confidence DESC LIMIT 1"
    ).get(factType) as { fact_value: string } | undefined;
    return row?.fact_value ?? null;
  }

  getAllFacts(): Fact[] {
    return this.db.prepare("SELECT * FROM facts ORDER BY fact_type, confidence DESC").all() as Fact[];
  }

  getFactSources(factType: string, factValue: string): string[] {
    const rows = this.db.prepare(
      "SELECT DISTINCT source FROM facts WHERE fact_type = ? AND fact_value = ?"
    ).all(factType, factValue) as Array<{ source: string }>;
    return rows.map((r) => r.source);
  }

  // ── Profile KV ───────────────────────────────────────────

  setProfileValue(key: string, value: string, confidence = 1.0, sources?: string[]): void {
    this.db.prepare(`
      INSERT INTO profile_kv (key, value, confidence, sources_json, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        confidence = excluded.confidence,
        sources_json = excluded.sources_json,
        updated_at = datetime('now')
    `).run(key, value, confidence, sources ? JSON.stringify(sources) : null);
  }

  getProfileValue(key: string): ProfileKV | null {
    return this.db.prepare("SELECT * FROM profile_kv WHERE key = ?").get(key) as ProfileKV | undefined ?? null;
  }

  getProfileSection(prefix: string): ProfileKV[] {
    return this.db.prepare(
      "SELECT * FROM profile_kv WHERE key LIKE ? ORDER BY key"
    ).all(`${prefix}%`) as ProfileKV[];
  }

  getAllProfileKV(): ProfileKV[] {
    return this.db.prepare("SELECT * FROM profile_kv ORDER BY key").all() as ProfileKV[];
  }

  // ── Profile Meta ─────────────────────────────────────────

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM profile_meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO profile_meta (key, value) VALUES (?, ?)"
    ).run(key, value);
  }

  incrementProfileVersion(): number {
    const current = parseInt(this.getMeta("version") ?? "0", 10);
    const next = current + 1;
    this.setMeta("version", String(next));
    return next;
  }

  // ── Conversations ────────────────────────────────────────

  saveConversation(convo: ConversationRow): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO conversations (id, query, intent, response, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(convo.id, convo.query, convo.intent, convo.response, convo.timestamp);
  }

  getRecentConversations(limit = 5): ConversationRow[] {
    return this.db.prepare(
      "SELECT * FROM conversations ORDER BY timestamp DESC LIMIT ?"
    ).all(limit) as ConversationRow[];
  }

  getAllConversations(): ConversationRow[] {
    return this.db.prepare("SELECT * FROM conversations ORDER BY timestamp ASC").all() as ConversationRow[];
  }

  // ── Raw DB access (for migration/testing) ────────────────

  get raw(): Database.Database {
    return this.db;
  }
}
