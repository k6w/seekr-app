import { createRequire } from 'node:module'
import fs from 'node:fs'
import type BetterSqlite3 from 'better-sqlite3'
import log from 'electron-log/main'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

/**
 * Read-only membership lookup against the engine's database.
 *
 * The path guard runs in the main process (that is where `shell` lives), but
 * the index is owned by the engine process. Rather than round-tripping every
 * open/reveal through the engine, main opens its own read-only connection:
 * WAL supports concurrent readers alongside the engine's writer, and the check
 * is a single indexed lookup.
 *
 * Every failure path answers "not indexed", so a missing or locked database
 * denies the action rather than letting an unvalidated path through.
 */
export class IndexReader {
  private db: BetterSqlite3.Database | null = null
  private statement: BetterSqlite3.Statement | null = null

  constructor(private readonly databasePath: string) {}

  private connect(): boolean {
    if (this.db) return true
    // Opening read-only would throw if the engine has not created the file yet.
    if (!fs.existsSync(this.databasePath)) return false

    try {
      this.db = new Database(this.databasePath, { readonly: true }) as BetterSqlite3.Database
      this.statement = this.db.prepare('SELECT 1 FROM files WHERE fullPath = ? LIMIT 1')
      return true
    } catch (error) {
      log.warn('IndexReader could not open the database:', error)
      this.db = null
      this.statement = null
      return false
    }
  }

  async has(fullPath: string): Promise<boolean> {
    if (!this.connect() || !this.statement) return false
    try {
      return this.statement.get(fullPath) !== undefined
    } catch (error) {
      // The engine may have rebuilt the schema underneath us; reconnect once.
      log.warn('IndexReader lookup failed, reconnecting:', error)
      this.close()
      if (!this.connect() || !this.statement) return false
      try {
        return this.statement.get(fullPath) !== undefined
      } catch {
        return false
      }
    }
  }

  close(): void {
    try {
      this.db?.close()
    } catch {
      // best effort
    }
    this.db = null
    this.statement = null
  }
}
