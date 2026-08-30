import { useCallback, useEffect, useState } from 'react'
import { Monitor, Moon, RefreshCw, Sun } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'
import { usePlatform } from '@/hooks/usePlatform'
import { cn } from '@/lib/utils'

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${units[exponent]}`
}

export interface SettingsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const { theme, setTheme } = useTheme()
  const platform = usePlatform()

  const [stats, setStats] = useState<{
    fileCount: number
    databaseBytes: number
    indexedRoots: string[]
  } | null>(null)
  const [isReindexing, setIsReindexing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStats(await window.seekr.index.stats())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read engine stats')
    }
  }, [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  /**
   * Rebuilds the index.
   *
   * The previous version hardcoded `paths: ['C:\\', 'D:\\']`, so this button
   * did nothing at all on macOS and Linux. Roots now come from the main
   * process, which resolves them per platform.
   */
  const handleReindex = useCallback(async () => {
    setIsReindexing(true)
    setError(null)
    try {
      await window.seekr.index.start()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start indexing')
    } finally {
      setIsReindexing(false)
    }
  }, [onOpenChange])

  const modifier = platform?.isMac ? '⌘' : 'Ctrl+'
  const shortcuts: Array<[string, string]> = [
    [`${modifier}K`, 'Focus search'],
    ['↑ ↓', 'Move through results'],
    ['⏎', 'Open'],
    [platform?.isMac ? '⌘⏎' : 'Ctrl+⏎', 'Reveal in folder'],
    [`${modifier}C`, 'Copy path'],
    [platform?.isMac ? '⌘⌫' : 'Ctrl+Del', 'Move to Trash'],
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle className="text-base">Settings</DialogTitle>
      </DialogHeader>

      <DialogContent className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Appearance</h3>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => setTheme(value)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border p-3 text-xs transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  theme === value ? 'border-primary bg-accent' : 'hover:bg-accent/50',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Index</h3>

          {/*
            These three fields replace hardcoded badges that read "Real-time
            watching enabled", "FTS5 search enabled" and "Fuzzy matching
            enabled" -- none bound to anything, and two of them untrue.
          */}
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Items indexed</dt>
              <dd className="tabular-nums">{stats ? stats.fileCount.toLocaleString() : '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Database size</dt>
              <dd className="tabular-nums">{stats ? formatBytes(stats.databaseBytes) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="shrink-0 text-muted-foreground">Watching</dt>
              <dd className="truncate text-right" title={stats?.indexedRoots.join(', ')}>
                {stats?.indexedRoots.length ? stats.indexedRoots.join(', ') : 'Not watching'}
              </dd>
            </div>
          </dl>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleReindex()}
            disabled={isReindexing}
            className="w-full"
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', isReindexing && 'animate-spin')} />
            {isReindexing ? 'Starting…' : 'Rebuild index'}
          </Button>

          {platform?.isMac && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void window.seekr.system.openFullDiskAccessSettings()}
              className="w-full"
            >
              Open Full Disk Access settings
            </Button>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Keyboard</h3>
          <dl className="space-y-1 text-sm">
            {shortcuts.map(([keys, description]) => (
              <div key={keys} className="flex justify-between">
                <dt className="text-muted-foreground">{description}</dt>
                <dd>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {keys}
                  </kbd>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </DialogContent>

      <DialogFooter>
        <DialogClose onClick={() => onOpenChange(false)}>Done</DialogClose>
      </DialogFooter>
    </Dialog>
  )
}

export default SettingsPanel
