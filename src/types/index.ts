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

export interface AppSettings {
  indexedPaths: string[];
  excludedPaths: string[];
  theme: 'light' | 'dark' | 'system';
  searchResultsLimit: number;
  enableFuzzySearch: boolean;
  enableContentSearch: boolean;
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

export interface IpcResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}
