import React, { useState, useEffect } from 'react';
import { Minus, Square, X, Search } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface TitleBarProps {
  title?: string;
  className?: string;
}

export function TitleBar({ title = "File Search", className }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      if (window.windowAPI) {
        const maximized = await window.windowAPI.isMaximized();
        setIsMaximized(maximized);
      }
    };

    checkMaximized();
    
    // Listen for window state changes
    const interval = setInterval(checkMaximized, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleMinimize = async () => {
    await window.windowAPI?.minimize();
  };

  const handleMaximize = async () => {
    await window.windowAPI?.maximize();
    const maximized = await window.windowAPI?.isMaximized();
    setIsMaximized(maximized);
  };

  const handleClose = async () => {
    await window.windowAPI?.close();
  };

  return (
    <div 
      className={cn(
        "flex items-center justify-between h-8 bg-background/80 backdrop-blur-md",
        "border-b border-border/50 select-none",
        "drag-region", // Custom CSS class for draggable area
        className
      )}
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* Left side - App info */}
      <div className="flex items-center gap-2 px-3">
        <Search className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground/80">{title}</span>
      </div>

      {/* Right side - Window controls */}
      <div 
        className="flex items-center"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={handleMinimize}
          className={cn(
            "h-8 w-8 p-0 rounded-none hover:bg-muted/50",
            "transition-colors duration-150"
          )}
        >
          <Minus className="h-3 w-3" />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={handleMaximize}
          className={cn(
            "h-8 w-8 p-0 rounded-none hover:bg-muted/50",
            "transition-colors duration-150"
          )}
        >
          <Square className={cn("h-3 w-3", isMaximized && "scale-90")} />
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className={cn(
            "h-8 w-8 p-0 rounded-none hover:bg-destructive hover:text-destructive-foreground",
            "transition-colors duration-150"
          )}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
