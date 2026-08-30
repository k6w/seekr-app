import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { SearchSuggestions } from './SearchSuggestions'
import { useSearchHistory } from '@/hooks/useSearchHistory'
import { cn } from '@/lib/utils'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  onSearch: (query: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value,
    onChange,
    onSearch,
    placeholder = 'Search files and folders…',
    className,
    autoFocus = true,
  },
  forwardedRef,
) {
  const [isFocused, setIsFocused] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const localRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { addToHistory } = useSearchHistory()

  // Expose the input to the parent (for Cmd+K focus) while keeping a local
  // handle for the clear button.
  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      localRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      // React types RefObject.current as readonly, but assigning through a
      // forwarded object ref is the documented way to share a ref.
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = node
    },
    [forwardedRef],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && value.trim()) {
        addToHistory(value.trim())
        onSearch(value)
        setShowSuggestions(false)
      } else if (event.key === 'Escape') {
        if (showSuggestions) setShowSuggestions(false)
        else onChange('')
      }
    },
    [value, onChange, onSearch, showSuggestions, addToHistory],
  )

  const handleClear = useCallback(() => {
    onChange('')
    setShowSuggestions(false)
    localRef.current?.focus()
  }, [onChange])

  const handleSuggestionSelect = useCallback(
    (query: string) => {
      onChange(query)
      addToHistory(query)
      onSearch(query)
      setShowSuggestions(false)
    },
    [onChange, onSearch, addToHistory],
  )

  /**
   * Search is debounced ONCE, in useFileSearch. This component previously
   * added its own 300ms timer on top of that hook's 300ms debounce, so real
   * keystroke-to-results latency was ~600ms, and it fired a spurious empty
   * search on mount.
   */
  useEffect(() => {
    onSearch(value)
    // Intentionally keyed on `value` only: onSearch identity changes with
    // filters, and re-running on that would reset pagination.
  }, [value])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className={cn('relative mx-auto flex w-full max-w-2xl items-center', className)}>
      <div
        className={cn(
          'relative flex w-full items-center rounded-lg border bg-background/90 transition-shadow',
          // No scale transform on focus: the old `scale-[1.02]` physically grew
          // the search box and shifted everything below it.
          isFocused && 'ring-2 ring-ring ring-offset-2 ring-offset-background',
        )}
      >
        <Search className="absolute left-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />

        <Input
          ref={setRefs}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setIsFocused(true)
            if (!value.trim()) setShowSuggestions(true)
          }}
          onBlur={() => {
            setIsFocused(false)
            setTimeout(() => setShowSuggestions(false), 150)
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          aria-label="Search files and folders"
          role="combobox"
          aria-expanded={showSuggestions}
          aria-autocomplete="list"
          className="h-11 border-0 bg-transparent pl-10 pr-10 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
        />

        {value && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            aria-label="Clear search"
            className="absolute right-2 h-6 w-6 p-0 hover:bg-muted"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </Button>
        )}
      </div>

      <SearchSuggestions
        isVisible={showSuggestions}
        onSelectSuggestion={handleSuggestionSelect}
        onClose={() => setShowSuggestions(false)}
      />
    </div>
  )
})
