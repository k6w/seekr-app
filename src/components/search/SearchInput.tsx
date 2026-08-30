import React, { forwardRef, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}

/**
 * The query field.
 *
 * Deliberately has no debounce of its own. It used to run a 300ms timer on top
 * of the 300ms debounce inside the search hook, so real keystroke-to-result
 * latency was ~600ms and a spurious empty search fired on mount.
 *
 * It also sets `type="text"` explicitly. The shared Input component rendered
 * `type={type}` and no call site ever supplied one, so React omitted the
 * attribute -- which is why the `input[type="text"]` selector that Cmd+K
 * depended on matched no element at all.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, placeholder = 'Search files and folders…', className, autoFocus = true },
  forwardedRef,
) {
  const localRef = useRef<HTMLInputElement | null>(null)

  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      localRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      // React types RefObject.current as readonly, but assigning through a
      // forwarded object ref is the documented way to share one.
      else if (forwardedRef) {
        const objectRef = forwardedRef as React.MutableRefObject<HTMLInputElement | null>
        objectRef.current = node
      }
    },
    [forwardedRef],
  )

  /**
   * Arrow keys and Enter belong to the result list, but the caret should stay
   * in the input -- that is what makes a launcher feel right. Focus moves to
   * the listbox and the key is replayed there.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape' && value) {
        event.preventDefault()
        onChange('')
        return
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return

      const list = document.querySelector<HTMLElement>('[role="listbox"]')
      if (!list) return

      event.preventDefault()
      list.focus()
      list.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          bubbles: true,
        }),
      )
    },
    [value, onChange],
  )

  return (
    <div className={cn('relative flex items-center', className)}>
      <input
        ref={setRefs}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-label="Search files and folders"
        className="h-8 w-full bg-transparent pr-7 text-sm outline-none placeholder:text-muted-foreground"
      />

      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('')
            localRef.current?.focus()
          }}
          className="absolute right-0 flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  )
})
