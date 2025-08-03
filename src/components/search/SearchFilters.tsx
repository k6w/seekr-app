import React, { useState } from 'react';
import { Filter, X, Calendar, HardDrive, FileType as FileTypeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SearchFilters as SearchFiltersType, FileType } from '@/types';
import { cn } from '@/lib/utils';

interface SearchFiltersProps {
  filters: SearchFiltersType;
  onFiltersChange: (filters: SearchFiltersType) => void;
  className?: string;
}

const FILE_TYPES = [
  { type: FileType.DOCUMENT, label: 'Documents', color: 'bg-blue-500' },
  { type: FileType.IMAGE, label: 'Images', color: 'bg-green-500' },
  { type: FileType.VIDEO, label: 'Videos', color: 'bg-purple-500' },
  { type: FileType.AUDIO, label: 'Audio', color: 'bg-orange-500' },
  { type: FileType.ARCHIVE, label: 'Archives', color: 'bg-yellow-500' },
  { type: FileType.CODE, label: 'Code', color: 'bg-red-500' },
  { type: FileType.DIRECTORY, label: 'Folders', color: 'bg-blue-600' },
];

const SIZE_PRESETS = [
  { label: 'Small (< 1MB)', min: 0, max: 1024 * 1024 },
  { label: 'Medium (1-10MB)', min: 1024 * 1024, max: 10 * 1024 * 1024 },
  { label: 'Large (10-100MB)', min: 10 * 1024 * 1024, max: 100 * 1024 * 1024 },
  { label: 'Very Large (> 100MB)', min: 100 * 1024 * 1024, max: undefined },
];

const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last year', days: 365 },
];

export function SearchFilters({ filters, onFiltersChange, className }: SearchFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const updateFilters = (updates: Partial<SearchFiltersType>) => {
    onFiltersChange({ ...filters, ...updates });
  };

  const toggleFileType = (fileType: FileType) => {
    const currentTypes = filters.fileTypes || [];
    const newTypes = currentTypes.includes(fileType)
      ? currentTypes.filter(t => t !== fileType)
      : [...currentTypes, fileType];
    
    updateFilters({ fileTypes: newTypes });
  };

  const setSizeFilter = (min?: number, max?: number) => {
    updateFilters({ sizeMin: min, sizeMax: max });
  };

  const setDateFilter = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() - days);
    updateFilters({ 
      dateModifiedFrom: days === 0 ? new Date(date.getFullYear(), date.getMonth(), date.getDate()) : date,
      dateModifiedTo: days === 0 ? new Date() : undefined
    });
  };

  const clearFilters = () => {
    onFiltersChange({});
  };

  const hasActiveFilters = Object.keys(filters).some(key => {
    const value = filters[key as keyof SearchFiltersType];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  });

  const activeFilterCount = [
    filters.fileTypes?.length || 0,
    filters.sizeMin || filters.sizeMax ? 1 : 0,
    filters.dateModifiedFrom ? 1 : 0,
    filters.extensions?.length || 0,
  ].reduce((sum, count) => sum + count, 0);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Filter Toggle */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">
              {activeFilterCount}
            </Badge>
          )}
        </Button>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Clear all
          </Button>
        )}
      </div>

      {/* Active Filters */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2">
          {filters.fileTypes?.map(type => (
            <Badge
              key={type}
              variant="secondary"
              className="gap-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => toggleFileType(type)}
            >
              {FILE_TYPES.find(ft => ft.type === type)?.label}
              <X className="h-3 w-3" />
            </Badge>
          ))}
          
          {(filters.sizeMin || filters.sizeMax) && (
            <Badge
              variant="secondary"
              className="gap-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => setSizeFilter()}
            >
              Size filter
              <X className="h-3 w-3" />
            </Badge>
          )}
          
          {filters.dateModifiedFrom && (
            <Badge
              variant="secondary"
              className="gap-1 cursor-pointer hover:bg-secondary/80"
              onClick={() => updateFilters({ dateModifiedFrom: undefined, dateModifiedTo: undefined })}
            >
              Date filter
              <X className="h-3 w-3" />
            </Badge>
          )}
        </div>
      )}

      {/* Expanded Filters */}
      {isExpanded && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Filter Options</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* File Types */}
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <FileTypeIcon className="h-4 w-4" />
                File Types
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {FILE_TYPES.map(({ type, label, color }) => (
                  <Button
                    key={type}
                    variant={filters.fileTypes?.includes(type) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleFileType(type)}
                    className="justify-start gap-2"
                  >
                    <div className={cn("w-3 h-3 rounded-full", color)} />
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* File Size */}
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                File Size
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {SIZE_PRESETS.map(({ label, min, max }) => (
                  <Button
                    key={label}
                    variant="outline"
                    size="sm"
                    onClick={() => setSizeFilter(min, max)}
                    className="justify-start"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Date Modified */}
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Date Modified
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {DATE_PRESETS.map(({ label, days }) => (
                  <Button
                    key={label}
                    variant="outline"
                    size="sm"
                    onClick={() => setDateFilter(days)}
                    className="justify-start"
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Custom Extensions */}
            <div>
              <h4 className="text-sm font-medium mb-3">File Extensions</h4>
              <Input
                placeholder="e.g., .pdf, .jpg, .txt"
                value={filters.extensions?.join(', ') || ''}
                onChange={(e) => {
                  const extensions = e.target.value
                    .split(',')
                    .map(ext => ext.trim())
                    .filter(ext => ext.length > 0)
                    .map(ext => ext.startsWith('.') ? ext : '.' + ext);
                  updateFilters({ extensions });
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
