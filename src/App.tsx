import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, Settings as SettingsIcon, HardDrive, Loader2, ShieldAlert } from 'lucide-react'
import { SearchInput } from '@/components/search/SearchInput'
import { ResultList } from '@/components/search/ResultList'
import { DragDropZone } from '@/components/search/DragDropZone'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { TitleBar } from '@/components/ui/title-bar'
import { NotificationContainer, useNotifications } from '@/components/ui/notification'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { Button } from '@/components/ui/button'
import { useFileSearch } from '@/hooks/useFileSearch'
import { useIndexing } from '@/hooks/useIndexing'
import { useGlobalHotkeys } from '@/hooks/useHotkeys'
import { useTheme } from '@/hooks/useTheme'

function App() {
  const {
    query,
    rows,
    total,
    elapsedMs,
    isLoading,
    hasMore,
    error,
    search,
    loadMore,
    openFile,
    revealFile,
    copyPath,
    trashFile,
  } = useFileSearch()

  useTheme()
  const { notifications, addNotification, removeNotification } = useNotifications()
  const [showSettings, setShowSettings] = useState(false)

  const { isIndexing, progress, fileCount, currentPath, deniedPaths, startIndexing } = useIndexing({
    onComplete: (count, denied) => {
      addNotification({
        type: 'success',
        title: 'Indexing complete',
        message: `${count.toLocaleString()} items indexed.`,
        duration: 4000,
      })
      if (denied.length > 0) {
        addNotification({
          type: 'warning',
          title: `${denied.length} folders could not be read`,
          message: 'Grant Full Disk Access so Seekr can index them.',
          duration: 10000,
        })
      }
    },
    onError: (message) =>
      addNotification({ type: 'error', title: 'Indexing failed', message, duration: 8000 }),
  })

  const searchInputRef = useRef<HTMLInputElement>(null)
  useGlobalHotkeys({ searchInputRef, onStartIndexing: () => void startIndexing() })

  // Tray and menu commands. Mounts once; every handler below is stable.
  useEffect(() => {
    const unsubscribers = [
      window.seekr.events.onFocusSearch(() => searchInputRef.current?.focus()),
      window.seekr.events.onOpenSettings(() => setShowSettings(true)),
      window.seekr.events.onStartIndexingFromTray(() => void startIndexing()),
      window.seekr.events.onWatcherLimit(() =>
        addNotification({
          type: 'warning',
          title: 'Live updates are limited',
          message: 'The system watch limit was reached. Raise fs.inotify.max_user_watches.',
          duration: 10000,
        }),
      ),
    ]
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [startIndexing, addNotification])

  const handleFolderDrop = useCallback(
    (folderPath: string) => void startIndexing([folderPath]),
    [startIndexing],
  )

  const isEmptyIndex = fileCount === 0 && !isIndexing
  const statusText = isIndexing
    ? `Indexing… ${progress.toFixed(0)}% · ${fileCount.toLocaleString()} found`
    : `${fileCount.toLocaleString()} items indexed`

  return (
    <ErrorBoundary>
      <DragDropZone onFolderDrop={handleFolderDrop}>
        {/*
          h-screen with a min-h-0 flex child, so the RESULT LIST scrolls rather
          than the document. The old shell was `min-h-[500px]` with no bound, so
          its scroll area resolved to auto height and the whole page scrolled.
        */}
        <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
          <TitleBar />

          <header className="shrink-0 border-b px-3 py-2">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <SearchInput
                ref={searchInputRef}
                value={query}
                onChange={search}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label="Settings"
                onClick={() => setShowSettings(true)}
              >
                <SettingsIcon className="h-4 w-4" />
              </Button>
            </div>
          </header>

          {error && (
            <div role="alert" className="shrink-0 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {deniedPaths.length > 0 && (
            <button
              type="button"
              onClick={() => void window.seekr.system.openFullDiskAccessSettings()}
              className="flex shrink-0 items-center gap-2 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-700 hover:bg-amber-500/15 dark:text-amber-400"
            >
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">
                {deniedPaths.length} folders are unreadable. Grant Full Disk Access to index them.
              </span>
              <span className="shrink-0 underline">Open Settings</span>
            </button>
          )}

          <main className="flex min-h-0 flex-1 flex-col">
            {isEmptyIndex ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <HardDrive className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">No index yet</p>
                  <p className="text-sm text-muted-foreground">
                    Build one to start searching, or drop a folder here.
                  </p>
                </div>
                <Button size="sm" onClick={() => void startIndexing()}>
                  Build index
                </Button>
              </div>
            ) : (
              <ResultList
                rows={rows}
                isLoading={isLoading}
                hasMore={hasMore}
                onLoadMore={loadMore}
                onOpen={(row) => void openFile(row.fullPath)}
                onReveal={(row) => void revealFile(row.fullPath)}
                onCopyPath={(row) => void copyPath(row.fullPath)}
                onTrash={(row) => void trashFile(row.fullPath)}
                emptyMessage={query.trim() ? `No matches for "${query.trim()}"` : 'Type to search'}
              />
            )}
          </main>

          {/* Status bar: index freshness and query cost, which the app never showed. */}
          <footer className="flex shrink-0 items-center justify-between border-t px-3 py-1.5 text-xs text-muted-foreground">
            <span aria-live="polite" className="truncate">
              {isIndexing && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
              {query.trim() && total !== null
                ? `${total.toLocaleString()} result${total === 1 ? '' : 's'} · ${elapsedMs}ms`
                : statusText}
            </span>
            <span className="ml-3 truncate text-right opacity-70">
              {isIndexing ? currentPath : '↑↓ navigate · ⏎ open · ⌘⏎ reveal'}
            </span>
          </footer>

          <SettingsPanel open={showSettings} onOpenChange={setShowSettings} />
          <NotificationContainer notifications={notifications} onRemove={removeNotification} />
        </div>
      </DragDropZone>
    </ErrorBoundary>
  )
}

export default App
