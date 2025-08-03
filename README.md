# Seekr 🔍

A lightning-fast, modern file search application built with Electron, React, and TypeScript. Seekr provides instant search results with fuzzy matching, beautiful glassmorphism UI, and powerful filtering capabilities.

## ✨ Features

- **⚡ Lightning Fast Search**: Instant search results with SQLite FTS5 full-text search
- **🔍 Fuzzy Matching**: Find files even with typos using advanced fuzzy search algorithms
- **🎨 Modern UI**: Beautiful glassmorphism design with dark/light theme support
- **📁 Smart Filtering**: Filter by file type, size, date modified, and more
- **🔥 Live File Watching**: Real-time index updates as files change
- **⌨️ Keyboard Shortcuts**: Navigate efficiently with customizable hotkeys
- **🖥️ Cross-Platform**: Works on Windows, macOS, and Linux
- **🎯 System Tray**: Quick access from your system tray
- **📊 File Previews**: Preview files without opening them

## 🚀 Quick Start

### This method is currently unavailable
```### Download

Download the latest release for your platform:

- **Windows**:
  - [Installer (Setup.exe)](https://github.com/k6w/seekr/releases/latest) - Full installation with shortcuts
  - [Portable (Portable.exe)](https://github.com/k6w/seekr/releases/latest) - No installation required
- **macOS**: [Seekr-Mac-1.0.0-Installer.dmg](https://github.com/k6w/seekr/releases/latest)
- **Linux**: [Seekr-Linux-1.0.0.AppImage](https://github.com/k6w/seekr/releases/latest)

### Installation

**Windows:**
- **Installer**: Download and run the Setup.exe file. Follow the installation wizard to install Seekr with Start Menu and desktop shortcuts.
- **Portable**: Download the Portable.exe file and run it directly. No installation required - perfect for USB drives or temporary use.

**macOS:** Download the .dmg file, open it, and drag Seekr to your Applications folder.

**Linux:** Download the .AppImage file, make it executable (`chmod +x Seekr-Linux-*.AppImage`), and run it.
```

## 🛠️ Development

### Prerequisites

- Node.js 20+
- npm or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/k6w/seekr-app.git
cd seekr-app

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Building for Distribution

Seekr supports building for multiple platforms:

```bash
# Build for current platform
npm run build

# Build for specific platforms
npm run build:win     # Windows (portable .exe)
npm run build:mac     # macOS (.dmg)
npm run build:linux   # Linux (AppImage)

# Test the build process
npm run test:build

# Clean build artifacts
npm run clean
```

**Platform-specific notes:**
- **Windows**: Builds both an NSIS installer (.exe) and a portable executable
  - Installer: Full installation with Start Menu shortcuts, desktop shortcut, and uninstaller
  - Portable: Single executable that runs without installation
- **macOS**: Creates a DMG installer (unsigned, may require security settings adjustment)
- **Linux**: Generates an AppImage (portable, works on most distributions)

**CI/CD**: The project includes GitHub Actions workflows that automatically build for all platforms on push to main/master branches.

### Project Structure

```
seekr/
├── src/                    # React frontend
├── components/         # Reusable UI components
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utility functions

│   └── assets/            # Static assets
├── electron/              # Electron main process
│   ├── main.ts            # Main process entry point
│   ├── preload.ts         # Preload script for IPC
│   └── services/          # Backend services
├── public/                # Public assets
└── dist/                  # Build output
```

## ⌨️ Keyboard Shortcuts

- `Ctrl/Cmd + Shift + F` - Show/Hide Seekr
- `Escape` - Close window
- `Enter` - Open selected file
- `Ctrl/Cmd + Enter` - Open file location
- `↑/↓` - Navigate results
- `Ctrl/Cmd + ,` - Open settings

## 🎨 Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Electron, Node.js, better-sqlite3 with FTS5
- **Build**: Vite, electron-builder
- **Search**: Fuse.js for fuzzy matching, SQLite FTS5 for full-text search
- **File Watching**: Chokidar for real-time file system monitoring

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Run tests: `npm test`
5. Commit your changes: `git commit -m 'Add amazing feature'`
6. Push to the branch: `git push origin feature/amazing-feature`
7. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Electron](https://electronjs.org/)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Icons from [Lucide](https://lucide.dev/)
- Search powered by [Fuse.js](https://fusejs.io/) and SQLite FTS5

## 📞 Support

- 🐛 [Report a Bug](https://github.com/k6w/seekr/issues/new?template=bug_report.md)
- 💡 [Request a Feature](https://github.com/k6w/seekr/issues/new?template=feature_request.md)
- 💬 [Discussions](https://github.com/k6w/seekr/discussions)

---

<p align="center">Made with ❤️ by <a href="https://github.com/k6w">k6w</a></p>
