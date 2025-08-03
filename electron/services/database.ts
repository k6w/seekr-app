import { createRequire } from 'node:module';
import path from 'path';
import { app } from 'electron';
import { FileItem, FileType } from '../../src/types';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

export class DatabaseService {
  private db: any | null = null;
  private dbPath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'file-search.db');
  }

  async initialize(): Promise<void> {
    try {
      this.db = new Database(this.dbPath);
      console.log('Database connected successfully');

      // Enable WAL mode for better performance
      this.db.pragma('journal_mode = WAL');

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
        type TEXT
      )
    `;

    const createFtsTable = `
      CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
        name,
        path,
        fullPath,
        content='files',
        content_rowid='rowid'
      )
    `;

    const createIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_files_path ON files(path)',
      'CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension)',
      'CREATE INDEX IF NOT EXISTS idx_files_size ON files(size)',
      'CREATE INDEX IF NOT EXISTS idx_files_date_modified ON files(dateModified)',
      'CREATE INDEX IF NOT EXISTS idx_files_type ON files(type)'
    ];

    try {
      this.db.exec(createFilesTable);
      this.db.exec(createFtsTable);

      for (const indexSql of createIndexes) {
        this.db.exec(indexSql);
      }
    } catch (error) {
      console.error('Error creating tables:', error);
      throw error;
    }
  }

  async insertFile(file: FileItem): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const sql = `
      INSERT OR REPLACE INTO files
      (id, name, path, fullPath, extension, size, dateModified, dateCreated, isDirectory, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      file.id,
      file.name,
      file.path,
      file.fullPath,
      file.extension,
      file.size,
      file.dateModified instanceof Date ? file.dateModified.getTime() : Date.now(),
      file.dateCreated instanceof Date ? file.dateCreated.getTime() : Date.now(),
      file.isDirectory ? 1 : 0,
      file.type
    ];

    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(params);

      // Update FTS table
      const ftsSql = `INSERT OR REPLACE INTO files_fts(rowid, name, path, fullPath) VALUES (?, ?, ?, ?)`;
      const ftsStmt = this.db.prepare(ftsSql);
      ftsStmt.run([result.lastInsertRowid || 1, file.name, file.path, file.fullPath]);
    } catch (error) {
      console.error('Error inserting file:', error);
      throw error;
    }
  }

  async insertFiles(files: FileItem[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    if (files.length === 0) return;

    console.log(`Inserting ${files.length} files into database...`);

    const sql = `
      INSERT OR REPLACE INTO files
      (id, name, path, fullPath, extension, size, dateModified, dateCreated, isDirectory, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const ftsSql = `INSERT OR REPLACE INTO files_fts(rowid, name, path, fullPath) VALUES (?, ?, ?, ?)`;

    try {
      const stmt = this.db.prepare(sql);
      const ftsStmt = this.db.prepare(ftsSql);

      const transaction = this.db.transaction((files: FileItem[]) => {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const params = [
            file.id,
            file.name,
            file.path,
            file.fullPath,
            file.extension || '',
            file.size || 0,
            file.dateModified instanceof Date ? file.dateModified.getTime() : Date.now(),
            file.dateCreated instanceof Date ? file.dateCreated.getTime() : Date.now(),
            file.isDirectory ? 1 : 0,
            file.type || 'unknown'
          ];

          const result = stmt.run(params);
          ftsStmt.run([result.lastInsertRowid || (i + 1), file.name, file.path, file.fullPath]);
        }
      });

      transaction(files);
      console.log(`Successfully inserted ${files.length} files`);
    } catch (error) {
      console.error('Failed to insert files:', error);
      throw error;
    }
  }

  async searchFiles(query: string, limit: number = 100, offset: number = 0): Promise<FileItem[]> {
    if (!this.db) throw new Error('Database not initialized');

    // Parse search operators
    const searchTerms = this.parseSearchQuery(query);

    let sql: string;
    let params: any[];
    let whereConditions: string[] = [];
    let sqlParams: any[] = [];

    // Handle different search operators
    if (searchTerms.type) {
      whereConditions.push('type = ?');
      sqlParams.push(searchTerms.type);
    }

    if (searchTerms.extension) {
      whereConditions.push('extension = ?');
      sqlParams.push(searchTerms.extension.startsWith('.') ? searchTerms.extension : '.' + searchTerms.extension);
    }

    if (searchTerms.size) {
      const sizeCondition = this.parseSizeQuery(searchTerms.size);
      if (sizeCondition) {
        whereConditions.push(sizeCondition.condition);
        sqlParams.push(...sizeCondition.params);
      }
    }

    // Always use LIKE search for reliability - it's simpler and more predictable
    if (searchTerms.text) {
      const likeQuery = `%${searchTerms.text}%`;
      whereConditions.push('(name LIKE ? OR path LIKE ? OR fullPath LIKE ?)');
      sqlParams.push(likeQuery, likeQuery, likeQuery);
    }

    if (whereConditions.length > 0) {
      sql = `
        SELECT * FROM files
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY
          CASE WHEN isDirectory = 1 THEN 0 ELSE 1 END,
          name COLLATE NOCASE
        LIMIT ? OFFSET ?
      `;
      params = [...sqlParams, limit, offset];
    } else {
      // No search terms, return all files
      sql = `
        SELECT * FROM files
        ORDER BY
          CASE WHEN isDirectory = 1 THEN 0 ELSE 1 END,
          name COLLATE NOCASE
        LIMIT ? OFFSET ?
      `;
      params = [limit, offset];
    }

    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(params);

      const files = rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        path: row.path,
        fullPath: row.fullPath,
        extension: row.extension,
        size: row.size,
        dateModified: new Date(row.dateModified),
        dateCreated: new Date(row.dateCreated),
        isDirectory: row.isDirectory === 1,
        type: row.type as FileType
      }));

      return files;
    } catch (error) {
      console.error('Search error:', error);
      throw error;
    }
  }

  private parseSearchQuery(query: string): {
    text?: string;
    type?: string;
    extension?: string;
    size?: string;
  } {
    const terms: any = {};
    const parts = query.split(/\s+/);
    const textParts: string[] = [];

    for (const part of parts) {
      if (part.startsWith('type:')) {
        const typeValue = part.substring(5).toLowerCase();
        // Map common type aliases to our FileType enum values
        switch (typeValue) {
          case 'image':
          case 'img':
          case 'picture':
            terms.type = 'IMAGE';
            break;
          case 'video':
          case 'movie':
            terms.type = 'VIDEO';
            break;
          case 'audio':
          case 'music':
          case 'sound':
            terms.type = 'AUDIO';
            break;
          case 'document':
          case 'doc':
          case 'text':
            terms.type = 'DOCUMENT';
            break;
          case 'archive':
          case 'zip':
          case 'compressed':
            terms.type = 'ARCHIVE';
            break;
          case 'folder':
          case 'directory':
          case 'dir':
            terms.type = 'DIRECTORY';
            break;
          default:
            terms.type = typeValue.toUpperCase();
        }
      } else if (part.startsWith('ext:')) {
        terms.extension = part.substring(4);
      } else if (part.startsWith('size:')) {
        terms.size = part.substring(5);
      } else {
        textParts.push(part);
      }
    }

    if (textParts.length > 0) {
      terms.text = textParts.join(' ');
    }

    return terms;
  }

  private parseSizeQuery(sizeQuery: string): { condition: string; params: any[] } | null {
    const match = sizeQuery.match(/^([<>]=?)?(\d+(?:\.\d+)?)(kb|mb|gb|tb)?$/i);
    if (!match) return null;

    const [, operator = '=', value, unit = 'b'] = match;
    const multipliers = {
      b: 1,
      kb: 1024,
      mb: 1024 * 1024,
      gb: 1024 * 1024 * 1024,
      tb: 1024 * 1024 * 1024 * 1024
    };

    const bytes = parseFloat(value) * multipliers[unit.toLowerCase() as keyof typeof multipliers];

    let condition: string;
    switch (operator) {
      case '>':
        condition = 'size > ?';
        break;
      case '>=':
        condition = 'size >= ?';
        break;
      case '<':
        condition = 'size < ?';
        break;
      case '<=':
        condition = 'size <= ?';
        break;
      default:
        condition = 'size = ?';
    }

    return { condition, params: [bytes] };
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
      this.db.exec('DELETE FROM files_fts');
    } catch (error) {
      console.error('Error clearing database:', error);
      throw error;
    }
  }

  async getFileCount(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM files');
      const row = stmt.get() as any;
      return row.count;
    } catch (error) {
      console.error('Error getting file count:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.db) return;

    try {
      this.db.close();
      this.db = null;
    } catch (error) {
      console.error('Error closing database:', error);
      throw error;
    }
  }
}
