import React from 'react';
import {
  File,
  Folder,
  FileText,
  Image,
  Video,
  Music,
  Archive,
  Code,
  MoreHorizontal,
  ExternalLink,
  FolderOpen
} from 'lucide-react';
import { FileItem as FileItemType, FileType } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HighlightedText } from './HighlightedText';
import { cn } from '@/lib/utils';

interface FileItemProps {
  file: FileItemType;
  onOpen: (file: FileItemType) => void;
  onReveal: (file: FileItemType) => void;
  className?: string;
  isSelected?: boolean;
  onSelect?: (file: FileItemType) => void;
  searchQuery?: string;
}

const getFileIcon = (type: FileType, isDirectory: boolean) => {
  if (isDirectory) return Folder;
  
  switch (type) {
    case FileType.DOCUMENT:
      return FileText;
    case FileType.IMAGE:
      return Image;
    case FileType.VIDEO:
      return Video;
    case FileType.AUDIO:
      return Music;
    case FileType.ARCHIVE:
      return Archive;
    case FileType.CODE:
      return Code;
    default:
      return File;
  }
};

const getFileTypeColor = (type: FileType) => {
  switch (type) {
    case FileType.DOCUMENT:
      return 'text-blue-500';
    case FileType.IMAGE:
      return 'text-green-500';
    case FileType.VIDEO:
      return 'text-purple-500';
    case FileType.AUDIO:
      return 'text-orange-500';
    case FileType.ARCHIVE:
      return 'text-yellow-500';
    case FileType.CODE:
      return 'text-red-500';
    case FileType.DIRECTORY:
      return 'text-blue-600';
    default:
      return 'text-gray-500';
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const formatDate = (date: Date): string => {
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString();
  }
};

export function FileItem({
  file,
  onOpen,
  onReveal,
  className,
  isSelected = false,
  onSelect,
  searchQuery = ''
}: FileItemProps) {
  const IconComponent = getFileIcon(file.type, file.isDirectory);
  const iconColor = getFileTypeColor(file.type);

  const handleClick = () => {
    if (onSelect) {
      onSelect(file);
    } else {
      onOpen(file);
    }
  };

  const handleDoubleClick = () => {
    onOpen(file);
  };

  const handleRevealClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReveal(file);
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-3 p-3 rounded-lg transition-all duration-150",
        "hover:bg-muted/50 cursor-pointer",
        "border border-transparent hover:border-border",
        isSelected && "bg-primary/10 border-primary/20",
        className
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* File Icon */}
      <div className="flex-shrink-0">
        <IconComponent className={cn("h-5 w-5", iconColor)} />
      </div>

      {/* File Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm truncate">
            <HighlightedText text={file.name} query={searchQuery} />
          </h3>
          {file.extension && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {file.extension.replace('.', '')}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
          <span className="truncate max-w-xs">
            <HighlightedText
              text={file.path === '.' ? 'Root' : file.path}
              query={searchQuery}
              highlightClassName="bg-yellow-200/50 dark:bg-yellow-800/50"
            />
          </span>
          <span>•</span>
          <span>{formatDate(file.dateModified)}</span>
          {!file.isDirectory && (
            <>
              <span>•</span>
              <span>{formatFileSize(file.size)}</span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRevealClick}
          className="h-8 w-8 p-0"
          title="Show in folder"
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(file);
          }}
          className="h-8 w-8 p-0"
          title="Open file"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
