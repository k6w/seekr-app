import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import { FileItem, FileType, IndexingProgress } from '../../src/types';
import { DatabaseService } from './database';
import { v4 as uuidv4 } from 'uuid';

export class FileIndexer extends EventEmitter {
  private db: DatabaseService;
  private isIndexing = false;
  private shouldStop = false;
  private currentProgress: IndexingProgress = {
    isIndexing: false,
    filesProcessed: 0,
    progress: 0
  };

  constructor(database: DatabaseService) {
    super();
    this.db = database;
  }

  async startIndexing(paths: string[], excludePaths: string[] = []): Promise<void> {
    if (this.isIndexing) {
      throw new Error('Indexing already in progress');
    }

    console.log('Starting indexing with paths:', paths);
    console.log('Exclude paths:', excludePaths);

    this.isIndexing = true;
    this.shouldStop = false;
    this.currentProgress = {
      isIndexing: true,
      filesProcessed: 0,
      progress: 0
    };

    this.emit('progress', this.currentProgress);

    try {
      // Clear existing data
      await this.db.clearAll();
      console.log('Database cleared, starting file discovery...');

      // Start indexing each path with better error handling
      for (const rootPath of paths) {
        if (this.shouldStop) break;

        console.log(`Starting to index path: ${rootPath}`);
        try {
          await this.indexPath(rootPath, excludePaths);
          console.log(`Completed indexing path: ${rootPath}`);
        } catch (pathError) {
          console.error(`Failed to index path ${rootPath}:`, pathError);
          // Continue with other paths even if one fails
          continue;
        }
      }

      this.currentProgress.isIndexing = false;
      this.currentProgress.progress = 100;
      this.emit('progress', this.currentProgress);
      this.emit('complete');
      console.log('Indexing completed successfully');
    } catch (error) {
      console.error('Indexing failed:', error);
      this.currentProgress.isIndexing = false;
      this.emit('error', error);
    } finally {
      this.isIndexing = false;
    }
  }

  async indexPath(rootPath: string, excludePaths: string[] = []): Promise<void> {
    const files: FileItem[] = [];
    const batchSize = 500; // Smaller batches for better responsiveness
    let totalProcessed = 0;

    console.log(`Starting to scan directory: ${rootPath}`);

    // Scan directory and collect files
    await this.scanDirectory(rootPath, rootPath, excludePaths, files);

    console.log(`Found ${files.length} files to index`);

    if (files.length === 0) {
      console.log('No files found to index');
      return;
    }

    // Insert files in batches with progress updates
    for (let i = 0; i < files.length; i += batchSize) {
      if (this.shouldStop) break;

      const batch = files.slice(i, i + batchSize);

      try {
        await this.db.insertFiles(batch);
        totalProcessed += batch.length;

        // Update progress
        this.currentProgress.filesProcessed = totalProcessed;
        this.currentProgress.progress = Math.min(95, (totalProcessed / files.length) * 100);
        this.currentProgress.currentPath = `Indexed ${totalProcessed}/${files.length} files`;
        this.emit('progress', this.currentProgress);

        console.log(`Indexed batch: ${totalProcessed}/${files.length} files (${this.currentProgress.progress.toFixed(1)}%)`);

        // Small delay to prevent blocking
        await new Promise(resolve => setTimeout(resolve, 10));
      } catch (error) {
        console.error(`Failed to insert batch starting at index ${i}:`, error);
        // Continue with next batch
      }
    }

    console.log(`Completed indexing ${totalProcessed} files from ${rootPath}`);
  }

  private async scanDirectory(
    currentPath: string,
    rootPath: string,
    excludePaths: string[],
    files: FileItem[]
  ): Promise<void> {
    if (this.shouldStop) return;

    // Check if path should be excluded
    if (this.shouldExcludePath(currentPath, excludePaths)) {
      return;
    }

    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      const directories: string[] = [];

      // Process files first, collect directories for later
      for (const entry of entries) {
        if (this.shouldStop) break;

        const fullPath = path.join(currentPath, entry.name);

        // Skip hidden files and system files
        if (entry.name.startsWith('.') || entry.name.startsWith('$')) {
          continue;
        }

        // Skip problematic Windows system files
        if (process.platform === 'win32') {
          const systemFiles = ['pagefile.sys', 'hiberfil.sys', 'swapfile.sys'];
          if (systemFiles.includes(entry.name.toLowerCase())) {
            continue;
          }
        }

        try {
          if (entry.isDirectory()) {
            directories.push(fullPath);
          } else {
            // Get proper file stats for accurate metadata
            const stats = await fs.stat(fullPath);
            const relativePath = path.relative(rootPath, path.dirname(fullPath));

            const fileItem: FileItem = {
              id: uuidv4(),
              name: entry.name,
              path: relativePath || '.',
              fullPath: fullPath,
              extension: path.extname(entry.name).toLowerCase(),
              size: stats.size,
              dateModified: stats.mtime,
              dateCreated: stats.birthtime || stats.ctime,
              isDirectory: false,
              type: this.getFileType(entry.name, false)
            };

            files.push(fileItem);

            // Update progress more frequently but emit less frequently
            this.currentProgress.filesProcessed++;

            if (this.currentProgress.filesProcessed % 50 === 0) {
              this.currentProgress.currentPath = fullPath;
              this.emit('progress', this.currentProgress);

              // Small yield to prevent blocking
              await new Promise(resolve => setImmediate(resolve));
            }
          }
        } catch (error) {
          // Skip files that can't be accessed
          if (error.code !== 'EACCES' && error.code !== 'EPERM' && error.code !== 'EBUSY') {
            console.warn(`Skipping ${fullPath}: ${error.code}`);
          }
        }
      }

      // Process directories after files
      for (const dirPath of directories) {
        if (this.shouldStop) break;
        await this.scanDirectory(dirPath, rootPath, excludePaths, files);
      }

    } catch (error) {
      // Only log non-permission errors
      if (error.code !== 'EACCES' && error.code !== 'EPERM') {
        console.warn(`Cannot read directory ${currentPath}: ${error.code}`);
      }
    }
  }

  private shouldExcludePath(currentPath: string, excludePaths: string[]): boolean {
    const normalizedPath = path.normalize(currentPath).toLowerCase();
    const pathParts = normalizedPath.split(path.sep);

    // Default exclusions - more comprehensive
    const defaultExclusions = [
      'node_modules',
      '.git',
      '.svn',
      '.hg',
      'temp',
      'tmp',
      '$recycle.bin',
      'system volume information',
      'windows',
      'appdata',
      '.cache',
      '.npm',
      '.yarn',
      'cache',
      'logs',
      '.vscode',
      '.idea',
      'build',
      'dist',
      'out',
      'target'
    ];

    // Check if any part of the path contains excluded directories
    for (const exclusion of [...defaultExclusions, ...excludePaths]) {
      const normalizedExclusion = exclusion.toLowerCase();

      // Check if any path segment matches exactly
      if (pathParts.includes(normalizedExclusion)) {
        return true;
      }

      // Check if path contains the exclusion
      if (normalizedPath.includes(normalizedExclusion)) {
        return true;
      }
    }

    // Skip very deep paths to prevent infinite recursion
    if (pathParts.length > 20) {
      return true;
    }

    return false;
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

  stopIndexing(): void {
    this.shouldStop = true;
  }

  getProgress(): IndexingProgress {
    return { ...this.currentProgress };
  }

  isCurrentlyIndexing(): boolean {
    return this.isIndexing;
  }
}
