import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databasePath } from "../config/load-config.js";
import { encodeVectorJsonAsFloat32Blob } from "../semantic/vector-codec.js";
import { packageVersion } from "../version.js";
import { createDatabase, type SqliteDatabase } from "./sqlite-adapter.js";

export const CURRENT_SCHEMA_VERSION = 1;

export interface OpenDatabaseOptions {
  createIfMissing?: boolean;
  applySchema?: boolean;
}

export interface SchemaMetadata {
  schemaVersion: number;
  createdByVersion?: string;
  updatedAt?: string;
  baseline: "current" | "legacy";
}

export function openDatabase(projectRoot: string, options: OpenDatabaseOptions = {}): SqliteDatabase {
  const target = databasePath(projectRoot);
  const createIfMissing = options.createIfMissing ?? true;
  const applySchema = options.applySchema ?? true;
  const databaseExisted = fs.existsSync(target);

  if (!createIfMissing && !databaseExisted) {
    throw new Error(`MDGraph database not found at ${target}. Run \`mdgraph index\` first.`);
  }
  if (createIfMissing) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }

  let db: SqliteDatabase;
  try {
    db = createDatabase(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to open MDGraph database at ${target}: ${message}. Confirm Node.js >=22.5.0 has node:sqlite support, the directory is writable, and run \`mdgraph index\` to rebuild the local index if the database is corrupt.`);
  }
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (applySchema) {
    try {
      assertCompatibleExistingSchema(db, target);
      const hadMetadata = hasSchemaMetadata(db);
      const schemaSql = readSchemaSql();
      db.exec(schemaSql);
      ensureSchemaMetadata(db, { databaseExisted, hadMetadata });
      migrateChunkFtsSchema(db, schemaSql);
      migrateChunkVectorSchema(db, schemaSql);
    } catch (error) {
      db.close();
      throw error;
    }
  }
  return db;
}

export function openExistingDatabase(projectRoot: string): SqliteDatabase {
  return openDatabase(projectRoot, { createIfMissing: false, applySchema: true });
}

function readSchemaSql(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const schemaPath = path.join(path.dirname(currentFile), "schema.sql");
  return fs.readFileSync(schemaPath, "utf8");
}

export function readSchemaMetadata(db: SqliteDatabase): SchemaMetadata {
  const values = schemaMetadataValues(db);
  return {
    schemaVersion: numberValue(values.get("schema_version")),
    createdByVersion: values.get("created_by_version"),
    updatedAt: values.get("updated_at"),
    baseline: values.get("baseline") === "legacy" ? "legacy" : "current"
  };
}

function assertCompatibleExistingSchema(db: SqliteDatabase, target: string): void {
  if (!hasSchemaMetadata(db)) {
    return;
  }
  const metadata = readSchemaMetadata(db);
  if (metadata.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`MDGraph database at ${target} uses schema version ${metadata.schemaVersion}, but this CLI supports schema version ${CURRENT_SCHEMA_VERSION}. Upgrade MDGraph, or rebuild the local index with a compatible version.`);
  }
}

function hasSchemaMetadata(db: SqliteDatabase): boolean {
  const row = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'schema_metadata'").get();
  return Boolean(row);
}

function ensureSchemaMetadata(db: SqliteDatabase, options: { databaseExisted: boolean; hadMetadata: boolean }): void {
  const now = new Date().toISOString();
  const values = schemaMetadataValues(db);
  const baseline = values.get("baseline") ?? (options.databaseExisted && !options.hadMetadata ? "legacy" : "current");
  const createdByVersion = values.get("created_by_version") ?? packageVersion();
  const upsert = db.prepare("INSERT OR REPLACE INTO schema_metadata (key, value) VALUES (?, ?)");
  upsert.run("schema_version", String(CURRENT_SCHEMA_VERSION));
  upsert.run("created_by_version", createdByVersion);
  upsert.run("updated_at", now);
  upsert.run("baseline", baseline);
}

function schemaMetadataValues(db: SqliteDatabase): Map<string, string> {
  if (!hasSchemaMetadata(db)) {
    return new Map();
  }
  const rows = db.prepare("SELECT key, value FROM schema_metadata").all() as Array<{ key: string; value: string }>;
  return new Map(rows.map((row) => [row.key, row.value]));
}

function migrateChunkFtsSchema(db: SqliteDatabase, schemaSql: string): void {
  const row = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'chunks_fts'").get() as { sql?: string } | undefined;
  if (!row?.sql || isExternalContentChunkFts(row.sql)) {
    return;
  }

  db.exec("DROP TABLE IF EXISTS chunks_fts;");
  db.exec(schemaSql);
  db.exec("INSERT INTO chunks_fts(rowid, content) SELECT rowid, content FROM chunks;");
  compactDatabase(db);
}

function isExternalContentChunkFts(sql: string): boolean {
  const normalized = sql.toLowerCase().replace(/\s+/g, " ");
  return /content\s*=\s*'chunks'/.test(normalized) && /content_rowid\s*=\s*'rowid'/.test(normalized);
}

function migrateChunkVectorSchema(db: SqliteDatabase, schemaSql: string): void {
  const columns = tableColumns(db, "chunk_vectors");
  if (!columns.has("vector_json")) {
    return;
  }

  const rows = db.prepare(`
    SELECT chunk_id, provider, model, dimensions, vector_json, created_at
    FROM chunk_vectors
  `).all() as Array<{
    chunk_id: string;
    provider: string;
    model: string;
    dimensions: number;
    vector_json: string;
    created_at: string;
  }>;

  db.exec("DROP INDEX IF EXISTS idx_chunk_vectors_provider;");
  db.exec("ALTER TABLE chunk_vectors RENAME TO chunk_vectors_legacy;");
  db.exec(schemaSql);

  const insert = db.prepare(`
    INSERT INTO chunk_vectors (chunk_id, provider, model, dimensions, vector_blob, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      row.chunk_id,
      row.provider,
      row.model,
      row.dimensions,
      encodeVectorJsonAsFloat32Blob(row.vector_json),
      row.created_at
    );
  }

  db.exec("DROP TABLE chunk_vectors_legacy;");
  compactDatabase(db);
}

function tableColumns(db: SqliteDatabase, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactDatabase(db: SqliteDatabase): void {
  db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('optimize');");
  db.exec("PRAGMA optimize;");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  db.exec("VACUUM;");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
}
