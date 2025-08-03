import * as chokidar from 'chokidar';
import path from 'path';
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import { DatabaseService } from './database';
import { FileItem, FileType } from '../../src/types';
import { v4 as uuidv4 } from 'uuid';

export class FileWatcher extends EventEmitter {
  private watchers: Map<string, chokidar.FSWatcher> = new Map();
  private db: DatabaseService;
  private isWatching = false;

  constructor(database: DatabaseService) {
    super();
    this.db = database;
  }

  async startWatching(paths: string[], excludePaths: string[] = []): Promise<void> {
    if (this.isWatching) {
      console.log('File watching already active, skipping...');
      return;
    }

    this.isWatching = true;
    console.log('Starting file watching for paths:', paths);

    for (const watchPath of paths) {
      try {
        // Skip watching system drives entirely to prevent crashes
        if (process.platform === 'win32' && watchPath.match(/^[A-Z]:\\?$/)) {
          console.log(`Skipping system drive watching for: ${watchPath}`);
          continue;
        }

        const watcher = chokidar.watch(watchPath, {
          ignored: this.createIgnorePattern(excludePaths),
          persistent: true,
          ignoreInitial: true, // Don't emit events for existing files
          followSymlinks: false,
          depth: 5, // Limit depth to prevent excessive watching
          awaitWriteFinish: {
            stabilityThreshold: 200,
            pollInterval: 100
          },
          usePolling: false, // Use native events for better performance
          atomic: true // Prevent partial file events
        });

        // File added
        watcher.on('add', async (filePath) => {
          try {
            const fileItem = await this.createFileItem(filePath, watchPath);
            await this.db.insertFile(fileItem);
            this.emit('fileAdded', fileItem);
          } catch (error) {
            console.warn(`Error adding file ${filePath}:`, error);
          }
        });

        // File changed
        watcher.on('change', async (filePath) => {
          try {
            const fileItem = await this.createFileItem(filePath, watchPath);
            await this.db.insertFile(fileItem); // INSERT OR REPLACE
            this.emit('fileChanged', fileItem);
          } catch (error) {
            console.warn(`Error updating file ${filePath}:`, error);
          }
        });

        // File removed
        watcher.on('unlink', async (filePath) => {
          try {
            await this.db.deleteFile(filePath);
            this.emit('fileRemoved', filePath);
          } catch (error) {
            console.warn(`Error removing file ${filePath}:`, error);
          }
        });

        // Directory added
        watcher.on('addDir', async (dirPath) => {
          try {
            const fileItem = await this.createFileItem(dirPath, watchPath);
            await this.db.insertFile(fileItem);
            this.emit('directoryAdded', fileItem);
          } catch (error) {
            console.warn(`Error adding directory ${dirPath}:`, error);
          }
        });

        // Directory removed
        watcher.on('unlinkDir', async (dirPath) => {
          try {
            await this.db.deleteFile(dirPath);
            this.emit('directoryRemoved', dirPath);
          } catch (error) {
            console.warn(`Error removing directory ${dirPath}:`, error);
          }
        });

        // Error handling
        watcher.on('error', (error) => {
          console.warn(`Watcher error for ${watchPath}:`, error);
          // Don't emit error events that could crash the app
        });

        // Ready event
        watcher.on('ready', () => {
          console.log(`File watcher ready for: ${watchPath}`);
          this.emit('watcherReady', watchPath);
        });

        this.watchers.set(watchPath, watcher);
      } catch (error) {
        console.warn(`Failed to start watching ${watchPath}:`, error);
        // Don't emit error, just continue with other paths
      }
    }
  }

  async stopWatching(): Promise<void> {
    if (!this.isWatching) {
      return;
    }

    const closePromises = Array.from(this.watchers.values()).map(watcher => 
      new Promise<void>((resolve) => {
        watcher.close().then(() => resolve()).catch(() => resolve());
      })
    );

    await Promise.all(closePromises);
    this.watchers.clear();
    this.isWatching = false;
    this.emit('watchingStopped');
  }

  private createIgnorePattern(excludePaths: string[]): (path: string) => boolean {
    const defaultExclusions = [
      '**/node_modules/**',
      '**/.git/**',
      '**/.svn/**',
      '**/.hg/**',
      '**/temp/**',
      '**/tmp/**',
      '**/$RECYCLE.BIN/**',
      '**/System Volume Information/**',
      '**/Windows/**',
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/*.tmp',
      '**/*.temp'
    ];

    const allExclusions = [...defaultExclusions, ...excludePaths.map(p => `**/${p}/**`)];

    return (filePath: string) => {
      const normalizedPath = path.normalize(filePath).toLowerCase();
      
      // Check against exclusion patterns
      for (const pattern of allExclusions) {
        const regexPattern = pattern
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/\\\\]*')
          .replace(/\?/g, '[^/\\\\]');
        
        const regex = new RegExp(regexPattern, 'i');
        if (regex.test(normalizedPath)) {
          return true;
        }
      }

      // Skip hidden files and system files
      const fileName = path.basename(filePath);
      if (fileName.startsWith('.') || fileName.startsWith('$')) {
        return true;
      }

      return false;
    };
  }

  private async createFileItem(filePath: string, rootPath: string): Promise<FileItem> {
    const stats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    const relativePath = path.relative(rootPath, path.dirname(filePath));
    
    return {
      id: uuidv4(),
      name: fileName,
      path: relativePath || '.',
      fullPath: filePath,
      extension: stats.isDirectory() ? '' : path.extname(fileName).toLowerCase(),
      size: stats.size,
      dateModified: stats.mtime,
      dateCreated: stats.birthtime,
      isDirectory: stats.isDirectory(),
      type: this.getFileType(fileName, stats.isDirectory())
    };
  }

  private getFileType(fileName: string, isDirectory: boolean): FileType {
    if (isDirectory) {
      return FileType.DIRECTORY;
    }

    const extension = path.extname(fileName).toLowerCase();
    
    // Document types
    const documentExts = ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.xls', '.xlsx', '.ppt', '.pptx'];
    if (documentExts.includes(extension)) {
      return FileType.DOCUMENT;
    }

    // Image types
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff'];
    if (imageExts.includes(extension)) {
      return FileType.IMAGE;
    }

    // Video types
    const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'];
    if (videoExts.includes(extension)) {
      return FileType.VIDEO;
    }

    // Audio types
    const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'];
    if (audioExts.includes(extension)) {
      return FileType.AUDIO;
    }

    // Archive types
    const archiveExts = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz'];
    if (archiveExts.includes(extension)) {
      return FileType.ARCHIVE;
    }

    // Code types
    const codeExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.cs', '.php', '.rb', '.go', '.rs', '.html', '.css', '.scss', '.json', '.xml', '.yaml', '.yml'];
    if (codeExts.includes(extension)) {
      return FileType.CODE;
    }

    return FileType.OTHER;
  }

  getWatchedPaths(): string[] {
    return Array.from(this.watchers.keys());
  }

  isCurrentlyWatching(): boolean {
    return this.isWatching;
  }
}
