import { createRequire } from "node:module";

export interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(str: string, options?: { simple?: boolean }): unknown;
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
  close(): void;
}

class NodeSqliteAdapter implements SqliteDatabase {
  private readonly db: {
    close: () => void;
    exec: (sql: string) => void;
    isOpen: boolean;
    prepare: (sql: string) => {
      run: (...params: unknown[]) => { changes?: number; lastInsertRowid?: number | bigint };
      get: (...params: unknown[]) => unknown;
      all: (...params: unknown[]) => unknown[];
    };
  };

  constructor(dbPath: string) {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => NodeSqliteAdapter["db"] };
    this.db = new DatabaseSync(dbPath);
  }

  prepare(sql: string): SqliteStatement {
    const statement = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => {
        const result = statement.run(...params);
        return {
          changes: Number(result?.changes ?? 0),
          lastInsertRowid: result?.lastInsertRowid ?? 0
        };
      },
      get: (...params: unknown[]) => statement.get(...params),
      all: (...params: unknown[]) => statement.all(...params)
    };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(str: string, options?: { simple?: boolean }): unknown {
    const trimmed = str.trim();
    if (trimmed.includes("=")) {
      this.db.exec(`PRAGMA ${trimmed}`);
      return undefined;
    }
    const row = this.db.prepare(`PRAGMA ${trimmed}`).get();
    if (options?.simple && row && typeof row === "object") {
      return Object.values(row)[0];
    }
    return row;
  }

  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return (...args: unknown[]) => {
      this.db.exec("BEGIN");
      try {
        const result = fn(...args);
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    };
  }

  close(): void {
    if (this.db.isOpen) {
      this.db.close();
    }
  }
}

export function createDatabase(dbPath: string): SqliteDatabase {
  return new NodeSqliteAdapter(dbPath);
}