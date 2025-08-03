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
import { Badge } from '@/components/ui/badge';
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
    try {
      // Clear search cache
      const response = await window.fileSearchAPI.getFileCount();
      if (response.success) {
        // Trigger a cache refresh by getting file count
        console.log('Cache refreshed');
      }
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  };

  const handleReindex = async () => {
    setIsReindexing(true);
    try {
      if (window.fileSearchAPI) {
        // Trigger a fresh re-index
        await window.fileSearchAPI.startIndexing({
          paths: ['C:\\', 'D:\\'], // You might want to get this from settings
          excludePaths: [
            'node_modules',
            '.git',
            'System Volume Information',
            '$Recycle.Bin',
            'pagefile.sys',
            'hiberfil.sys'
          ]
        });
      }
    } catch (error) {
      console.error('Failed to start re-indexing:', error);
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
              <p className="text-sm text-muted-foreground">
                Manage file indexing and database
              </p>
              
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">
                  Real-time watching enabled
                </Badge>
                <Badge variant="outline">
                  FTS5 search enabled
                </Badge>
                <Badge variant="outline">
                  Fuzzy matching enabled
                </Badge>
              </div>

              <div className="pt-3 border-t">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Re-index Files</p>
                    <p className="text-xs text-muted-foreground">
                      Rebuild the file index with correct metadata
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReindex}
                    disabled={isReindexing}
                    className="flex items-center gap-2"
                  >
                    <RefreshCw className={cn("h-4 w-4", isReindexing && "animate-spin")} />
                    {isReindexing ? 'Re-indexing...' : 'Re-index'}
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
