import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SearchSuggestions } from './SearchSuggestions';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { cn } from '@/lib/utils';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function SearchInput({
  value,
  onChange,
  onSearch,
  placeholder = "Search files and folders...",
  className,
  autoFocus = true
}: SearchInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { addToHistory } = useSearchHistory();

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (value.trim()) {
        addToHistory(value.trim());
        onSearch(value);
        setShowSuggestions(false);
      }
    } else if (e.key === 'Escape') {
      if (showSuggestions) {
        setShowSuggestions(false);
      } else {
        onChange('');
      }
    } else if (e.key === 'ArrowDown' && showSuggestions) {
      e.preventDefault();
      // Focus first suggestion (could be enhanced)
    }
  }, [value, onChange, onSearch, showSuggestions, addToHistory]);

  const handleClear = useCallback(() => {
    onChange('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, [onChange]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    if (!value.trim()) {
      setShowSuggestions(true);
    }
  }, [value]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    // Delay hiding suggestions to allow clicking on them
    setTimeout(() => setShowSuggestions(false), 150);
  }, []);

  const handleSuggestionSelect = useCallback((query: string) => {
    onChange(query);
    addToHistory(query);
    onSearch(query);
    setShowSuggestions(false);
  }, [onChange, onSearch, addToHistory]);

  // Trigger search on value change with debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(value);
    }, 300);

    return () => clearTimeout(timer);
  }, [value]); // Removed onSearch from dependencies to prevent pagination reset

  // Handle clicks outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex items-center w-full max-w-2xl mx-auto",
        className
      )}
    >
      <div className={cn(
        "relative flex items-center w-full transition-all duration-300",
        "bg-background/90 backdrop-blur-md border rounded-lg",
        "shadow-sm hover:shadow-lg hover:shadow-primary/5",
        "hover:bg-background/95",
        isFocused && "ring-2 ring-primary/20 ring-offset-2 shadow-xl shadow-primary/10",
        isFocused && "bg-background/95 scale-[1.02]"
      )}>
        <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />

        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={cn(
            "pl-10 pr-10 border-0 bg-transparent",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "text-base h-12"
          )}
        />

        {value && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="absolute right-2 h-6 w-6 p-0 hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Search Suggestions */}
      <SearchSuggestions
        isVisible={showSuggestions}
        onSelectSuggestion={handleSuggestionSelect}
        onClose={() => setShowSuggestions(false)}
      />
    </div>
  );
}
