import React, { useState, useEffect } from 'react';
import { Clock, TrendingUp, X, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { cn } from '@/lib/utils';

interface SearchSuggestionsProps {
  isVisible: boolean;
  onSelectSuggestion: (query: string) => void;
  onClose: () => void;
  className?: string;
}

const SEARCH_OPERATORS = [
  { operator: 'ext:pdf', description: 'Find PDF files' },
  { operator: 'type:image', description: 'Find image files' },
  { operator: 'type:document', description: 'Find document files' },
  { operator: 'size:>100MB', description: 'Find large files' },
  { operator: 'date:today', description: 'Files modified today' },
  { operator: 'date:week', description: 'Files from last week' },
];

export function SearchSuggestions({
  isVisible,
  onSelectSuggestion,
  onClose,
  className
}: SearchSuggestionsProps) {
  const { getRecentSearches, removeFromHistory, clearHistory } = useSearchHistory();
  const [recentSearches, setRecentSearches] = useState(getRecentSearches(8));

  useEffect(() => {
    if (isVisible) {
      setRecentSearches(getRecentSearches(8));
    }
  }, [isVisible, getRecentSearches]);

  if (!isVisible) return null;

  const handleSuggestionClick = (query: string) => {
    onSelectSuggestion(query);
    onClose();
  };

  const handleRemoveSearch = (query: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeFromHistory(query);
    setRecentSearches(getRecentSearches(8));
  };

  return (
    <div className={cn(
      "absolute top-full left-0 right-0 z-50 mt-2",
      "bg-background/95 backdrop-blur-md border rounded-lg shadow-xl",
      "max-h-96 overflow-hidden animate-in slide-in-from-top",
      "border-border/50",
      className
    )}>
      <div className="p-4 space-y-4">
        {/* Recent Searches */}
        {recentSearches.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Recent Searches
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearHistory}
                className="text-xs h-6 px-2"
              >
                Clear all
              </Button>
            </div>
            
            <div className="space-y-1">
              {recentSearches.map((item) => (
                <div
                  key={`${item.query}-${item.timestamp}`}
                  className="flex items-center justify-between p-2 rounded hover:bg-muted/50 cursor-pointer group"
                  onClick={() => handleSuggestionClick(item.query)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Search className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm truncate">{item.query}</span>
                    {item.resultCount !== undefined && (
                      <Badge variant="outline" className="text-xs">
                        {item.resultCount} results
                      </Badge>
                    )}
                  </div>
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleRemoveSearch(item.query, e)}
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search Operators */}
        <div>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Search Operators
          </h3>
          
          <div className="grid grid-cols-1 gap-1">
            {SEARCH_OPERATORS.map((item) => (
              <div
                key={item.operator}
                className="flex items-center justify-between p-2 rounded hover:bg-muted/50 cursor-pointer"
                onClick={() => handleSuggestionClick(item.operator)}
              >
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                    {item.operator}
                  </code>
                  <span className="text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tips */}
        <div className="pt-2 border-t">
          <div className="text-xs text-muted-foreground space-y-1">
            <p><kbd className="bg-muted px-1 rounded">Ctrl+K</kbd> to focus search</p>
            <p><kbd className="bg-muted px-1 rounded">Esc</kbd> to clear search</p>
            <p><kbd className="bg-muted px-1 rounded">Enter</kbd> to search</p>
          </div>
        </div>
      </div>
    </div>
  );
}
