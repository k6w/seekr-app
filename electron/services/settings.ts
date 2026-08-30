import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Main-process settings store.
 *
 * Settings used to live entirely in renderer `localStorage`, which meant the
 * main process had no durable record of which roots the user had indexed --
 * and `PathGuard` needs exactly that to decide whether a path is safe to open.
 * Renderer storage is also wiped by a cache clear and writable by any script in
 * the renderer, so it is the wrong owner for a security-relevant allowlist.
 *
 * Writes are atomic (temp file + rename) so a crash mid-write cannot leave a
 * truncated JSON file that fails to parse on next launch.
 */

export interface SeekrSettings {
  indexedPaths: string[]
  excludedPaths: string[]
  theme: 'light' | 'dark' | 'system'
  searchResultsLimit: number
  enableFuzzySearch: boolean
  globalHotkey: string
}

export const DEFAULT_SETTINGS: SeekrSettings = {
  indexedPaths: [],
  excludedPaths: [],
  theme: 'system',
  searchResultsLimit: 100,
  enableFuzzySearch: true,
  globalHotkey: 'CmdOrCtrl+Shift+F',
}

/** Coerces unknown JSON into a valid settings object, field by field. */
export function normalizeSettings(input: unknown): SeekrSettings {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []

  const theme = raw.theme
  const limit = Number(raw.searchResultsLimit)

  return {
    indexedPaths: strings(raw.indexedPaths),
    excludedPaths: strings(raw.excludedPaths),
    theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : DEFAULT_SETTINGS.theme,
    searchResultsLimit:
      Number.isFinite(limit) && limit > 0 && limit <= 1000
        ? Math.floor(limit)
        : DEFAULT_SETTINGS.searchResultsLimit,
    enableFuzzySearch:
      typeof raw.enableFuzzySearch === 'boolean'
        ? raw.enableFuzzySearch
        : DEFAULT_SETTINGS.enableFuzzySearch,
    globalHotkey:
      typeof raw.globalHotkey === 'string' && raw.globalHotkey.trim().length > 0
        ? raw.globalHotkey
        : DEFAULT_SETTINGS.globalHotkey,
  }
}

export class SettingsStore {
  private readonly file: string
  private cache: SeekrSettings

  constructor(filePath?: string) {
    this.file = filePath ?? path.join(app.getPath('userData'), 'settings.json')
    this.cache = this.read()
  }

  private read(): SeekrSettings {
    try {
      return normalizeSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')))
    } catch {
      // Missing or corrupt: fall back to defaults rather than failing to boot.
      return { ...DEFAULT_SETTINGS }
    }
  }

  get(): Readonly<SeekrSettings> {
    return this.cache
  }

  update(patch: Partial<SeekrSettings>): SeekrSettings {
    this.cache = normalizeSettings({ ...this.cache, ...patch })
    const tmp = `${this.file}.${process.pid}.tmp`
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (error) {
      try {
        fs.rmSync(tmp, { force: true })
      } catch {
        // best effort
      }
      throw error
    }
    return this.cache
  }
}
