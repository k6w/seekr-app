# Changelog

All notable changes to Seekr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0]

A rewrite. The search engine, the process architecture, the interface and the
release pipeline are all new.

### Search
- Query the FTS5 index instead of scanning. The old schema built one, wrote to
  it in a way that desynced it immediately, and never issued a single MATCH;
  every keystroke ran three leading-wildcard LIKE comparisons over every row.
  Measured at 500k rows, a term matching nothing went from 129ms to 0.12ms.
- Trigram tokenizer, so substring matches are indexable. Queries under three
  characters use an indexed prefix scan, which trigram cannot serve.
- Rank over the whole match set: exact, stem, prefix, word boundary, substring,
  with penalties for depth and build directories and a lift for recent files.
- Page by keyset cursor. The offset used to be applied twice, so page 2 skipped
  results and page 3 onward was always empty.
- Report the true result count rather than the size of the page.
- Cancel superseded searches in the engine. The previous AbortController
  aborted nothing, so a slow earlier reply could overwrite newer results.
- Apply ext:, type:, size: and date: in SQL. They ran in JavaScript after the
  LIMIT, so type:image returned "images among the first 100 rows alphabetically".

### Architecture
- Move indexing, watching and querying into a utilityProcess. All of it ran on
  the main process, so a crawl froze the window, the tray and the hotkey.
- Renderers talk to the engine over a MessagePort, so search never touches main.
- Stream rows to the database during a crawl instead of accumulating the entire
  filesystem in memory before the first insert.
- Index directories and dotfiles. The indexer and the watcher disagreed about
  whether directories were rows, so type:folder matched nothing.
- Match exclusions on path segments, not substrings. Any directory containing
  "out", "temp", "cache", "dist", "build" or "target" anywhere in its name --
  checkout/, Layouts/, routes/, templates/ -- was silently dropped.
- Demote build directories rather than excluding them, so searching for
  node_modules still finds it.

### Security
- Replace the unfiltered ipcRenderer bridge with a typed, allowlisted API. Any
  script in the renderer could previously invoke any channel with any arguments.
- Validate every path against the index before it reaches the shell, including
  symlink resolution. Paths used to be passed through unchecked, which made a
  renderer compromise equivalent to arbitrary program execution.
- Add a Content Security Policy, sandbox, navigation guards and a
  single-instance lock. None existed.

### Interface
- A new design system: warm paper and near-black ink, with one amber signal
  reserved for match marks and the keyboard cursor.
- A hotkey palette that floats over full-screen apps, plus the full window.
- Keyboard navigation throughout. The result list was previously plain divs
  with no roles and no arrow-key handling; the app could not be used without a
  mouse.
- Copy path, move to trash, and drag results into other applications.
- A status bar showing result count, query time and index state.
- Fix Cmd+K and Cmd+F on macOS: every shortcut was registered Ctrl-only and
  resolved a selector that matched no element.

### Release
- asarUnpack native modules, ship both macOS architectures, sign and notarize.
  The build was arm64-only and unsigned, so Intel Macs got nothing and everyone
  else met Gatekeeper.
- Auto-update, which did not exist in any form.
- 112 tests, and a CI job that launches the packaged binary and asserts the
  engine answers. CI previously only checked that a file had been produced.


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
