import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, Settings, HardDrive, Loader2 } from 'lucide-react'
import { SearchInput } from '@/components/search/SearchInput'
import { SearchResults } from '@/components/search/SearchResults'
import { SearchFilters } from '@/components/search/SearchFilters'
import { DragDropZone } from '@/components/search/DragDropZone'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import { TitleBar } from '@/components/ui/title-bar'
import { NotificationContainer, useNotifications } from '@/components/ui/notification'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useFileSearch } from '@/hooks/useFileSearch'
import { useIndexing } from '@/hooks/useIndexing'
import { useGlobalHotkeys } from '@/hooks/useHotkeys'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'

const ONBOARDING_COMPLETED_KEY = 'seekr-onboarding-completed'

function App() {
  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    isLoading,
    error,
    filters,
    currentPage,
    totalPages,
    hasNextPage,
    hasPrevPage,
    itemsPerPage,
    search,
    updateFilters,
    openFile,
    revealFile,
    goToPage,
    nextPage,
    prevPage,
  } = useFileSearch()

  const { resolvedTheme } = useTheme()
  const { notifications, addNotification, removeNotification } = useNotifications()

  const [showSettings, setShowSettings] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  const { isIndexing, progress, fileCount, startIndexing } = useIndexing({
    onComplete: (count) => {
      if (count > 0) {
        addNotification({
          type: 'success',
          title: 'Indexing complete',
          message: `${count.toLocaleString()} files indexed.`,
          duration: 4000,
        })
      }
    },
    onError: (message) => {
      addNotification({ type: 'error', title: 'Indexing failed', message, duration: 8000 })
    },
  })

  const searchInputRef = useRef<HTMLInputElement>(null)
  useGlobalHotkeys({ searchInputRef })

  // Onboarding shows only on a genuinely empty index, and only once.
  useEffect(() => {
    if (fileCount === 0 && !localStorage.getItem(ONBOARDING_COMPLETED_KEY)) {
      setShowOnboarding(true)
    }
  }, [fileCount])

  // Tray and menu commands. Mounts once: the handlers below are all stable.
  useEffect(() => {
    const unsubscribers = [
      window.seekr.events.onFocusSearch(() => searchInputRef.current?.focus()),
      window.seekr.events.onOpenSettings(() => setShowSettings(true)),
      window.seekr.events.onStartIndexingFromTray(() => void startIndexing()),
    ]
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [startIndexing])

  const handleFolderDrop = useCallback(
    async (folderPath: string) => {
      await startIndexing([folderPath])
    },
    [startIndexing],
  )

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false)
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
  }, [])

  const handleOnboardingStartIndexing = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
    void startIndexing()
  }, [startIndexing])

  return (
    <ErrorBoundary>
      <DragDropZone onFolderDrop={handleFolderDrop}>
        <div className="flex h-screen flex-col bg-background">
          <TitleBar />

          <header className="z-40 shrink-0 border-b bg-background/80 backdrop-blur-sm">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Search className="h-5 w-5 text-primary" />
                  <h1 className="text-base font-semibold">Seekr</h1>
                </div>

                {fileCount > 0 && !isIndexing && (
                  <Badge variant="secondary" className="text-xs tabular-nums">
                    {fileCount.toLocaleString()} indexed
                  </Badge>
                )}

                {isIndexing && (
                  <Badge variant="outline" className="text-xs tabular-nums">
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Indexing {progress.toFixed(0)}% · {fileCount.toLocaleString()}
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                {fileCount === 0 && !isIndexing && (
                  <Button onClick={() => void startIndexing()} size="sm">
                    <HardDrive className="mr-2 h-4 w-4" />
                    Start Indexing
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Settings"
                  onClick={() => setShowSettings(true)}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </header>

          {/*
            The app frame is h-screen and this region is min-h-0 flex-1, so the
            RESULT LIST scrolls rather than the document. Previously the results
            shell was `min-h-[500px]` with no bound, so its ScrollArea resolved
            to auto height and the whole page scrolled instead.
          */}
          <main className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4">
            <div className="shrink-0 space-y-3">
              <SearchInput
                ref={searchInputRef}
                value={searchQuery}
                onChange={setSearchQuery}
                onSearch={search}
              />

              <SearchFilters filters={filters} onFiltersChange={updateFilters} />

              {error && (
                <Card className="border-destructive bg-destructive/5 p-3" role="alert">
                  <p className="text-sm text-destructive">{error}</p>
                </Card>
              )}
            </div>

            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border shadow-sm',
                resolvedTheme === 'dark' ? 'bg-background/60' : 'bg-background/80',
              )}
            >
              <SearchResults
                results={searchResults}
                isLoading={isLoading}
                onOpenFile={openFile}
                onRevealFile={revealFile}
                currentPage={currentPage}
                totalPages={totalPages}
                hasNextPage={hasNextPage}
                hasPrevPage={hasPrevPage}
                itemsPerPage={itemsPerPage}
                onPageChange={goToPage}
                onNextPage={nextPage}
                onPrevPage={prevPage}
              />
            </div>
          </main>

          <OnboardingWizard
            isVisible={showOnboarding}
            onComplete={handleOnboardingComplete}
            onStartIndexing={handleOnboardingStartIndexing}
          />

          <SettingsPanel open={showSettings} onOpenChange={setShowSettings} />

          <NotificationContainer notifications={notifications} onRemove={removeNotification} />
        </div>
      </DragDropZone>
    </ErrorBoundary>
  )
}

export default App
