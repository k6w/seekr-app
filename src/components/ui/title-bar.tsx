import { useEffect, useState } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlatform } from '@/hooks/usePlatform'

/**
 * Custom window chrome for Windows and Linux.
 *
 * On macOS this renders only the drag region and a title: the real traffic
 * lights are drawn by the system via `titleBarStyle: 'hiddenInset'`. The old
 * version drew Windows-style min/max/close on the RIGHT on every platform,
 * including the macOS build.
 */
export function TitleBar({ title = 'Seekr' }: { title?: string }) {
  const platform = usePlatform()
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.seekr.window.isMaximized().then((value) => {
      if (!cancelled) setIsMaximized(value)
    })

    // Event-driven. The old code polled `isMaximized()` over IPC every 1000ms,
    // forever, re-rendering the title bar each time.
    const unsubscribe = window.seekr.window.onMaximizedChanged(setIsMaximized)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const isMac = platform?.isMac ?? false

  return (
    <div
      className={cn(
        'flex h-9 shrink-0 select-none items-center border-b border-border/50',
        isMac ? 'justify-center' : 'justify-between',
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Reserves space for the system traffic lights. */}
      {isMac && <div className="absolute left-0 h-9 w-20" />}

      <div className={cn('text-xs font-medium text-muted-foreground', !isMac && 'px-3')}>
        {title}
      </div>

      {!isMac && (
        <div className="flex" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            aria-label="Minimize"
            onClick={() => void window.seekr.window.minimize()}
            className="flex h-9 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
            onClick={() => void window.seekr.window.toggleMaximize()}
            className="flex h-9 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={() => void window.seekr.window.hide()}
            className="flex h-9 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}

export default TitleBar
