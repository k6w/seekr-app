import type {
  EngineRequest,
  EngineResponse,
  SearchPage,
  SearchRow,
} from './protocol'

/**
 * Renderer-side engine client. Lives in the preload, which owns the
 * MessagePort -- a port cannot cross contextBridge, so the bridge exposes
 * functions over it rather than the port itself.
 */

export interface SearchResultPage {
  rows: SearchRow[]
  cursor?: string
  total?: number
  elapsedMs: number
}

export interface EngineEvents {
  onIndexProgress(cb: (status: IndexProgressPayload) => void): () => void
  onIndexComplete(cb: (payload: { count: number; deniedPaths: string[] }) => void): () => void
  onIndexError(cb: (message: string) => void): () => void
  onWatcherLimit(cb: (root: string) => void): () => void
}

export interface IndexProgressPayload {
  isIndexing: boolean
  filesProcessed: number
  currentPath?: string
  progress: number
  deniedPaths: string[]
}

/** Omit distributes over the union; a bare Omit collapses it to the common keys. */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

type Pending = {
  resolve: (value: never) => void
  reject: (error: Error) => void
}

export class EngineClient {
  private port: MessagePort | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private listeners = new Map<string, Set<(payload: never) => void>>()
  private queued: EngineRequest[] = []

  /** The most recent search id, so stale replies can be dropped. */
  private latestSearchId = 0

  attach(port: MessagePort): void {
    this.port = port
    port.onmessage = (event: MessageEvent<EngineResponse>) => this.receive(event.data)
    port.start?.()

    // Anything issued before the port arrived.
    for (const request of this.queued.splice(0)) port.postMessage(request)
  }

  get connected(): boolean {
    return this.port !== null
  }

  private receive(message: EngineResponse): void {
    if (message.kind === 'event') {
      const handlers = this.listeners.get(message.event)
      if (handlers) for (const handler of handlers) handler(message.payload as never)
      return
    }

    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)

    if (message.kind === 'error') pending.reject(new Error(message.message))
    else pending.resolve(message as never)
  }

  private request<T extends EngineResponse>(request: WithoutId<EngineRequest>): Promise<T> {
    const id = this.nextId++
    const full = { ...request, id } as EngineRequest

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: never) => void, reject })

      if (this.port) this.port.postMessage(full)
      else this.queued.push(full)

      // A request that never gets an answer must not leak its entry forever.
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('Engine did not respond'))
      }, 30_000)
    })
  }

  /**
   * Issues a search, implicitly cancelling any earlier in-flight one.
   *
   * The previous implementation created an AbortController per search that
   * aborted nothing, because `ipcRenderer.invoke` takes no signal -- so every
   * keystroke ran to completion in the main process, and a slow earlier reply
   * could overwrite newer results.
   */
  async search(
    query: string,
    options: { limit: number; cursor?: string; wantTotal?: boolean } = { limit: 50 },
  ): Promise<SearchResultPage> {
    const id = this.nextId
    this.latestSearchId = id

    const page = await this.request<SearchPage>({
      kind: 'search',
      query,
      limit: options.limit,
      cursor: options.cursor,
      wantTotal: options.wantTotal,
    })

    // A newer search started while this was in flight.
    if (id < this.latestSearchId && !options.cursor) {
      return { rows: [], elapsedMs: page.elapsedMs }
    }

    return { rows: page.rows, cursor: page.cursor, total: page.total, elapsedMs: page.elapsedMs }
  }

  async startIndexing(paths: string[], excludePaths: string[] = []): Promise<void> {
    await this.request({ kind: 'index:start', paths, excludePaths })
  }

  async stopIndexing(): Promise<void> {
    await this.request({ kind: 'index:stop' })
  }

  async count(): Promise<number> {
    const response = await this.request<{ kind: 'index:count'; id: number; count: number }>({
      kind: 'index:count',
    })
    return response.count
  }

  async stats(): Promise<{ fileCount: number; databaseBytes: number; indexedRoots: string[] }> {
    const response = await this.request<{
      kind: 'engine:stats'
      id: number
      fileCount: number
      databaseBytes: number
      indexedRoots: string[]
    }>({ kind: 'engine:stats' })
    return {
      fileCount: response.fileCount,
      databaseBytes: response.databaseBytes,
      indexedRoots: response.indexedRoots,
    }
  }

  on(event: string, handler: (payload: never) => void): () => void {
    let handlers = this.listeners.get(event)
    if (!handlers) {
      handlers = new Set()
      this.listeners.set(event, handlers)
    }
    handlers.add(handler)
    return () => {
      handlers.delete(handler)
    }
  }
}
