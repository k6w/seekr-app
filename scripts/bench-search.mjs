#!/usr/bin/env node
/**
 * Measures the new trigram-indexed search against the LIKE scan it replaces.
 *
 * The old query was `name LIKE '%q%' OR path LIKE '%q%' OR fullPath LIKE '%q%'`
 * -- three leading-wildcard comparisons, which no index can serve, over every
 * row, on every keystroke. This builds one corpus and runs both against it.
 *
 *   node scripts/bench-search.mjs [rowCount]
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const ROWS = Number(process.argv[2] ?? 500_000)
const QUERIES = ['report', 'index', 'config', 'test', 'invoice', 'backup', 'notes', 'draft']

const WORDS = [
  'report', 'invoice', 'summary', 'draft', 'final', 'backup', 'archive', 'notes',
  'config', 'index', 'main', 'utils', 'helper', 'service', 'client', 'server',
  'project', 'budget', 'meeting', 'agenda', 'photo', 'screenshot', 'export',
  'quarterly', 'annual', 'monthly', 'analysis', 'proposal', 'contract', 'test',
]
const DIRS = [
  'Documents', 'Downloads', 'Desktop', 'Projects/app/src', 'Projects/app/lib',
  'Projects/site/components', 'Media/Photos', 'Media/Videos', 'Work/2026/Q1',
  'Work/2026/Q2', 'Archive/old', 'node_modules/react/lib',
]
const EXTS = ['.txt', '.pdf', '.md', '.js', '.ts', '.png', '.jpg', '.docx', '.json', '.csv']

// Deterministic, so runs are comparable.
let seed = 42
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = (list) => list[Math.floor(random() * list.length)]

function makeRow(i) {
  const name = `${pick(WORDS)}-${pick(WORDS)}-${i % 9973}${pick(EXTS)}`
  const dir = `/Users/bench/${pick(DIRS)}`
  return { name, dir, fullPath: `${dir}/${name}` }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seekr-bench-'))
const dbPath = path.join(dir, 'bench.db')
const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('temp_store = MEMORY')
db.pragma('cache_size = -64000')

db.exec(`
  CREATE TABLE files (
    rowid INTEGER PRIMARY KEY,
    name TEXT NOT NULL, nameLower TEXT NOT NULL,
    dir TEXT NOT NULL, fullPath TEXT NOT NULL, fullPathLower TEXT NOT NULL
  );
  CREATE INDEX idx_name ON files(nameLower);
  CREATE VIRTUAL TABLE files_fts USING fts5(
    nameLower, fullPathLower, content='files', content_rowid='rowid', tokenize='trigram'
  );
`)

const timed = (label, fn) => {
  const started = performance.now()
  const result = fn()
  const ms = performance.now() - started
  console.log(`  ${label.padEnd(42)} ${ms.toFixed(1).padStart(9)} ms`)
  return result
}

console.log(`\nBuilding a ${ROWS.toLocaleString()}-row corpus in ${dbPath}\n`)

const insert = db.prepare(
  'INSERT INTO files (name, nameLower, dir, fullPath, fullPathLower) VALUES (?, ?, ?, ?, ?)',
)
timed('insert rows (FTS deferred)', () => {
  const run = db.transaction(() => {
    for (let i = 0; i < ROWS; i++) {
      const row = makeRow(i)
      insert.run(row.name, row.name.toLowerCase(), row.dir, row.fullPath, row.fullPath.toLowerCase())
    }
  })
  run()
})

timed('build trigram index (one rebuild)', () => {
  db.exec(`INSERT INTO files_fts(files_fts) VALUES('rebuild')`)
  db.exec('ANALYZE')
})

const pageBytes = db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true })
console.log(`\n  database size: ${(pageBytes / 1024 / 1024).toFixed(1)} MB\n`)

/**
 * Three shapes, because they stress the index very differently:
 *
 *  1. A common term with LIMIT. A LIKE scan can stop as soon as it has filled
 *     the page, so this is the case where LIKE looks fine -- and it is.
 *  2. A term that matches nothing. The scan cannot stop early and has to walk
 *     every row. This happens constantly in a search-as-you-type UI, on the way
 *     to a term that does match.
 *  3. The true match count, which the UI needs for "N results" and which the
 *     old code faked by reporting the page size.
 */
const likePage = db.prepare(`
  SELECT rowid FROM files
  WHERE nameLower LIKE :like OR fullPathLower LIKE :like
  LIMIT 60
`)
const ftsPage = db.prepare(`
  SELECT f.rowid FROM files f
  JOIN files_fts ON files_fts.rowid = f.rowid AND files_fts MATCH :match
  LIMIT 60
`)
const likeCount = db.prepare(`
  SELECT COUNT(*) AS c FROM files
  WHERE nameLower LIKE :like OR fullPathLower LIKE :like
`)
const ftsCount = db.prepare(`
  SELECT COUNT(*) AS c FROM files f
  JOIN files_fts ON files_fts.rowid = f.rowid AND files_fts MATCH :match
`)

const MISSES = ['zqxjkv', 'wgblmp', 'vnhtrz', 'kpxwqd', 'jmzbvx', 'qrtzwn', 'xlvkph', 'bnqwzj']

function measure(label, terms, run) {
  run(terms[0]) // warm
  const samples = terms
    .map((term) => {
      const started = performance.now()
      run(term)
      return performance.now() - started
    })
    .sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]
  console.log(`  ${label.padEnd(46)} ${median.toFixed(2).padStart(9)} ms`)
  return median
}

console.log('Median over 8 distinct terms:\n')

console.log(' -- common term, first page only (LIKE can stop early) --')
const likeHit = measure('LIKE scan', QUERIES, (q) => likePage.all({ like: `%${q}%` }))
const ftsHit = measure('FTS5 trigram', QUERIES, (q) => ftsPage.all({ match: `"${q}"` }))
console.log(`  -> ${(likeHit / ftsHit).toFixed(1)}x\n`)

console.log(' -- term that matches nothing (no early exit) --')
const likeMiss = measure('LIKE scan', MISSES, (q) => likePage.all({ like: `%${q}%` }))
const ftsMiss = measure('FTS5 trigram', MISSES, (q) => ftsPage.all({ match: `"${q}"` }))
console.log(`  -> ${(likeMiss / ftsMiss).toFixed(0)}x\n`)

console.log(' -- true result count (what the UI shows) --')
const likeTotal = measure('LIKE COUNT(*)', QUERIES, (q) => likeCount.get({ like: `%${q}%` }))
const ftsTotal = measure('FTS5 COUNT(*)', QUERIES, (q) => ftsCount.get({ match: `"${q}"` }))
console.log(`  -> ${(likeTotal / ftsTotal).toFixed(0)}x\n`)

db.close()
fs.rmSync(dir, { recursive: true, force: true })
