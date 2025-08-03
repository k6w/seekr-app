import { DatabaseService } from './database';
import { FileItem, SearchFilters, SearchResult, FileType } from '../../src/types';
import Fuse from 'fuse.js';

export class SearchService {
  private db: DatabaseService;
  private fuseIndex: Fuse<FileItem> | null = null;
  private lastIndexUpdate = 0;
  private indexUpdateThreshold = 5 * 60 * 1000; // 5 minutes

  constructor(database: DatabaseService) {
    this.db = database;
  }

  async search(query: string, filters: SearchFilters = {}, limit = 100, offset = 0): Promise<SearchResult> {
    const startTime = Date.now();
    
    try {
      // Parse search operators from query
      const { cleanQuery, operators } = this.parseSearchOperators(query);
      
      // Combine filters with operators
      const combinedFilters = this.combineFilters(filters, operators);
      
      let results: FileItem[];
      
      if (cleanQuery.trim() === '') {
        // If no text query, just apply filters
        results = await this.searchWithFilters(combinedFilters, limit, offset);
      } else if (this.shouldUseFuzzySearch(cleanQuery)) {
        // Use fuzzy search for complex queries
        results = await this.fuzzySearch(cleanQuery, combinedFilters, limit, offset);
      } else {
        // Use database FTS for simple queries
        results = await this.databaseSearch(cleanQuery, combinedFilters, limit, offset);
      }
      
      // Apply additional filtering and sorting
      results = this.applyFilters(results, combinedFilters);
      results = this.sortResults(results, cleanQuery);
      
      // Apply pagination
      const paginatedResults = results.slice(offset, offset + limit);
      
      const executionTime = Date.now() - startTime;
      
      return {
        items: paginatedResults,
        totalCount: results.length,
        query: query,
        executionTime
      };
    } catch (error) {
      console.error('Search error:', error);
      return {
        items: [],
        totalCount: 0,
        query: query,
        executionTime: Date.now() - startTime
      };
    }
  }

  private parseSearchOperators(query: string): { cleanQuery: string; operators: Record<string, any> } {
    const operators: Record<string, any> = {};
    let cleanQuery = query;

    // Extract file extension operator: ext:pdf
    const extMatch = query.match(/ext:(\w+)/gi);
    if (extMatch) {
      operators.extensions = extMatch.map(match => '.' + match.split(':')[1].toLowerCase());
      cleanQuery = cleanQuery.replace(/ext:\w+/gi, '').trim();
    }

    // Extract size operator: size:>100MB, size:<1GB
    const sizeMatch = query.match(/size:([><]?)(\d+)(kb|mb|gb)?/gi);
    if (sizeMatch) {
      sizeMatch.forEach(match => {
        const parts = match.match(/size:([><]?)(\d+)(kb|mb|gb)?/i);
        if (parts) {
          const operator = parts[1] || '=';
          const value = parseInt(parts[2]);
          const unit = (parts[3] || 'b').toLowerCase();
          
          let bytes = value;
          switch (unit) {
            case 'kb': bytes *= 1024; break;
            case 'mb': bytes *= 1024 * 1024; break;
            case 'gb': bytes *= 1024 * 1024 * 1024; break;
          }
          
          if (operator === '>') {
            operators.sizeMin = bytes;
          } else if (operator === '<') {
            operators.sizeMax = bytes;
          } else {
            operators.sizeMin = bytes * 0.9;
            operators.sizeMax = bytes * 1.1;
          }
        }
      });
      cleanQuery = cleanQuery.replace(/size:[><]?\d+(kb|mb|gb)?/gi, '').trim();
    }

    // Extract date operator: date:today, date:week, date:month
    const dateMatch = query.match(/date:(today|yesterday|week|month|year)/gi);
    if (dateMatch) {
      const dateType = dateMatch[0].split(':')[1].toLowerCase();
      const now = new Date();
      
      switch (dateType) {
        case 'today':
          operators.dateModifiedFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'yesterday':
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          operators.dateModifiedFrom = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
          operators.dateModifiedTo = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          const weekAgo = new Date(now);
          weekAgo.setDate(weekAgo.getDate() - 7);
          operators.dateModifiedFrom = weekAgo;
          break;
        case 'month':
          const monthAgo = new Date(now);
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          operators.dateModifiedFrom = monthAgo;
          break;
        case 'year':
          const yearAgo = new Date(now);
          yearAgo.setFullYear(yearAgo.getFullYear() - 1);
          operators.dateModifiedFrom = yearAgo;
          break;
      }
      cleanQuery = cleanQuery.replace(/date:(today|yesterday|week|month|year)/gi, '').trim();
    }

    // Extract type operator: type:image, type:document
    const typeMatch = query.match(/type:(\w+)/gi);
    if (typeMatch) {
      operators.fileTypes = typeMatch.map(match => {
        const type = match.split(':')[1].toLowerCase();
        switch (type) {
          case 'doc':
          case 'document':
          case 'documents':
            return FileType.DOCUMENT;
          case 'img':
          case 'image':
          case 'images':
            return FileType.IMAGE;
          case 'vid':
          case 'video':
          case 'videos':
            return FileType.VIDEO;
          case 'audio':
          case 'music':
            return FileType.AUDIO;
          case 'archive':
          case 'zip':
            return FileType.ARCHIVE;
          case 'code':
          case 'source':
            return FileType.CODE;
          case 'folder':
          case 'directory':
          case 'dir':
            return FileType.DIRECTORY;
          default:
            return type;
        }
      });
      cleanQuery = cleanQuery.replace(/type:\w+/gi, '').trim();
    }

    return { cleanQuery, operators };
  }

  private combineFilters(filters: SearchFilters, operators: Record<string, any>): SearchFilters {
    return {
      ...filters,
      extensions: [...(filters.extensions || []), ...(operators.extensions || [])],
      fileTypes: [...(filters.fileTypes || []), ...(operators.fileTypes || [])],
      sizeMin: Math.max(filters.sizeMin || 0, operators.sizeMin || 0),
      sizeMax: Math.min(filters.sizeMax || Infinity, operators.sizeMax || Infinity),
      dateModifiedFrom: operators.dateModifiedFrom || filters.dateModifiedFrom,
      dateModifiedTo: operators.dateModifiedTo || filters.dateModifiedTo,
      includeDirectories: filters.includeDirectories
    };
  }

  private shouldUseFuzzySearch(query: string): boolean {
    // Use fuzzy search for queries with typos or complex patterns
    return query.length > 3 && (
      query.includes('*') || 
      query.includes('?') || 
      /[^a-zA-Z0-9\s\-_.]/.test(query)
    );
  }

  private async databaseSearch(query: string, filters: SearchFilters, limit: number, offset: number): Promise<FileItem[]> {
    return await this.db.searchFiles(query, limit * 2, offset); // Get more results for filtering
  }

  private async searchWithFilters(filters: SearchFilters, limit: number, offset: number): Promise<FileItem[]> {
    // This would need to be implemented in the database service
    // For now, get all files and filter in memory (not efficient for large datasets)
    return await this.db.searchFiles('', limit * 2, offset);
  }

  private async fuzzySearch(query: string, filters: SearchFilters, limit: number, offset: number): Promise<FileItem[]> {
    // Update Fuse index if needed
    await this.updateFuseIndex();
    
    if (!this.fuseIndex) {
      return [];
    }

    const results = this.fuseIndex.search(query, { limit: limit * 2 });
    return results.map(result => result.item);
  }

  private async updateFuseIndex(): Promise<void> {
    const now = Date.now();
    if (this.fuseIndex && (now - this.lastIndexUpdate) < this.indexUpdateThreshold) {
      return; // Index is still fresh
    }

    try {
      // Get all files from database
      const allFiles = await this.db.searchFiles('', 10000, 0); // Limit to prevent memory issues
      
      const fuseOptions = {
        keys: [
          { name: 'name', weight: 0.7 },
          { name: 'path', weight: 0.2 },
          { name: 'extension', weight: 0.1 }
        ],
        threshold: 0.4, // Lower = more strict matching
        distance: 100,
        includeScore: true,
        includeMatches: true
      };

      this.fuseIndex = new Fuse(allFiles, fuseOptions);
      this.lastIndexUpdate = now;
    } catch (error) {
      console.error('Failed to update Fuse index:', error);
    }
  }

  private applyFilters(files: FileItem[], filters: SearchFilters): FileItem[] {
    return files.filter(file => {
      // File type filter
      if (filters.fileTypes && filters.fileTypes.length > 0) {
        if (!filters.fileTypes.includes(file.type)) {
          return false;
        }
      }

      // Extension filter
      if (filters.extensions && filters.extensions.length > 0) {
        if (!filters.extensions.includes(file.extension)) {
          return false;
        }
      }

      // Size filter
      if (filters.sizeMin && file.size < filters.sizeMin) {
        return false;
      }
      if (filters.sizeMax && file.size > filters.sizeMax) {
        return false;
      }

      // Date filter
      if (filters.dateModifiedFrom && file.dateModified < filters.dateModifiedFrom) {
        return false;
      }
      if (filters.dateModifiedTo && file.dateModified > filters.dateModifiedTo) {
        return false;
      }

      // Directory filter
      if (filters.includeDirectories === false && file.isDirectory) {
        return false;
      }

      return true;
    });
  }

  private sortResults(files: FileItem[], query: string): FileItem[] {
    if (!query.trim()) {
      // Sort by date modified (newest first) when no query
      return files.sort((a, b) => b.dateModified.getTime() - a.dateModified.getTime());
    }

    // Sort by relevance when there's a query
    return files.sort((a, b) => {
      const aScore = this.calculateRelevanceScore(a, query);
      const bScore = this.calculateRelevanceScore(b, query);
      return bScore - aScore;
    });
  }

  private calculateRelevanceScore(file: FileItem, query: string): number {
    const queryLower = query.toLowerCase();
    const nameLower = file.name.toLowerCase();
    const pathLower = file.path.toLowerCase();

    let score = 0;

    // Exact name match gets highest score
    if (nameLower === queryLower) {
      score += 100;
    }
    // Name starts with query
    else if (nameLower.startsWith(queryLower)) {
      score += 80;
    }
    // Name contains query
    else if (nameLower.includes(queryLower)) {
      score += 60;
    }

    // Path relevance
    if (pathLower.includes(queryLower)) {
      score += 20;
    }

    // Boost recent files
    const daysSinceModified = (Date.now() - file.dateModified.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceModified < 7) {
      score += 10;
    } else if (daysSinceModified < 30) {
      score += 5;
    }

    // Boost smaller files (usually more relevant)
    if (file.size < 1024 * 1024) { // < 1MB
      score += 5;
    }

    return score;
  }
}
