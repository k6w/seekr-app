import React, { useState, useCallback } from 'react';
import { Upload, FolderPlus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface DragDropZoneProps {
  onDrop?: (files: FileList) => void;
  onFolderDrop?: (path: string) => void;
  className?: string;
  children?: React.ReactNode;
}

export function DragDropZone({ 
  onDrop, 
  onFolderDrop, 
  className, 
  children 
}: DragDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev + 1);
    
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev - 1);
    
    if (dragCounter <= 1) {
      setIsDragOver(false);
    }
  }, [dragCounter]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragOver(false);
    setDragCounter(0);

    const { files } = e.dataTransfer;
    
    if (files && files.length > 0) {
      // Check if any items are directories
      const items = Array.from(e.dataTransfer.items);
      const hasDirectories = items.some(item => {
        const entry = item.webkitGetAsEntry?.();
        return entry?.isDirectory;
      });

      if (hasDirectories && onFolderDrop) {
        // Handle folder drops
        items.forEach(item => {
          const entry = item.webkitGetAsEntry?.();
          if (entry?.isDirectory) {
            onFolderDrop(entry.fullPath);
          }
        });
      } else if (onDrop) {
        // Handle file drops
        onDrop(files);
      }
    }
  }, [onDrop, onFolderDrop]);

  if (!children) {
    // Render as a drop zone
    return (
      <Card
        className={cn(
          "border-2 border-dashed transition-all duration-200",
          "flex flex-col items-center justify-center p-8 text-center",
          isDragOver 
            ? "border-primary bg-primary/5 scale-105" 
            : "border-muted-foreground/25 hover:border-muted-foreground/50",
          className
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className={cn(
          "transition-all duration-200",
          isDragOver ? "scale-110" : "scale-100"
        )}>
          {isDragOver ? (
            <FolderPlus className="h-12 w-12 text-primary mb-4" />
          ) : (
            <Upload className="h-12 w-12 text-muted-foreground mb-4" />
          )}
        </div>
        
        <h3 className="text-lg font-medium mb-2">
          {isDragOver ? 'Drop to add to index' : 'Drag folders here'}
        </h3>
        
        <p className="text-sm text-muted-foreground max-w-md">
          {isDragOver 
            ? 'Release to add these folders to the search index'
            : 'Drag and drop folders from your file explorer to add them to the search index'
          }
        </p>
      </Card>
    );
  }

  // Render as a wrapper around children
  return (
    <div
      className={cn(
        "relative transition-all duration-200",
        isDragOver && "ring-2 ring-primary ring-offset-2",
        className
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      
      {isDragOver && (
        <div className="absolute inset-0 bg-primary/10 backdrop-blur-sm rounded-lg flex items-center justify-center z-50">
          <div className="text-center">
            <FolderPlus className="h-8 w-8 text-primary mx-auto mb-2" />
            <p className="text-sm font-medium text-primary">
              Drop to add to search index
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
