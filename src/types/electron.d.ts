import { IpcSearchRequest, IpcIndexRequest, IpcResponse } from './index'

declare global {
  interface Window {
    fileSearchAPI: {
      // Search operations
      searchFiles: (request: IpcSearchRequest) => Promise<IpcResponse>

      // Indexing operations
      startIndexing: (request: IpcIndexRequest) => Promise<IpcResponse>
      stopIndexing: () => Promise<IpcResponse>
      getIndexingProgress: () => Promise<IpcResponse>
      getFileCount: () => Promise<IpcResponse>

      // File operations
      openFile: (filePath: string) => Promise<IpcResponse>
      openFileLocation: (filePath: string) => Promise<IpcResponse>

      // System operations
      getSystemDrives: () => Promise<IpcResponse>

      // Event listeners
      onIndexingProgress: (callback: (progress: any) => void) => void
      onIndexingComplete: (callback: () => void) => void
      onIndexingError: (callback: (error: string) => void) => void
      removeAllListeners: (channel: string) => void
    }

    windowAPI: {
      // Window controls
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      isMaximized: () => Promise<boolean>
      quit: () => Promise<void>

      // Event listeners
      onFocusSearch: (callback: () => void) => void
      onOpenSettings: (callback: () => void) => void
      onAutoStartIndexing: (callback: () => void) => void
      onStartIndexingFromTray: (callback: () => void) => void
      onShowTrayNotification: (callback: () => void) => void
    }

    ipcRenderer: {
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => void
      off: (channel: string, ...args: any[]) => void
      send: (channel: string, ...args: any[]) => void
      invoke: (channel: string, ...args: any[]) => Promise<any>
    }
  }
}

export {}
