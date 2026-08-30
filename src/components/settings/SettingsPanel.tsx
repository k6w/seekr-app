import React, { useState } from 'react';
import { 
  Settings, 
  Monitor, 
  Sun, 
  Moon, 
  Database, 
  Search,
  Trash2,
  RefreshCw
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTheme } from '@/hooks/useTheme';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { cn } from '@/lib/utils';

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const { theme, setTheme } = useTheme();
  const { history, clearHistory } = useSearchHistory();
  const [isClearing, setIsClearing] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [reindexError, setReindexError] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState<number | null>(null);

  const handleClearHistory = async () => {
    setIsClearing(true);
    try {
      clearHistory();
      // Add a small delay for UX
      await new Promise(resolve => setTimeout(resolve, 500));
    } finally {
      setIsClearing(false);
    }
  };

  const handleClearCache = async () => {
    // Previously this called getFileCount() and logged "Cache refreshed",
    // clearing nothing -- the real cache lived in useSearchCache, which the
    // panel had no reference to. Re-indexing now clears it via the
    // index-complete event; this button reports the true row count instead.
    const response = await window.seekr.index.count();
    if (response.ok) setFileCount(response.data);
  };

  const handleReindex = async () => {
    setIsReindexing(true);
    setReindexError(null);
    try {
      // Was hardcoded to ['C:\\', 'D:\\'], so this button did nothing at
      // all on macOS and Linux. Roots now come from the main process, which
      // resolves them per platform.
      const roots = await window.seekr.system.drives();
      if (!roots.ok) {
        setReindexError(roots.error);
        return;
      }

      const response = await window.seekr.index.start({ paths: roots.data.slice(0, 1) });
      if (!response.ok) setReindexError(response.error);
    } finally {
      setIsReindexing(false);
    }
  };

  const themeOptions = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Settings
        </DialogTitle>
        <DialogClose onClose={() => onOpenChange(false)} />
      </DialogHeader>

      <DialogContent className="space-y-6 max-h-[70vh] overflow-y-auto">
        {/* Theme Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              Appearance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Choose your preferred theme
              </p>
              <div className="grid grid-cols-3 gap-2">
                {themeOptions.map(({ value, label, icon: Icon }) => (
                  <Button
                    key={value}
                    variant={theme === value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme(value)}
                    className="flex flex-col gap-1 h-auto py-3"
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-xs">{label}</span>
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Search Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" />
              Search
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search History */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Search History</p>
                  <p className="text-xs text-muted-foreground">
                    {history.length} searches saved
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearHistory}
                  disabled={isClearing || history.length === 0}
                  className="gap-2"
                >
                  {isClearing ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  Clear
                </Button>
              </div>
            </div>

            {/* Cache Management */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Search Cache</p>
                  <p className="text-xs text-muted-foreground">
                    Clear cached search results
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearCache}
                  className="gap-2"
                >
                  <RefreshCw className="h-3 w-3" />
                  Clear Cache
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Indexing Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4" />
              Indexing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {/*
                These used to be three hardcoded badges reading "Real-time
                watching enabled", "FTS5 search enabled" and "Fuzzy matching
                enabled". None were bound to anything, and two are now simply
                untrue: the dead FTS5 index was dropped and fuse.js removed.
              */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Files indexed</span>
                <span className="tabular-nums font-medium">
                  {fileCount === null ? '—' : fileCount.toLocaleString()}
                </span>
              </div>

              {reindexError && (
                <p className="text-sm text-destructive" role="alert">
                  {reindexError}
                </p>
              )}

              <div className="flex items-center justify-between gap-2 border-t pt-3">
                <div className="text-sm">
                  <p className="font-medium">Rebuild index</p>
                  <p className="text-muted-foreground">
                    Rescans your home folder from scratch.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={handleClearCache}>
                    Refresh count
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReindex}
                    disabled={isReindexing}
                    className="flex items-center gap-2"
                  >
                    <RefreshCw className={cn('h-4 w-4', isReindexing && 'animate-spin')} />
                    {isReindexing ? 'Re-indexing…' : 'Re-index'}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Keyboard Shortcuts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Keyboard Shortcuts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Focus search</span>
                <kbd className="bg-muted px-2 py-1 rounded text-xs">Ctrl+K</kbd>
              </div>
              <div className="flex justify-between">
                <span>Clear search</span>
                <kbd className="bg-muted px-2 py-1 rounded text-xs">Esc</kbd>
              </div>
              <div className="flex justify-between">
                <span>Start indexing</span>
                <kbd className="bg-muted px-2 py-1 rounded text-xs">Ctrl+N</kbd>
              </div>
            </div>
          </CardContent>
        </Card>
      </DialogContent>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
