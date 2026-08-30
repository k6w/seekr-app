export interface FileItem {
  id: string;
  name: string;
  path: string;
  fullPath: string;
  extension: string;
  size: number;
  dateModified: Date;
  dateCreated: Date;
  isDirectory: boolean;
  type: FileType;
  /**
   * Sits under a build-artifact or VCS directory (node_modules, .git, dist).
   * Indexed and searchable, but rank-penalized so it does not crowd out real
   * results. See electron/services/path-policy.ts.
   */
  demoted?: boolean;
}

export enum FileType {
  DOCUMENT = 'document',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  ARCHIVE = 'archive',
  CODE = 'code',
  DIRECTORY = 'directory',
  OTHER = 'other'
}

export interface SearchQuery {
  text: string;
  filters: SearchFilters;
}

export interface SearchFilters {
  fileTypes?: FileType[];
  extensions?: string[];
  sizeMin?: number;
  sizeMax?: number;
  dateModifiedFrom?: Date;
  dateModifiedTo?: Date;
  includeDirectories?: boolean;
}

export interface SearchResult {
  items: FileItem[];
  totalCount: number;
  query: string;
  executionTime: number;
}

export interface IndexingProgress {
  isIndexing: boolean;
  currentPath?: string;
  filesProcessed: number;
  totalFiles?: number;
  progress: number; // 0-100
}

// IPC Types for Electron communication
export interface IpcSearchRequest {
  query: string;
  filters: SearchFilters;
  limit?: number;
  offset?: number;
}

export interface IpcIndexRequest {
  paths: string[];
  excludePaths?: string[];
}

