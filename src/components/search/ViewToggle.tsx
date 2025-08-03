import React from 'react';
import { List, Grid3X3, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ViewMode = 'list' | 'grid' | 'compact';

interface ViewToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  className?: string;
}

const VIEW_OPTIONS = [
  { mode: 'list' as ViewMode, icon: List, label: 'List View' },
  { mode: 'grid' as ViewMode, icon: LayoutGrid, label: 'Grid View' },
  { mode: 'compact' as ViewMode, icon: Grid3X3, label: 'Compact View' },
];

export function ViewToggle({ viewMode, onViewModeChange, className }: ViewToggleProps) {
  return (
    <div className={cn("flex items-center gap-1 p-1 bg-muted rounded-lg", className)}>
      {VIEW_OPTIONS.map(({ mode, icon: Icon, label }) => (
        <Button
          key={mode}
          variant={viewMode === mode ? "default" : "ghost"}
          size="sm"
          onClick={() => onViewModeChange(mode)}
          className="h-8 w-8 p-0"
          title={label}
        >
          <Icon className="h-4 w-4" />
        </Button>
      ))}
    </div>
  );
}
