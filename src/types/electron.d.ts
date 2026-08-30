import type { SeekrApi } from '../../electron/ipc/api'

declare global {
  interface Window {
    /**
     * The single, allowlisted bridge to the main process.
     * Shape is defined by `SeekrApi` and implemented in `electron/preload.ts`.
     */
    seekr: SeekrApi
  }
}

export {}
