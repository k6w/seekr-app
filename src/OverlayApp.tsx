import { useCallback, useEffect, useRef } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'
import { SearchInput } from '@/components/search/SearchInput'
import { ResultList } from '@/components/search/ResultList'
import { useFileSearch } from '@/hooks/useFileSearch'
import { usePlatform } from '@/hooks/usePlatform'
import { useTheme } from '@/hooks/useTheme'

/**
 * The overlay palette.
 *
 * Summoned by the global hotkey, dismissed on Escape or blur. It is a separate
 * window from the browsing surface but shares one engine and one design
 * system: it gets its own MessagePort, so opening it never competes with the
 * main window for the main process.
 *
 * There is no title bar, no tray affordance and no settings here — every pixel
 * is either the query or a result.
 */
export function OverlayApp() {
  useTheme()
  const platform = usePlatform()
  const inputRef = useRef<HTMLInputElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const {
    query,
    rows,
    total,
    elapsedMs,
    isLoading,
    hasMore,
    search,
    loadMore,
    clearSearch,
    openFile,
    revealFile,
    copyPath,
    trashFile,
  } = useFileSearch()

  const dismiss = useCallback(() => {
    void window.seekr.window.hide()
  }, [])

  /**
   * Report the card's height so the window can shrink to fit.
   *
   * A palette with a fixed height leaves a dead gap under two results, which
   * makes it read as a dialog instead of something ephemeral.
   */
  useEffect(() => {
    const card = cardRef.current
    if (!card) return

    const observer = new ResizeObserver(([entry]) => {
      window.seekr.overlay.resize(Math.ceil(entry.contentRect.height))
    })
    observer.observe(card)
    return () => observer.disconnect()
  }, [])

  // Reset to a clean prompt every time the window is shown, so the hotkey
  // always lands on an empty field rather than the last thing typed.
  useEffect(() => {
    return window.seekr.events.onOverlayShown(() => {
      clearSearch()
      // Focus after paint; the field is not attached before it.
      requestAnimationFrame(() => inputRef.current?.focus())
    })
  }, [clearSearch])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      // Clear a non-empty query first, then close. Closing on the first press
      // would throw away work the user can still see.
      if (query) clearSearch()
      else dismiss()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [query, clearSearch, dismiss])

  const openAndDismiss = useCallback(
    (fullPath: string) => {
      void openFile(fullPath)
      dismiss()
    },
    [openFile, dismiss],
  )

  const revealAndDismiss = useCallback(
    (fullPath: string) => {
      void revealFile(fullPath)
      dismiss()
    },
    [revealFile, dismiss],
  )

  const mod = platform?.isMac ? '⌘' : 'Ctrl'
  const hasQuery = query.trim().length > 0

  return (
    <div
      ref={cardRef}
      /*
       * Deliberately unconstrained in height: the WINDOW sizes to this card,
       * so capping the card at the viewport would make it impossible for it to
       * ever grow -- it could only ever report the height it already had.
       * The result list caps itself instead.
       */
      className="animate-overlay-in flex w-full flex-col overflow-hidden rounded-xl bg-surface text-foreground shadow-overlay"
    >
      {/* The window has no title bar, so the query strip is also the drag handle. */}
      <div className="drag-region flex items-center gap-2.5 px-3.5 py-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <SearchInput
          ref={inputRef}
          value={query}
          onChange={search}
          placeholder="Search files…"
          className="no-drag flex-1"
        />
        {hasQuery && total !== null && (
          <span className="nums shrink-0 font-mono text-2xs text-muted-foreground">
            {total.toLocaleString()} · {elapsedMs}ms
          </span>
        )}
      </div>

      {hasQuery && (
        <>
          <div className="rule-t" />
          <ResultList
            rows={rows}
            isLoading={isLoading}
            hasMore={hasMore}
            onLoadMore={loadMore}
            onOpen={(row) => openAndDismiss(row.fullPath)}
            onReveal={(row) => revealAndDismiss(row.fullPath)}
            onCopyPath={(row) => void copyPath(row.fullPath)}
            onTrash={(row) => void trashFile(row.fullPath)}
            emptyMessage={`No matches for "${query.trim()}"`}
            className="max-h-[22rem]"
          />
        </>
      )}

      {/* Key hints, so the shortcuts are discoverable without a menu. */}
      <div className="rule-t flex items-center gap-4 px-3.5 py-2 font-mono text-2xs text-muted-foreground">
        <Hint keys={<CornerDownLeft className="h-3 w-3" />} label="open" />
        <Hint keys={`${mod}↵`} label="reveal" />
        <Hint keys={`${mod}C`} label="copy path" />
        <Hint keys="esc" label={hasQuery ? 'clear' : 'close'} />
      </div>
    </div>
  )
}

function Hint({ keys, label }: { keys: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="flex h-4 min-w-4 items-center justify-center rounded border px-1 text-2xs">
        {keys}
      </kbd>
      {label}
    </span>
  )
}

export default OverlayApp
