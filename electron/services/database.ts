import { createRequire } from 'node:module';
import path from 'path';
import { app } from 'electron';
import { FileItem, FileType } from '../../src/types';

const require = createRequire(import.meta.url);
const Database = require('sqlite3').Database;

export class DatabaseService {
  private db: any | null = null;
  private dbPath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'file-search.db');
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.db = new Database(this.dbPath, (err: any) => {
          if (err) {
            console.error('Database connection error:', err);
            reject(err);
            return;
          }
          console.log('Database connected successfully');
          this.createTables().then(resolve).catch(reject);
        });
      } catch (error) {
        console.error('Database initialization error:', error);
        reject(error);
      }
    });
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

    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
      CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);
      CREATE INDEX IF NOT EXISTS idx_files_size ON files(size);
      CREATE INDEX IF NOT EXISTS idx_files_date_modified ON files(dateModified);
      CREATE INDEX IF NOT EXISTS idx_files_type ON files(type);
    `;

    return new Promise((resolve, reject) => {
      this.db!.serialize(() => {
        this.db!.exec(createFilesTable, (err) => {
          if (err) reject(err);
        });
        
        this.db!.exec(createFtsTable, (err) => {
          if (err) reject(err);
        });
        
        this.db!.exec(createIndexes, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
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

    return new Promise((resolve, reject) => {
      const db = this.db!;
      db.run(sql, params, function(err) {
        if (err) {
          reject(err);
        } else {
          // Update FTS table
          const ftsSql = `INSERT OR REPLACE INTO files_fts(rowid, name, path, fullPath) VALUES (?, ?, ?, ?)`;
          const rowId = this?.lastID || 1;
          db.run(ftsSql, [rowId, file.name, file.path, file.fullPath], (ftsErr) => {
            if (ftsErr) reject(ftsErr);
            else resolve();
          });
        }
      });
    });
  }

  async insertFiles(files: FileItem[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    if (files.length === 0) return;

    console.log(`Inserting ${files.length} files into database...`);

    return new Promise((resolve, reject) => {
      const db = this.db!;

      db.serialize(() => {
        db.run('BEGIN TRANSACTION', (beginErr) => {
          if (beginErr) {
            console.error('Failed to begin transaction:', beginErr);
            reject(beginErr);
            return;
          }

          let completed = 0;
          let hasError = false;

          const processFile = (file: FileItem, index: number) => {
            if (hasError) return;

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

            const sql = `
              INSERT OR REPLACE INTO files
              (id, name, path, fullPath, extension, size, dateModified, dateCreated, isDirectory, type)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.run(sql, params, function(err) {
              if (err && !hasError) {
                hasError = true;
                console.error('Failed to insert file:', err);
                db.run('ROLLBACK');
                reject(err);
                return;
              }

              // Insert into FTS table
              const ftsRowId = index + 1; // Use index-based ID for FTS
              const ftsSql = `INSERT OR REPLACE INTO files_fts(rowid, name, path, fullPath) VALUES (?, ?, ?, ?)`;

              db.run(ftsSql, [ftsRowId, file.name, file.path, file.fullPath], (ftsErr) => {
                if (ftsErr && !hasError) {
                  hasError = true;
                  console.error('Failed to insert into FTS:', ftsErr);
                  db.run('ROLLBACK');
                  reject(ftsErr);
                  return;
                }

                completed++;
                if (completed === files.length && !hasError) {
                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      console.error('Failed to commit transaction:', commitErr);
                      reject(commitErr);
                    } else {
                      console.log(`Successfully inserted ${files.length} files`);
                      resolve();
                    }
                  });
                }
              });
            });
          };

          // Process files sequentially to avoid overwhelming the database
          files.forEach(processFile);
        });
      });
    });
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

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows: any[]) => {
        if (err) {
          console.error('Search error:', err);
          reject(err);
        } else {
          const files = rows.map(row => ({
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
          resolve(files);
        }
      });
    });
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

    const sql = 'DELETE FROM files WHERE fullPath = ?';
    
    return new Promise((resolve, reject) => {
      this.db!.run(sql, [fullPath], function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async clearAll(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.serialize(() => {
        this.db!.run('DELETE FROM files', (err) => {
          if (err) reject(err);
        });
        this.db!.run('DELETE FROM files_fts', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  async getFileCount(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.get('SELECT COUNT(*) as count FROM files', (err, row: any) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
  }

  async close(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      this.db!.close((err) => {
        if (err) reject(err);
        else {
          this.db = null;
          resolve();
        }
      });
    });
  }
}
