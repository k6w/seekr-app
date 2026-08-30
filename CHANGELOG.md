# Changelog

All notable changes to Seekr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- Replaced the unfiltered `ipcRenderer` bridge with a typed, allowlisted `window.seekr` API. The renderer could previously invoke any IPC channel with any arguments.
- Every path from the renderer is now validated against the index before reaching `shell.openPath` / `showItemInFolder`, including symlink resolution and containment checks. Paths were previously passed through unvalidated, so a renderer compromise meant arbitrary program execution.
- Added a Content Security Policy, `sandbox: true`, a window-open handler, a navigation guard and a single-instance lock. None existed before.
- Moved settings out of renderer `localStorage` into a main-process store.

### Fixed
- Pagination past page 2. The offset was applied twice — once in SQL and again as a slice — so page 2 skipped 50 results and page 3 onward was always empty.
- `totalCount` reported the page size rather than the true match count, capping the result set at two pages.
- Path exclusions matched substrings of the whole path, so any directory containing `out`, `temp`, `cache`, `dist`, `build` or `target` anywhere in its name — `checkout/`, `Layouts/`, `routes/`, `templates/` — was silently dropped from the index. Now matched by path segment, and build-artifact directories are rank-demoted rather than excluded.
- Filters were applied in JavaScript after the SQL `LIMIT`, so `type:image` returned "images among the first 100 rows alphabetically". They are now applied in SQL.
- `type:image` matched nothing on one of the two query-parser code paths, which uppercased the value while the database stores it lowercase. There is now a single parser.
- Indexing accumulated the entire filesystem walk in memory before writing a single row. Rows are now streamed in batches, so peak memory is bounded and progress survives interruption.
- Directories are indexed, so `type:folder` works. The indexer and the file watcher previously disagreed about whether directories were rows.
- Dotfiles are indexed. Every entry starting with `.` or `# Changelog

All notable changes to Seekr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

 was skipped unconditionally.
- `Cmd+K` and `Cmd+F` on macOS. All shortcuts were registered Ctrl-only, and resolved a selector that matched no element.
- The file watcher became a permanent no-op after its first call, so re-indexing a new folder never watched it.
- Folder drag-and-drop passed a virtual DataTransfer path instead of a real filesystem path.
- The database connection was never closed on macOS, so the WAL was never checkpointed on quit.
- Search results were cached for 10 minutes with no invalidation on re-index.

### Changed
- Electron 30 → 43; better-sqlite3 12 → 13; dropped the duplicate npm lockfile in favour of pnpm.
- Window configuration is now platform-specific. `transparent`, `vibrancy` and `backgroundMaterial` were previously set together on every platform, which is a documented conflict on Windows and a no-op off macOS.
- macOS gets real traffic lights and a template tray icon; the custom Windows-style controls no longer render there.
- Window maximize state is event-driven instead of polled over IPC once a second.
- File watcher events are coalesced into batches instead of one database write and IPC broadcast per event.
- Removed the FTS5 table: it was never queried, was written in a way that desynced it immediately, and doubled the cost of every insert.
- Removed fuse.js: it was only reachable for queries containing a wildcard or punctuation, so the typo case it existed for never reached it.

### Added
- Vitest, with regression tests covering the path guard, the exclusion matcher and the query parser.
- A packaged-app smoke test in CI that launches the built binary and asserts the native module loads — the failure `asarUnpack` prevents, which a "did a file get produced" check cannot detect.
- `asarUnpack` for native modules, macOS signing/notarization/entitlements scaffolding, dual-arch macOS builds, and Linux deb/rpm targets.


## [1.0.0] - 2025-01-03

### Added
- ⚡ Lightning-fast file search with SQLite FTS5 full-text search
- 🔍 Fuzzy matching for finding files even with typos
- 🎨 Modern glassmorphism UI with dark/light theme support
- 📁 Smart filtering by file type, size, date modified, and more
- 🔥 Live file watching with real-time index updates
- ⌨️ Keyboard shortcuts for efficient navigation
- 🖥️ Cross-platform support (Windows, macOS, Linux)
- 🎯 System tray integration for quick access
- 📊 File preview functionality
- 🔧 Customizable search settings
- 📱 Responsive and accessible UI design
- 🚀 Electron-based desktop application
- 💾 Local SQLite database for fast indexing
- 🔄 Background file indexing
- 📋 Copy file paths and open file locations
- 🎪 Drag and drop support
- 🔍 Advanced search operators
- 📈 Search performance metrics
- 🎨 Beautiful animations and transitions
- 🔐 Privacy-focused (all data stays local)

### Technical Features
- Built with React 18 and TypeScript
- Tailwind CSS for styling with shadcn/ui components
- Vite for fast development and building
- Electron for cross-platform desktop app
- SQLite with FTS5 for full-text search
- Fuse.js for fuzzy matching
- Chokidar for file system watching
- Lucide React for beautiful icons

### Developer Experience
- Comprehensive TypeScript types
- ESLint configuration for code quality
- Hot reload during development
- Automated builds with electron-builder
- GitHub Actions for CI/CD
- Comprehensive documentation
- Contributing guidelines
- Issue and PR templates

---

## Release Notes Format

### Added
- New features

### Changed
- Changes in existing functionality

### Deprecated
- Soon-to-be removed features

### Removed
- Now removed features

### Fixed
- Bug fixes

### Security
- Security improvements
