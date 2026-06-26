import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databasePath } from "../config/load-config.js";
import { encodeVectorJsonAsFloat32Blob } from "../semantic/vector-codec.js";
import { createDatabase, type SqliteDatabase } from "./sqlite-adapter.js";

export interface OpenDatabaseOptions {
  createIfMissing?: boolean;
  applySchema?: boolean;
}

export function openDatabase(projectRoot: string, options: OpenDatabaseOptions = {}): SqliteDatabase {
  const target = databasePath(projectRoot);
  const createIfMissing = options.createIfMissing ?? true;
  const applySchema = options.applySchema ?? true;

  if (!createIfMissing && !fs.existsSync(target)) {
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
    const schemaSql = readSchemaSql();
    db.exec(schemaSql);
    migrateChunkFtsSchema(db, schemaSql);
    migrateChunkVectorSchema(db, schemaSql);
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

function compactDatabase(db: SqliteDatabase): void {
  db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('optimize');");
  db.exec("PRAGMA optimize;");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  db.exec("VACUUM;");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
}
