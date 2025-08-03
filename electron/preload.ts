import { ipcRenderer, contextBridge } from 'electron'
import { IpcSearchRequest, IpcIndexRequest, IpcResponse } from '../src/types'

// --------- Expose File Search API to the Renderer process ---------
contextBridge.exposeInMainWorld('fileSearchAPI', {
  // Search operations
  searchFiles: (request: IpcSearchRequest): Promise<IpcResponse> =>
    ipcRenderer.invoke('search-files', request),

  // Indexing operations
  startIndexing: (request: IpcIndexRequest): Promise<IpcResponse> =>
    ipcRenderer.invoke('start-indexing', request),

  stopIndexing: (): Promise<IpcResponse> =>
    ipcRenderer.invoke('stop-indexing'),

  getIndexingProgress: (): Promise<IpcResponse> =>
    ipcRenderer.invoke('get-indexing-progress'),

  getFileCount: (): Promise<IpcResponse> =>
    ipcRenderer.invoke('get-file-count'),

  // File operations
  openFile: (filePath: string): Promise<IpcResponse> =>
    ipcRenderer.invoke('open-file', filePath),

  openFileLocation: (filePath: string): Promise<IpcResponse> =>
    ipcRenderer.invoke('open-file-location', filePath),

  // System operations
  getSystemDrives: (): Promise<IpcResponse> =>
    ipcRenderer.invoke('get-system-drives'),

  // Event listeners
  onIndexingProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('indexing-progress', (_, progress) => callback(progress))
  },

  onIndexingComplete: (callback: () => void) => {
    ipcRenderer.on('indexing-complete', () => callback())
  },

  onIndexingError: (callback: (error: string) => void) => {
    ipcRenderer.on('indexing-error', (_, error) => callback(error))
  },

  // Remove listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
})

// --------- Expose Window Controls API ---------
contextBridge.exposeInMainWorld('windowAPI', {
  minimize: (): Promise<void> =>
    ipcRenderer.invoke('window-minimize'),

  maximize: (): Promise<void> =>
    ipcRenderer.invoke('window-maximize'),

  close: (): Promise<void> =>
    ipcRenderer.invoke('window-close'),

  isMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke('window-is-maximized'),

  quit: (): Promise<void> =>
    ipcRenderer.invoke('app-quit'),

  // Event listeners
  onFocusSearch: (callback: () => void) => {
    ipcRenderer.on('focus-search', () => callback())
  },

  onOpenSettings: (callback: () => void) => {
    ipcRenderer.on('open-settings', () => callback())
  },

  onAutoStartIndexing: (callback: () => void) => {
    ipcRenderer.on('auto-start-indexing', () => callback())
  },

  onStartIndexingFromTray: (callback: () => void) => {
    ipcRenderer.on('start-indexing-from-tray', () => callback())
  },

  onShowTrayNotification: (callback: () => void) => {
    ipcRenderer.on('show-tray-notification', () => callback())
  }
})

// --------- Expose basic IPC for other purposes ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  }
})
