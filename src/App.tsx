import React, { useState, useEffect } from 'react';
import { Search, Settings, HardDrive, Loader2 } from 'lucide-react';
import { SearchInput } from '@/components/search/SearchInput';
import { SearchResults } from '@/components/search/SearchResults';
import { SearchFilters } from '@/components/search/SearchFilters';
import { DragDropZone } from '@/components/search/DragDropZone';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import { TitleBar } from '@/components/ui/title-bar';
import { NotificationContainer, useNotifications } from '@/components/ui/notification';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useFileSearch } from '@/hooks/useFileSearch';
import { useGlobalHotkeys } from '@/hooks/useHotkeys';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

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
    prevPage
  } = useFileSearch();

  const { addToHistory } = useSearchHistory();
  const { resolvedTheme } = useTheme();

  // Enable global hotkeys
  useGlobalHotkeys();

  const [isIndexing, setIsIndexing] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [indexingProgress, setIndexingProgress] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isFirstRun, setIsFirstRun] = useState(false);

  const { notifications, addNotification, removeNotification } = useNotifications();

  // Check file count and first run status on startup
  useEffect(() => {
    const checkFileCount = async () => {
      try {
        const response = await window.fileSearchAPI.getFileCount();
        if (response.success) {
          setFileCount(response.data.count);

          // Check if this is first run - only show onboarding if no files AND haven't seen onboarding
          const hasSeenOnboarding = localStorage.getItem('file-search-onboarding-completed');
          const hasAutoIndexed = localStorage.getItem('file-search-auto-indexed');

          if (!hasSeenOnboarding && response.data.count === 0 && !hasAutoIndexed) {
            setIsFirstRun(true);
            setShowOnboarding(true);
          }
        }
      } catch (err) {
        console.error('Failed to get file count:', err);
      }
    };

    checkFileCount();
  }, []);

  // Listen for indexing events
  useEffect(() => {
    const handleIndexingProgress = (progress: any) => {
      setIsIndexing(progress.isIndexing);
      setIndexingProgress(progress.progress);
      if (progress.filesProcessed) {
        setFileCount(progress.filesProcessed);
      }
    };

    const handleIndexingComplete = () => {
      setIsIndexing(false);
      setIndexingProgress(100);
      // Refresh file count
      window.fileSearchAPI.getFileCount().then(response => {
        if (response.success) {
          setFileCount(response.data.count);

          // Show completion notification only if we have indexed files
          if (response.data.count > 0) {
            addNotification({
              type: 'success',
              title: 'Indexing completed',
              message: `Successfully indexed ${response.data.count.toLocaleString()} files.`,
              duration: 4000
            });
          }
        }
      });
    };

    const handleIndexingError = (error: string) => {
      setIsIndexing(false);
      addNotification({
        type: 'error',
        title: 'Indexing failed',
        message: error,
        duration: 8000
      });
    };

    window.fileSearchAPI.onIndexingProgress(handleIndexingProgress);
    window.fileSearchAPI.onIndexingComplete(handleIndexingComplete);
    window.fileSearchAPI.onIndexingError(handleIndexingError);

    // Window API event listeners with proper cleanup
    const handleFocusSearch = () => {
      const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement;
      searchInput?.focus();
    };

    const handleOpenSettings = () => {
      setShowSettings(true);
    };

    const handleAutoStartIndexing = () => {
      const hasAutoIndexed = localStorage.getItem('file-search-auto-indexed');

      // Only auto-index if we haven't done it before, no files exist, and not currently indexing
      if (fileCount === 0 && !hasAutoIndexed && !isIndexing) {
        localStorage.setItem('file-search-auto-indexed', 'true');
        handleStartIndexing();
        addNotification({
          type: 'info',
          title: 'Auto-indexing started',
          message: 'File Search is scanning your drives for the first time.',
          duration: 5000
        });
      }
    };

    const handleStartIndexingFromTray = () => {
      handleStartIndexing();
    };

    const handleShowTrayNotification = () => {
      addNotification({
        type: 'info',
        title: 'File Search minimized to tray',
        message: 'The app is still running in the background. Use Ctrl+Shift+F to show it again.',
        duration: 8000
      });
    };

    // Add listeners
    window.windowAPI?.onFocusSearch(handleFocusSearch);
    window.windowAPI?.onOpenSettings(handleOpenSettings);
    window.windowAPI?.onAutoStartIndexing(handleAutoStartIndexing);
    window.windowAPI?.onStartIndexingFromTray(handleStartIndexingFromTray);
    window.windowAPI?.onShowTrayNotification(handleShowTrayNotification);

    return () => {
      // Clean up all listeners
      window.fileSearchAPI.removeAllListeners('indexing-progress');
      window.fileSearchAPI.removeAllListeners('indexing-complete');
      window.fileSearchAPI.removeAllListeners('indexing-error');
      window.fileSearchAPI.removeAllListeners('focus-search');
      window.fileSearchAPI.removeAllListeners('open-settings');
      window.fileSearchAPI.removeAllListeners('auto-start-indexing');
      window.fileSearchAPI.removeAllListeners('start-indexing-from-tray');
      window.fileSearchAPI.removeAllListeners('show-tray-notification');
    };
  }, [fileCount, addNotification]);

  const handleStartIndexing = async (customPaths?: string[]) => {
    // Prevent multiple indexing operations
    if (isIndexing) {
      console.log('Indexing already in progress, skipping...');
      return;
    }

    try {
      setIsIndexing(true);
      setIndexingProgress(0);

      let pathsToIndex: string[] = [];

      if (customPaths && customPaths.length > 0) {
        // Use custom paths if provided
        pathsToIndex = customPaths.filter(path => typeof path === 'string');
      } else {
        // Get system drives
        const drivesResponse = await window.fileSearchAPI.getSystemDrives();
        if (drivesResponse.success && drivesResponse.data?.drives) {
          // Extract just the path strings from drive objects
          pathsToIndex = drivesResponse.data.drives.map((drive: any) => {
            if (typeof drive === 'string') {
              return drive;
            } else if (drive && typeof drive.letter === 'string') {
              return drive.letter;
            } else if (drive && typeof drive.path === 'string') {
              return drive.path;
            }
            return null;
          }).filter((path: string | null): path is string => path !== null);
        }

        if (pathsToIndex.length === 0) {
          // Fallback to user-friendly paths instead of system drives
          if (process.platform === 'win32') {
            pathsToIndex = [
              'C:\\Users',
              'C:\\Documents and Settings', // For older Windows
              'D:\\' // Common secondary drive
            ].filter(path => path); // Filter out any undefined paths
          } else {
            pathsToIndex = ['/home', '/Users']; // User directories on Unix-like systems
          }
        }
      }

      console.log('Starting indexing with paths:', pathsToIndex);

      // Show immediate feedback
      addNotification({
        type: 'info',
        title: 'Starting indexing...',
        message: `Scanning: ${pathsToIndex.join(', ')}`,
        duration: 3000
      });

      const response = await window.fileSearchAPI.startIndexing({
        paths: pathsToIndex,
        excludePaths: [
          'node_modules',
          '.git',
          'System Volume Information',
          '$Recycle.Bin',
          'pagefile.sys',
          'hiberfil.sys'
        ]
      });

      if (!response.success) {
        console.error('Failed to start indexing:', response.error);
        setIsIndexing(false);
        addNotification({
          type: 'error',
          title: 'Indexing failed',
          message: response.error || 'Unknown error occurred',
          duration: 6000
        });
      }
    } catch (err) {
      console.error('Failed to start indexing:', err);
      setIsIndexing(false);
      addNotification({
        type: 'error',
        title: 'Indexing failed',
        message: err instanceof Error ? err.message : 'Unknown error occurred',
        duration: 6000
      });
    }
  };

  const handleFolderDrop = async (folderPath: string) => {
    await handleStartIndexing([folderPath]);
    addNotification({
      type: 'success',
      title: 'Folder added for indexing',
      message: `Started indexing: ${folderPath}`,
      duration: 4000
    });
  };

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    localStorage.setItem('file-search-onboarding-completed', 'true');

    addNotification({
      type: 'success',
      title: 'Welcome to File Search!',
      message: 'The app is now running in your system tray. Use Ctrl+Shift+F to access it quickly.',
      duration: 6000
    });
  };

  const handleOnboardingStartIndexing = () => {
    // Mark that we've started auto-indexing from onboarding
    localStorage.setItem('file-search-auto-indexed', 'true');
    handleStartIndexing();
  };

  return (
    <ErrorBoundary>
      <DragDropZone onFolderDrop={handleFolderDrop}>
        <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex flex-col">
          {/* Custom Title Bar */}
          <TitleBar />

          {/* Header */}
          <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Search className="h-6 w-6 text-primary" />
                <h1 className="text-xl font-bold">File Search</h1>
              </div>

              {fileCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {fileCount.toLocaleString()} files indexed
                </Badge>
              )}

              {isIndexing && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Indexing {indexingProgress.toFixed(0)}%
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {fileCount.toLocaleString()} files
                  </Badge>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {fileCount === 0 && !isIndexing && (
                <Button
                  onClick={() => handleStartIndexing()}
                  size="sm"
                  data-action="start-indexing"
                >
                  <HardDrive className="h-4 w-4 mr-2" />
                  Start Indexing
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSettings(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Search Section */}
          <div className="mb-8 space-y-4">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              onSearch={search}
            />

            <SearchFilters
              filters={filters}
              onFiltersChange={updateFilters}
            />

            {error && (
              <Card className="p-4 border-destructive bg-destructive/5">
                <p className="text-sm text-destructive">{error}</p>
              </Card>
            )}
          </div>

          {/* Results Section */}
          <div className={cn(
            "rounded-lg border shadow-sm min-h-[500px] transition-all duration-200",
            resolvedTheme === 'dark'
              ? "bg-background/60 backdrop-blur-sm"
              : "bg-background/80 backdrop-blur-sm"
          )}>
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
        </div>
      </main>

          {/* Onboarding Wizard */}
          <OnboardingWizard
            isVisible={showOnboarding}
            onComplete={handleOnboardingComplete}
            onStartIndexing={handleOnboardingStartIndexing}
          />

          {/* Settings Panel */}
          <SettingsPanel
            open={showSettings}
            onOpenChange={setShowSettings}
          />

          {/* Notifications */}
          <NotificationContainer
            notifications={notifications}
            onRemove={removeNotification}
          />
        </div>
      </DragDropZone>
    </ErrorBoundary>
  );
}

export default App;
