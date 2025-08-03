import React, { useState, useMemo } from 'react';
import { SearchResult, FileItem as FileItemType } from '@/types';
import { FileItem } from './FileItem';
import { ViewToggle, ViewMode } from './ViewToggle';
import { Pagination } from './Pagination';
import { VirtualList } from '@/components/ui/virtual-list';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, FileX } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchResultsProps {
  results: SearchResult | null;
  isLoading: boolean;
  onOpenFile: (file: FileItemType) => void;
  onRevealFile: (file: FileItemType) => void;
  className?: string;
  selectedFiles?: FileItemType[];
  onSelectFile?: (file: FileItemType) => void;
  // Pagination props
  currentPage?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
  itemsPerPage?: number;
  onPageChange?: (page: number) => void;
  onNextPage?: () => void;
  onPrevPage?: () => void;
}

export function SearchResults({
  results,
  isLoading,
  onOpenFile,
  onRevealFile,
  className,
  selectedFiles = [],
  onSelectFile,
  currentPage = 1,
  totalPages = 0,
  hasNextPage = false,
  hasPrevPage = false,
  itemsPerPage = 50,
  onPageChange,
  onNextPage,
  onPrevPage
}: SearchResultsProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // Memoize item height based on view mode
  const itemHeight = useMemo(() => {
    switch (viewMode) {
      case 'compact': return 40;
      case 'grid': return 120;
      default: return 80; // list
    }
  }, [viewMode]);

  // Use virtualization for large result sets
  const shouldUseVirtualization = results && results.items.length > 50;
  if (isLoading) {
    return (
      <div className={cn(
        "flex flex-col items-center justify-center h-64 text-muted-foreground",
        className
      )}>
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p className="text-sm">Searching files...</p>
      </div>
    );
  }

  if (!results) {
    return (
      <div className={cn(
        "flex flex-col items-center justify-center h-64 text-muted-foreground",
        className
      )}>
        <Search className="h-12 w-12 mb-4 opacity-50" />
        <h3 className="text-lg font-medium mb-2">Start searching</h3>
        <p className="text-sm text-center max-w-md">
          Type in the search box above to find files and folders on your system.
          You can use operators like <code className="bg-muted px-1 rounded">ext:pdf</code> or <code className="bg-muted px-1 rounded">type:image</code>.
        </p>
      </div>
    );
  }

  if (results.items.length === 0) {
    return (
      <div className={cn(
        "flex flex-col items-center justify-center h-64 text-muted-foreground",
        className
      )}>
        <FileX className="h-12 w-12 mb-4 opacity-50" />
        <h3 className="text-lg font-medium mb-2">No results found</h3>
        <p className="text-sm text-center max-w-md">
          No files or folders match your search query "{results.query}".
          Try different keywords or check your spelling.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Results Header */}
      <div className="flex items-center justify-between p-4 border-b bg-muted/30">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium">
            Search Results
          </h2>
          <Badge variant="secondary" className="text-xs">
            {results.totalCount.toLocaleString()} {results.totalCount === 1 ? 'item' : 'items'}
          </Badge>
          {results.executionTime > 0 && (
            <Badge variant="outline" className="text-xs">
              {results.executionTime}ms
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3">
          {results.query && (
            <div className="text-xs text-muted-foreground">
              for "{results.query}"
            </div>
          )}

          <ViewToggle
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        </div>
      </div>

      {/* Results List */}
      {shouldUseVirtualization && viewMode === 'list' ? (
        <VirtualList
          items={results.items}
          itemHeight={itemHeight}
          containerHeight={500}
          className="flex-1 px-2"
          renderItem={(file, index) => (
            <FileItem
              key={file.id}
              file={file}
              onOpen={onOpenFile}
              onReveal={onRevealFile}
              onSelect={onSelectFile}
              isSelected={selectedFiles.some(f => f.id === file.id)}
              searchQuery={results.query}
              className="w-full"
            />
          )}
        />
      ) : (
        <ScrollArea className="flex-1">
          <div className={cn(
            "p-2",
            viewMode === 'list' && "space-y-1",
            viewMode === 'grid' && "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3",
            viewMode === 'compact' && "grid grid-cols-1 gap-0.5"
          )}>
            {results.items.map((file) => (
              <FileItem
                key={file.id}
                file={file}
                onOpen={onOpenFile}
                onReveal={onRevealFile}
                onSelect={onSelectFile}
                isSelected={selectedFiles.some(f => f.id === file.id)}
                searchQuery={results.query}
                className={cn(
                  viewMode === 'grid' && "aspect-square flex-col items-start p-4",
                  viewMode === 'compact' && "py-1.5 px-2"
                )}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Pagination */}
      {onPageChange && onNextPage && onPrevPage && (
        <div className="border-t bg-background">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            hasNextPage={hasNextPage}
            hasPrevPage={hasPrevPage}
            onPageChange={onPageChange}
            onNextPage={onNextPage}
            onPrevPage={onPrevPage}
            totalItems={results.totalCount}
            itemsPerPage={itemsPerPage}
          />
        </div>
      )}
    </div>
  );
}
