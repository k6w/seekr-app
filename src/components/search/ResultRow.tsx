import { memo, useMemo } from 'react'
import {
  Archive,
  Code2,
  FileText,
  Folder,
  Image as ImageIcon,
  Music,
  Video,
  File as FileIcon,
  FolderOpen,
  Copy,
  Trash2,
} from 'lucide-react'
import type { SearchRow } from '../../../electron/ipc/api'
import { cn } from '@/lib/utils'

/** Dense enough to show real result counts; the old rows were 80px. */
export const ROW_HEIGHT = 44

const ICONS: Record<string, typeof FileIcon> = {
  directory: Folder,
  document: FileText,
  image: ImageIcon,
  video: Video,
  audio: Music,
  archive: Archive,
  code: Code2,
  other: FileIcon,
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`
}

function formatDate(ms: number): string {
  if (!ms) return '—'
  const date = new Date(ms)
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days < 1) return 'Today'
  if (days < 2) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Renders the name with the engine's own match ranges highlighted.
 *
 * The previous component compiled a fresh RegExp per text part per row, per
 * render, to re-derive matches the search had already computed.
 */
function Highlighted({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  const parts = useMemo(() => {
    if (ranges.length === 0) return [{ text, match: false }]

    const segments: Array<{ text: string; match: boolean }> = []
    let cursor = 0
    for (const [start, length] of ranges) {
      if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false })
      segments.push({ text: text.slice(start, start + length), match: true })
      cursor = start + length
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false })
    return segments
  }, [text, ranges])

  return (
    <>
      {parts.map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-[2px] bg-primary/25 text-inherit">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

export interface ResultRowProps {
  row: SearchRow
  isActive: boolean
  onActivate: () => void
  onOpen: () => void
  onReveal: () => void
  onCopyPath: () => void
  onTrash: () => void
}

export const ResultRow = memo(function ResultRow({
  row,
  isActive,
  onActivate,
  onOpen,
  onReveal,
  onCopyPath,
  onTrash,
}: ResultRowProps) {
  const Icon = ICONS[row.isDirectory ? 'directory' : row.type] ?? FileIcon

  return (
    <div
      id={`result-${row.id}`}
      role="option"
      aria-selected={isActive}
      style={{ height: ROW_HEIGHT }}
      // A single click selects. It used to OPEN, so one stray click launched
      // whatever was under the pointer.
      onClick={onActivate}
      onDoubleClick={onOpen}
      // Lets the row be dragged into Finder, Explorer or another app.
      draggable
      onDragStart={(event) => {
        event.preventDefault()
        window.seekr.file.startDrag(row.fullPath)
      }}
      className={cn(
        'group flex cursor-default items-center gap-3 px-3',
        isActive ? 'bg-accent' : 'hover:bg-accent/50',
      )}
    >
      <Icon
        className={cn('h-4 w-4 shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm leading-tight">
          <Highlighted text={row.name} ranges={row.highlights} />
        </div>
        <div className="truncate text-xs leading-tight text-muted-foreground" title={row.dir}>
          {row.dir}
        </div>
      </div>

      <div className="hidden shrink-0 items-center gap-4 text-xs tabular-nums text-muted-foreground sm:flex">
        <span className="w-16 text-right">{row.isDirectory ? '—' : formatSize(row.size)}</span>
        <span className="w-20 text-right">{formatDate(row.mtimeMs)}</span>
      </div>

      {/* Revealed on hover or when this row is the keyboard cursor. */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5 transition-opacity',
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <RowAction label="Reveal in folder" onClick={onReveal} icon={FolderOpen} />
        <RowAction label="Copy path" onClick={onCopyPath} icon={Copy} />
        <RowAction label="Move to Trash" onClick={onTrash} icon={Trash2} destructive />
      </div>
    </div>
  )
})

function RowAction({
  label,
  onClick,
  icon: Icon,
  destructive,
}: {
  label: string
  onClick: () => void
  icon: typeof FileIcon
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // The row is the listbox option; keep these out of the tab order so
      // arrow-key navigation is not interrupted by per-row buttons.
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded transition-colors',
        destructive ? 'hover:bg-destructive hover:text-destructive-foreground' : 'hover:bg-background',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  )
}
