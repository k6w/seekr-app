import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SearchRow } from '../../../electron/ipc/api'
import { ResultRow, ROW_HEIGHT } from './ResultRow'
import { cn } from '@/lib/utils'

export interface ResultListProps {
  rows: SearchRow[]
  isLoading: boolean
  hasMore: boolean
  onLoadMore: () => void
  onOpen: (row: SearchRow) => void
  onReveal: (row: SearchRow) => void
  onCopyPath: (row: SearchRow) => void
  onTrash: (row: SearchRow) => void
  emptyMessage?: string
  className?: string
}

const OVERSCAN = 8

/**
 * Virtualised, keyboard-navigable result list.
 *
 * Two problems this fixes:
 *
 *  - **Virtualisation never actually ran.** The old list gated it on
 *    `items.length > 50` while the page size was exactly 50, so the condition
 *    was never true and the windowing component was dead code.
 *  - **Results were unreachable by keyboard.** Rows were plain `<div onClick>`
 *    with no role, no tabindex and no arrow-key handling, so the app could not
 *    be used without a mouse. This is a `listbox` with a roving active
 *    descendant, which is what a screen reader needs to announce the selection.
 */
export function ResultList({
  rows,
  isLoading,
  hasMore,
  onLoadMore,
  onOpen,
  onReveal,
  onCopyPath,
  onTrash,
  emptyMessage = 'No matches',
  className,
}: ResultListProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [activeIndex, setActiveIndex] = useState(0)

  // Reset the cursor whenever the result set itself changes.
  useEffect(() => {
    setActiveIndex(0)
  }, [rows.length === 0 ? '' : rows[0]?.id])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const observer = new ResizeObserver(([entry]) => {
      setViewportHeight(entry.contentRect.height)
    })
    observer.observe(viewport)
    setViewportHeight(viewport.clientHeight)
    return () => observer.disconnect()
  }, [])

  const { start, end, offsetY } = useMemo(() => {
    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    const visible = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2
    return {
      start: first,
      end: Math.min(rows.length, first + visible),
      offsetY: first * ROW_HEIGHT,
    }
  }, [scrollTop, viewportHeight, rows.length])

  /** Keeps the keyboard cursor inside the viewport. */
  const scrollIntoView = useCallback((index: number) => {
    const viewport = viewportRef.current
    if (!viewport) return

    const top = index * ROW_HEIGHT
    const bottom = top + ROW_HEIGHT
    if (top < viewport.scrollTop) viewport.scrollTop = top
    else if (bottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = bottom - viewport.clientHeight
    }
  }, [])

  const move = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        const next = Math.max(0, Math.min(rows.length - 1, current + delta))
        scrollIntoView(next)
        return next
      })
    },
    [rows.length, scrollIntoView],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const row = rows[activeIndex]
      const pageStep = Math.max(1, Math.floor(viewportHeight / ROW_HEIGHT) - 1)

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          return move(1)
        case 'ArrowUp':
          event.preventDefault()
          return move(-1)
        case 'PageDown':
          event.preventDefault()
          return move(pageStep)
        case 'PageUp':
          event.preventDefault()
          return move(-pageStep)
        case 'Home':
          event.preventDefault()
          setActiveIndex(0)
          return scrollIntoView(0)
        case 'End':
          event.preventDefault()
          setActiveIndex(rows.length - 1)
          return scrollIntoView(rows.length - 1)
        case 'Enter':
          if (!row) return
          event.preventDefault()
          // Cmd/Ctrl+Enter reveals instead of opening.
          return event.metaKey || event.ctrlKey ? onReveal(row) : onOpen(row)
        case 'Backspace':
        case 'Delete':
          if (!row || !(event.metaKey || event.ctrlKey)) return
          event.preventDefault()
          return onTrash(row)
        case 'c':
          if (!row || !(event.metaKey || event.ctrlKey)) return
          event.preventDefault()
          return onCopyPath(row)
      }
    },
    [rows, activeIndex, viewportHeight, move, scrollIntoView, onOpen, onReveal, onTrash, onCopyPath],
  )

  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget
      setScrollTop(target.scrollTop)

      // Load the next page well before the user reaches the bottom.
      const remaining = target.scrollHeight - target.scrollTop - target.clientHeight
      if (hasMore && remaining < ROW_HEIGHT * 12) onLoadMore()
    },
    [hasMore, onLoadMore],
  )

  if (!isLoading && rows.length === 0) {
    return (
      <div className={cn('flex flex-1 items-center justify-center p-8', className)}>
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div
      ref={viewportRef}
      role="listbox"
      aria-label="Search results"
      aria-activedescendant={rows[activeIndex] ? `result-${rows[activeIndex].id}` : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={onScroll}
      className={cn(
        'flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        className,
      )}
    >
      {/* Spacer sized to the full result set so the scrollbar is truthful. */}
      <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {rows.slice(start, end).map((row, i) => (
            <ResultRow
              key={row.id}
              row={row}
              isActive={start + i === activeIndex}
              onActivate={() => setActiveIndex(start + i)}
              onOpen={() => onOpen(row)}
              onReveal={() => onReveal(row)}
              onCopyPath={() => onCopyPath(row)}
              onTrash={() => onTrash(row)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
