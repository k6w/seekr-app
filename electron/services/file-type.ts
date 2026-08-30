import path from 'node:path'
import { FileType } from '../../src/types'

/**
 * Single source of truth for extension -> FileType.
 * Previously duplicated verbatim (~45 lines) in both indexer.ts and
 * file-watcher.ts, so the two writers were guaranteed to drift.
 */
const EXTENSIONS_BY_TYPE: ReadonlyArray<readonly [FileType, readonly string[]]> = [
  [FileType.DOCUMENT, ['.pdf', '.doc', '.docx', '.txt', '.md', '.rtf', '.odt', '.pages',
    '.xls', '.xlsx', '.csv', '.numbers', '.ppt', '.pptx', '.key', '.epub']],
  [FileType.IMAGE, ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico',
    '.tiff', '.tif', '.heic', '.heif', '.avif', '.raw', '.cr2', '.nef', '.psd']],
  [FileType.VIDEO, ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg']],
  [FileType.AUDIO, ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.opus', '.wma', '.m4a', '.aiff']],
  [FileType.ARCHIVE, ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.zst', '.dmg', '.iso']],
  [FileType.CODE, ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.kt', '.c',
    '.h', '.cpp', '.hpp', '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.sh', '.zsh',
    '.html', '.css', '.scss', '.less', '.json', '.jsonc', '.xml', '.yaml', '.yml',
    '.toml', '.sql', '.graphql', '.vue', '.svelte']],
]

const TYPE_BY_EXTENSION = new Map<string, FileType>(
  EXTENSIONS_BY_TYPE.flatMap(([type, extensions]) => extensions.map((ext) => [ext, type] as const)),
)

export function getFileType(fileName: string, isDirectory: boolean): FileType {
  if (isDirectory) return FileType.DIRECTORY
  return TYPE_BY_EXTENSION.get(path.extname(fileName).toLowerCase()) ?? FileType.OTHER
}
