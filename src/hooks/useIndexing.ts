import { useCallback, useEffect, useRef, useState } from 'react'
import type { IndexProgressPayload } from '../../electron/ipc/api'

export interface UseIndexingOptions {
  onComplete?: (fileCount: number, deniedPaths: string[]) => void
  onError?: (message: string) => void
}

/**
 * Indexing state, driven by events from the engine process.
 *
 * The subscriptions mount once. Previously this lived inline in App.tsx inside
 * an effect whose dependency array included a non-memoised `addNotification`,
 * so all eight IPC listeners were torn down and re-registered on every render
 * -- and indexing progress causes renders, so a crawl thrashed continuously.
 */
export function useIndexing(options: UseIndexingOptions = {}) {
  const [isIndexing, setIsIndexing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [fileCount, setFileCount] = useState(0)
  const [currentPath, setCurrentPath] = useState<string | undefined>()
  const [deniedPaths, setDeniedPaths] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const callbacks = useRef(options)
  callbacks.current = options

  const refreshCount = useCallback(async () => {
    try {
      const count = await window.seekr.index.count()
      setFileCount(count)
      return count
    } catch {
      return 0
    }
  }, [])

  useEffect(() => {
    // The engine port may not have arrived yet on first paint.
    const timer = setTimeout(() => void refreshCount(), 250)

    const unsubscribers = [
      window.seekr.events.onIndexProgress((status: IndexProgressPayload) => {
        setIsIndexing(status.isIndexing)
        setProgress(status.progress)
        setCurrentPath(status.currentPath)
        if (status.filesProcessed) setFileCount(status.filesProcessed)
        if (status.deniedPaths.length > 0) setDeniedPaths(status.deniedPaths)
      }),

      window.seekr.events.onIndexComplete(({ count, deniedPaths: denied }) => {
        setIsIndexing(false)
        setProgress(100)
        setFileCount(count)
        setDeniedPaths(denied)
        callbacks.current.onComplete?.(count, denied)
      }),

      window.seekr.events.onIndexError((message: string) => {
        setIsIndexing(false)
        setError(message)
        callbacks.current.onError?.(message)
      }),
    ]

    return () => {
      clearTimeout(timer)
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [refreshCount])

  /**
   * Starts a crawl. With no paths, main picks platform-correct defaults -- the
   * old renderer branched on `process.platform`, which is undefined under
   * contextIsolation, and fell back to `['/home', '/Users']`.
   */
  const startIndexing = useCallback(
    async (paths?: string[]) => {
      if (isIndexing) return
      setError(null)
      setProgress(0)
      setIsIndexing(true)
      try {
        await window.seekr.index.start(paths)
      } catch (err) {
        setIsIndexing(false)
        const message = err instanceof Error ? err.message : 'Indexing failed to start'
        setError(message)
        callbacks.current.onError?.(message)
      }
    },
    [isIndexing],
  )

  const stopIndexing = useCallback(async () => {
    await window.seekr.index.stop()
    setIsIndexing(false)
  }, [])

  return {
    isIndexing,
    progress,
    fileCount,
    currentPath,
    deniedPaths,
    error,
    startIndexing,
    stopIndexing,
    refreshCount,
  }
}
