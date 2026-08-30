/**
 * Wire protocol between the renderer and the search engine.
 *
 * The engine runs in a `utilityProcess` and talks to renderers over a
 * `MessagePort`, so search traffic never touches the main process. Main keeps
 * only what it must own: windows, the shell verbs, and permissions.
 *
 * Three properties the old `ipcRenderer.invoke` surface could not provide:
 *
 *  - **Cancellation.** The engine tracks the newest request id per port and
 *    abandons older ones. The previous AbortController aborted nothing, since
 *    `invoke` takes no signal, so every keystroke ran to completion.
 *  - **Streaming.** First rows arrive before the full count is known, so the
 *    list paints immediately and the total lands a moment later.
 *  - **Keyset cursors.** Paging by opaque cursor rather than a numeric offset,
 *    which is what made page 2 skip rows and page 3 come back empty.
 */

export const ENGINE_PORT_CHANNEL = 'seekr:engine-port'

// --------------------------------------------------------------- requests --

export interface SearchRequest {
  kind: 'search'
  id: number
  query: string
  limit: number
  /** Opaque keyset token from a previous page. Never a numeric offset. */
  cursor?: string
  /** Ask the engine to also compute the true total. Costs one extra pass. */
  wantTotal?: boolean
}

export interface IndexStartRequest {
  kind: 'index:start'
  id: number
  paths: string[]
  excludePaths?: string[]
}

export interface SimpleRequest {
  kind: 'index:stop' | 'index:status' | 'index:count' | 'engine:stats'
  id: number
}

export interface CancelRequest {
  kind: 'cancel'
  id: number
  /** The request id being cancelled. */
  target: number
}

export type EngineRequest = SearchRequest | IndexStartRequest | SimpleRequest | CancelRequest

// -------------------------------------------------------------- responses --

export interface SearchRow {
  id: string
  name: string
  /** Directory containing the file, for display. */
  dir: string
  fullPath: string
  extension: string
  size: number
  mtimeMs: number
  isDirectory: boolean
  type: string
  /** Relevance score. Higher is better. */
  score: number
  /** [start, length] pairs into `name`, so the UI does not re-derive matches. */
  highlights: Array<[number, number]>
}

export interface SearchPage {
  kind: 'search:page'
  id: number
  rows: SearchRow[]
  /** Pass to the next request to continue. Absent when the result set ends. */
  cursor?: string
  /** Present only on the final message, and only when wantTotal was set. */
  total?: number
  /** Milliseconds spent in the engine. */
  elapsedMs: number
  done: boolean
}

export interface IndexStatus {
  kind: 'index:status'
  id: number
  isIndexing: boolean
  filesProcessed: number
  currentPath?: string
  progress: number
  /** Paths that returned EACCES/EPERM. On macOS this means missing Full Disk Access. */
  deniedPaths: string[]
}

export interface CountResponse {
  kind: 'index:count'
  id: number
  count: number
}

export interface OkResponse {
  kind: 'ok'
  id: number
}

export interface ErrorResponse {
  kind: 'error'
  id: number
  message: string
}

export interface EngineStats {
  kind: 'engine:stats'
  id: number
  fileCount: number
  databaseBytes: number
  indexedRoots: string[]
}

/** Unsolicited pushes. `id` is 0 because they answer no request. */
export interface EngineEvent {
  kind: 'event'
  id: 0
  event: 'index:progress' | 'index:complete' | 'index:error' | 'watcher:ready' | 'watcher:limit'
  payload?: unknown
}

export type EngineResponse =
  | SearchPage
  | IndexStatus
  | CountResponse
  | OkResponse
  | ErrorResponse
  | EngineStats
  | EngineEvent

/** Cursor encoding. Opaque to callers; only the engine reads it. */
export function encodeCursor(score: number, rowid: number): string {
  return Buffer.from(`${score}:${rowid}`).toString('base64url')
}

export function decodeCursor(cursor: string): { score: number; rowid: number } | null {
  try {
    const [score, rowid] = Buffer.from(cursor, 'base64url').toString('utf8').split(':')
    const parsed = { score: Number(score), rowid: Number(rowid) }
    return Number.isFinite(parsed.score) && Number.isFinite(parsed.rowid) ? parsed : null
  } catch {
    return null
  }
}
