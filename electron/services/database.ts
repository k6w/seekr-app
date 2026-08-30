import { createRequire } from 'node:module';
import path from 'path';
import { app } from 'electron';
import type BetterSqlite3 from 'better-sqlite3';
import { FileItem, FileType, SearchFilters } from '../../src/types';

/** Shape of a row in the `files` table, as SQLite returns it. */
interface FileRow {
  id: string;
  name: string;
  path: string;
  fullPath: string;
  extension: string;
  size: number;
  dateModified: number;
  dateCreated: number;
  isDirectory: number;
  type: string;
  demoted: number;
}

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

/** Escapes LIKE wildcards so a query containing % or _ matches literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => '\\' + character);
}

function rowToFileItem(row: FileRow): FileItem {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    fullPath: row.fullPath,
    extension: row.extension,
    size: row.size,
    dateModified: new Date(row.dateModified),
    dateCreated: new Date(row.dateCreated),
    isDirectory: row.isDirectory === 1,
    type: row.type as FileType,
    demoted: row.demoted === 1,
  };
}

export class DatabaseService {
  private db: BetterSqlite3.Database | null = null;
  /** Cached because `hasPath` runs on every open/reveal. Invalidated on close. */
  private hasPathStmt: BetterSqlite3.Statement | null = null;
  private dbPath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'file-search.db');
  }

  async initialize(): Promise<void> {
    try {
      const db = new Database(this.dbPath) as BetterSqlite3.Database;
      this.db = db;

      // WAL, plus the pragmas that were missing entirely. With the default
      // synchronous=FULL, WAL still fsyncs on every transaction, which
      // dominates bulk-insert time; NORMAL is the documented safe pairing.
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('temp_store = MEMORY');
      db.pragma('cache_size = -64000'); // 64 MB
      db.pragma('mmap_size = 268435456'); // 256 MB

      await this.createTables();
    } catch (error) {
      console.error('Database initialization error:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const createFilesTable = `
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        fullPath TEXT NOT NULL UNIQUE,
        extension TEXT,
        size INTEGER,
        dateModified INTEGER,
        dateCreated INTEGER,
        isDirectory INTEGER,
        type TEXT,
        demoted INTEGER NOT NULL DEFAULT 0
      )
    `;

    const createIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_files_path ON files(path)',
      'CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension)',
      'CREATE INDEX IF NOT EXISTS idx_files_size ON files(size)',
      'CREATE INDEX IF NOT EXISTS idx_files_date_modified ON files(dateModified)',
      'CREATE INDEX IF NOT EXISTS idx_files_type ON files(type)',
      // The most-searched column had no index at all.
      'CREATE INDEX IF NOT EXISTS idx_files_name ON files(name COLLATE NOCASE)'
    ];

    try {
      this.db.exec(createFilesTable);
      this.migrate();

      for (const indexSql of createIndexes) {
        this.db.exec(indexSql);
      }
    } catch (error) {
      console.error('Error creating tables:', error);
      throw error;
    }
  }

  /**
   * Schema migrations for databases created by earlier versions.
   *
   * The files_fts external-content table is dropped rather than repaired: it
   * was never queried (no MATCH existed anywhere in the codebase), it was
   * written with plain INSERT OR REPLACE, which is invalid for content='files'
   * and desynced it immediately, and clearAll() deleted the content table
   * before the index -- the textbook way to corrupt one. It cost a second
   * write on every insert for nothing. Phase 1 rebuilds it with the trigram
   * tokenizer and actually queries it.
   */
  private migrate(): void {
    if (!this.db) return;

    try {
      this.db.exec('DROP TABLE IF EXISTS files_fts');
    } catch (error) {
      console.warn('Could not drop legacy FTS table:', error);
    }

    try {
      const columns = this.db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'demoted')) {
        this.db.exec('ALTER TABLE files ADD COLUMN demoted INTEGER NOT NULL DEFAULT 0');
      }
    } catch (error) {
      console.warn('Could not migrate files table:', error);
    }
  }

  /**
   * Single-row insert, used by the file watcher.
   * Delegates to insertFiles so there is exactly one INSERT statement in the
   * codebase. The old version prepared two fresh statements on every call --
   * once per filesystem event -- with no caching and no transaction.
   */
  async insertFile(file: FileItem): Promise<void> {
    await this.insertFiles([file]);
  }

  async insertFiles(files: FileItem[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    if (files.length === 0) return;

    // Single statement, single transaction, no second write to a dead FTS
    // index. Halving the writes per row roughly halves bulk-insert time.
    const sql = `
      INSERT OR REPLACE INTO files
      (id, name, path, fullPath, extension, size, dateModified, dateCreated, isDirectory, type, demoted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    try {
      const stmt = this.db.prepare(sql);
      const insertAll = this.db.transaction((rows: FileItem[]) => {
        for (const file of rows) {
          stmt.run([
            file.id,
            file.name,
            file.path,
            file.fullPath,
            file.extension || '',
            file.size || 0,
            file.dateModified instanceof Date ? file.dateModified.getTime() : Date.now(),
            file.dateCreated instanceof Date ? file.dateCreated.getTime() : Date.now(),
            file.isDirectory ? 1 : 0,
            file.type || 'other',
            file.demoted ? 1 : 0,
          ]);
        }
      });

      insertAll(files);
    } catch (error) {
      console.error('Failed to insert files:', error);
      throw error;
    }
  }
  /**
   * Filtered, ordered, counted search.
   *
   * Fixes three bugs that made the old search actively wrong:
   *
   *  1. Filters are applied in SQL. They used to be applied in JavaScript
   *     AFTER the SQL LIMIT, so `type:image` returned "images among the first
   *     100 rows alphabetically" -- usually none.
   *  2. `totalCount` is a real COUNT(*) over the whole match set. It used to
   *     report `results.length`, i.e. the page size, capped at 100, so
   *     `Math.ceil(totalCount / itemsPerPage)` could never exceed 2 pages.
   *  3. LIMIT/OFFSET are applied exactly once, here. The caller used to slice
   *     by the absolute offset a second time on an already-offset window, so
   *     page 2 silently skipped 50 results and page 3 onward was always empty.
   *
   * Ordering is done in SQL over the full match set rather than by re-ranking
   * an arbitrary page in JS. Real relevance ranking arrives with the engine
   * rewrite; ordering a correct set beats ranking a wrong one.
   */
  async searchFiles(
    query: string,
    filters: SearchFilters = {},
    limit = 100,
    offset = 0
  ): Promise<{ items: FileItem[]; totalCount: number }> {
    if (!this.db) throw new Error('Database not initialized');

    const conditions: string[] = [];
    const params: unknown[] = [];
    const text = query.trim();

    if (text) {
      // Still a leading-wildcard LIKE, so still a table scan. The FTS5 trigram
      // index that removes the scan lands with the engine rewrite; this pass
      // is about correctness of the result SET, not its speed.
      conditions.push('(name LIKE ? ESCAPE \'\\\' OR fullPath LIKE ? ESCAPE \'\\\')');
      const like = `%${escapeLike(text)}%`;
      params.push(like, like);
    }

    if (filters.fileTypes?.length) {
      conditions.push(`type IN (${filters.fileTypes.map(() => '?').join(', ')})`);
      params.push(...filters.fileTypes);
    }

    if (filters.extensions?.length) {
      const normalized = filters.extensions.map((extension) =>
        extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`
      );
      conditions.push(`extension IN (${normalized.map(() => '?').join(', ')})`);
      params.push(...normalized);
    }

    if (typeof filters.sizeMin === 'number' && Number.isFinite(filters.sizeMin)) {
      conditions.push('size >= ?');
      params.push(filters.sizeMin);
    }
    if (typeof filters.sizeMax === 'number' && Number.isFinite(filters.sizeMax)) {
      conditions.push('size <= ?');
      params.push(filters.sizeMax);
    }

    if (filters.dateModifiedFrom) {
      conditions.push('dateModified >= ?');
      params.push(new Date(filters.dateModifiedFrom).getTime());
    }
    if (filters.dateModifiedTo) {
      conditions.push('dateModified <= ?');
      params.push(new Date(filters.dateModifiedTo).getTime());
    }

    if (filters.includeDirectories === false) {
      conditions.push('isDirectory = 0');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      const totalCount = (
        this.db.prepare(`SELECT COUNT(*) as count FROM files ${where}`).get(...params) as {
          count: number;
        }
      ).count;

      // Relevance proxy evaluated over the whole match set, before LIMIT:
      // exact name, then prefix, then substring in the name, then path-only.
      // Demoted rows (node_modules, .git, build output) sink within each tier.
      const orderParams: unknown[] = [];
      let relevance = '0';
      if (text) {
        const lowered = text.toLowerCase();
        relevance = `
          CASE
            WHEN LOWER(name) = ? THEN 0
            WHEN LOWER(name) LIKE ? ESCAPE '\\' THEN 1
            WHEN LOWER(name) LIKE ? ESCAPE '\\' THEN 2
            ELSE 3
          END`;
        orderParams.push(lowered, `${escapeLike(lowered)}%`, `%${escapeLike(lowered)}%`);
      }

      const rows = this.db
        .prepare(
          `SELECT * FROM files ${where}
           ORDER BY ${relevance}, demoted ASC, LENGTH(name) ASC, name COLLATE NOCASE
           LIMIT ? OFFSET ?`
        )
        .all(...params, ...orderParams, limit, offset) as FileRow[];

      return { items: rows.map(rowToFileItem), totalCount };
    } catch (error) {
      console.error('Search error:', error);
      throw error;
    }
  }

  async deleteFile(fullPath: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const stmt = this.db.prepare('DELETE FROM files WHERE fullPath = ?');
      stmt.run([fullPath]);
    } catch (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  }

  async clearAll(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.exec('DELETE FROM files');
    } catch (error) {
      console.error('Error clearing database:', error);
      throw error;
    }
  }

  async getFileCount(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM files');
      const row = stmt.get() as { count: number };
      return row.count;
    } catch (error) {
      console.error('Error getting file count:', error);
      throw error;
    }
  }

  /**
   * Exact-path membership test.
   *
   * This is the allowlist `PathGuard` consults before any `shell` action, so
   * it must be cheap and must never throw: a lookup failure has to read as
   * "not indexed" (deny), not as an exception that bubbles into the handler.
   */
  hasPath(fullPath: string): boolean {
    if (!this.db) return false;

    try {
      if (!this.hasPathStmt) {
        this.hasPathStmt = this.db.prepare('SELECT 1 FROM files WHERE fullPath = ? LIMIT 1');
      }
      return this.hasPathStmt.get(fullPath) !== undefined;
    } catch (error) {
      console.error('Error checking indexed path:', error);
      return false;
    }
  }

  async close(): Promise<void> {
    if (!this.db) return;

    try {
      this.db.close();
      this.hasPathStmt = null;
      this.db = null;
    } catch (error) {
      console.error('Error closing database:', error);
      throw error;
    }
  }
}
