import { useCallback, useEffect, useRef, useState } from 'react'
import type { IndexingProgress } from '@/types'

export interface UseIndexingOptions {
  onComplete?: (fileCount: number) => void
  onError?: (message: string) => void
}

/**
 * Owns all indexing state and the main-process event subscriptions.
 *
 * Previously this lived inline in App.tsx inside a single effect whose
 * dependency array was `[fileCount, addNotification]`. Because `addNotification`
 * was a plain function recreated on every render, that effect tore down and
 * re-registered all eight IPC listeners on *every* render -- and indexing
 * progress events cause renders, so during a crawl it thrashed continuously.
 *
 * Here the subscriptions mount once. Callbacks are held in a ref so a caller
 * passing inline closures cannot cause resubscription.
 */
export function useIndexing(options: UseIndexingOptions = {}) {
  const [isIndexing, setIsIndexing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [fileCount, setFileCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const callbacks = useRef(options)
  callbacks.current = options

  const refreshFileCount = useCallback(async () => {
    const response = await window.seekr.index.count()
    if (response.ok) {
      setFileCount(response.data)
      return response.data
    }
    return 0
  }, [])

  useEffect(() => {
    void refreshFileCount()

    const unsubscribers = [
      window.seekr.events.onIndexProgress((update: IndexingProgress) => {
        setIsIndexing(update.isIndexing)
        setProgress(update.progress)
        if (update.filesProcessed) setFileCount(update.filesProcessed)
      }),

      window.seekr.events.onIndexComplete(() => {
        setIsIndexing(false)
        setProgress(100)
        void refreshFileCount().then((count) => callbacks.current.onComplete?.(count))
      }),

      window.seekr.events.onIndexError((message: string) => {
        setIsIndexing(false)
        setError(message)
        callbacks.current.onError?.(message)
      }),
    ]

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [refreshFileCount])

  /**
   * Starts a crawl. With no paths, the main process picks platform-correct
   * defaults -- the old renderer branched on `process.platform`, which is
   * undefined under contextIsolation, and fell back to `['/home', '/Users']`
   * (neither of which is right on macOS).
   */
  const startIndexing = useCallback(
    async (paths?: string[]) => {
      if (isIndexing) return

      setError(null)
      setProgress(0)

      let roots = paths
      if (!roots || roots.length === 0) {
        const drives = await window.seekr.system.drives()
        if (!drives.ok) {
          setError(drives.error)
          callbacks.current.onError?.(drives.error)
          return
        }
        // First entry is the user's home directory on every platform.
        roots = drives.data.slice(0, 1)
      }

      setIsIndexing(true)
      const response = await window.seekr.index.start({ paths: roots })
      if (!response.ok) {
        setIsIndexing(false)
        setError(response.error)
        callbacks.current.onError?.(response.error)
      }
    },
    [isIndexing],
  )

  const stopIndexing = useCallback(async () => {
    await window.seekr.index.stop()
    setIsIndexing(false)
  }, [])

  return { isIndexing, progress, fileCount, error, startIndexing, stopIndexing, refreshFileCount }
}
