import { useEffect, useState } from 'react'
import type { SystemInfo } from '../../electron/ipc/api'

let cached: SystemInfo | null = null

/**
 * Platform info, fetched once from the main process and shared.
 *
 * The renderer cannot read `process.platform` -- it is sandboxed with
 * contextIsolation, so `process` is undefined there. App.tsx:222 nonetheless
 * branched on `process.platform === 'win32'`, which throws a ReferenceError
 * if that path is ever reached.
 */
export function usePlatform(): SystemInfo | null {
  const [info, setInfo] = useState<SystemInfo | null>(cached)

  useEffect(() => {
    if (cached) return
    let cancelled = false
    void window.seekr.system.info().then((result) => {
      if (result.ok && !cancelled) {
        cached = result.data
        setInfo(result.data)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  return info
}
