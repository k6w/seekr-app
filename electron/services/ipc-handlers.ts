import { ipcMain, shell, BrowserWindow } from 'electron';
import { DatabaseService } from './database';
import { FileIndexer } from './indexer';
import { FileWatcher } from './file-watcher';
import { SearchService } from './search'
import * as fs from 'fs'
import { IpcSearchRequest, IpcIndexRequest, IpcResponse } from '../../src/types';

export class IpcHandlers {
  private db: DatabaseService;
  private indexer: FileIndexer;
  private fileWatcher: FileWatcher;
  private searchService: SearchService;

  constructor(database: DatabaseService, indexer: FileIndexer, fileWatcher: FileWatcher) {
    this.db = database;
    this.indexer = indexer;
    this.fileWatcher = fileWatcher;
    this.searchService = new SearchService(database);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Search files
    ipcMain.handle('search-files', async (event, request: IpcSearchRequest): Promise<IpcResponse> => {
      try {
        const { query, filters, limit = 100, offset = 0 } = request;

        // Use the advanced search service
        const searchResult = await this.searchService.search(query, filters, limit, offset);

        return {
          success: true,
          data: searchResult
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Start indexing
    ipcMain.handle('start-indexing', async (event, request: IpcIndexRequest): Promise<IpcResponse> => {
      try {
        console.log('Received indexing request:', request);

        if (this.indexer.isCurrentlyIndexing()) {
          return {
            success: false,
            error: 'Indexing already in progress'
          };
        }

        // Validate and sanitize paths
        if (!request.paths || !Array.isArray(request.paths) || request.paths.length === 0) {
          return {
            success: false,
            error: 'No valid paths provided for indexing'
          };
        }

        const validPaths = request.paths.filter(p => typeof p === 'string' && p.trim().length > 0);
        if (validPaths.length === 0) {
          return {
            success: false,
            error: 'No valid paths provided for indexing'
          };
        }

        const excludePaths = Array.isArray(request.excludePaths) ? request.excludePaths : [];

        console.log('Starting indexing with paths:', validPaths);
        console.log('Exclude paths:', excludePaths);

        // Start indexing (don't await - let it run in background)
        this.indexer.startIndexing(validPaths, excludePaths).catch(error => {
          console.error('Indexing error:', error);
          const windows = BrowserWindow.getAllWindows();
          windows.forEach(window => {
            window.webContents.send('indexing-error', error.message);
          });
        });

        // Start file watching for real-time updates
        try {
          await this.fileWatcher.startWatching(validPaths, excludePaths);
        } catch (watchError) {
          console.warn('File watching failed to start:', watchError);
          // Don't fail the entire operation if file watching fails
        }

        return {
          success: true,
          data: { message: 'Indexing started successfully' }
        };
      } catch (error) {
        console.error('Start indexing error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Stop indexing
    ipcMain.handle('stop-indexing', async (): Promise<IpcResponse> => {
      try {
        this.indexer.stopIndexing();
        await this.fileWatcher.stopWatching();
        return {
          success: true,
          data: { message: 'Indexing and file watching stopped' }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Get indexing progress
    ipcMain.handle('get-indexing-progress', async (): Promise<IpcResponse> => {
      try {
        const progress = this.indexer.getProgress();
        return {
          success: true,
          data: progress
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Get file count
    ipcMain.handle('get-file-count', async (): Promise<IpcResponse> => {
      try {
        const count = await this.db.getFileCount();
        return {
          success: true,
          data: { count }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Open file location
    ipcMain.handle('open-file-location', async (event, filePath: string): Promise<IpcResponse> => {
      try {
        await shell.showItemInFolder(filePath);
        return {
          success: true,
          data: { message: 'File location opened' }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Open file
    ipcMain.handle('open-file', async (event, filePath: string): Promise<IpcResponse> => {
      try {
        await shell.openPath(filePath);
        return {
          success: true,
          data: { message: 'File opened' }
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Get system drives (Windows specific for now)
    ipcMain.handle('get-system-drives', async (): Promise<IpcResponse> => {
      try {
        const drives: string[] = [];

        if (process.platform === 'win32') {
          // On Windows, check common drive letters
          for (let i = 65; i <= 90; i++) { // A-Z
            const drive = String.fromCharCode(i) + ':\\';
            try {
              await fs.promises.access(drive);
              drives.push(drive);
            } catch {
              // Drive doesn't exist or not accessible
            }
          }

          // If no drives found, add C:\ as fallback
          if (drives.length === 0) {
            drives.push('C:\\');
          }
        } else {
          // On Unix-like systems, start with root and common directories
          const commonPaths = ['/', '/home', '/usr'];
          for (const path of commonPaths) {
            try {
              await fs.promises.access(path);
              drives.push(path);
              break; // Just use the first accessible one
            } catch {
              // Path not accessible
            }
          }

          // Fallback to root if nothing found
          if (drives.length === 0) {
            drives.push('/');
          }
        }

        console.log('System drives found:', drives);

        return {
          success: true,
          data: { drives }
        };
      } catch (error) {
        console.error('Error getting system drives:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Setup indexing progress events
    this.indexer.on('progress', (progress) => {
      // Send progress updates to all renderer processes
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(window => {
        window.webContents.send('indexing-progress', progress);
      });
    });

    this.indexer.on('complete', () => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(window => {
        window.webContents.send('indexing-complete');
      });
    });

    this.indexer.on('error', (error) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(window => {
        window.webContents.send('indexing-error', error.message);
      });
    });

    // Setup file watcher events
    this.fileWatcher.on('fileAdded', (file) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(window => {
        window.webContents.send('file-added', file);
      });
    });

    this.fileWatcher.on('fileChanged', (file) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(window => {
        window.webContents.send('file-changed', file);
      });
    });

    this.fileWatcher.on('fileRemoved', (filePath) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(window => {
        window.webContents.send('file-removed', filePath);
      });
    });

    this.fileWatcher.on('directoryAdded', (directory) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(window => {
        window.webContents.send('directory-added', directory);
      });
    });

    this.fileWatcher.on('directoryRemoved', (dirPath) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(window => {
        window.webContents.send('directory-removed', dirPath);
      });
    });

    this.fileWatcher.on('watcherReady', (path) => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(window => {
        window.webContents.send('watcher-ready', path);
      });
    });

    this.fileWatcher.on('watchingStopped', () => {
      const windows = BrowserWindow.getAllWindows();
      windows.forEach(window => {
        window.webContents.send('watching-stopped');
      });
    });
  }
}
