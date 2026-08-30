import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron'
import react from '@vitejs/plugin-react'

/**
 * Three separate Electron bundles:
 *
 *   main.js     - windows, tray, shell verbs, permissions. Owns no index.
 *   engine.js   - runs in a utilityProcess; owns the database and the crawler.
 *   preload.cjs - the allowlisted bridge, plus the renderer's engine client.
 *
 * The preload must be CommonJS: a sandboxed renderer runs preloads without an
 * ESM loader, so a .mjs preload silently fails to load and `window.seekr` is
 * never defined.
 */
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart: ({ startup }) => startup(),
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: { external: ['electron', 'better-sqlite3', 'chokidar'] },
          },
        },
      },
      {
        entry: 'electron/engine/engine.ts',
        onstart: () => {
          // Reloaded by the main process, not restarted independently.
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: { entryFileNames: 'engine.js' },
              external: ['electron', 'better-sqlite3', 'chokidar'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart: ({ reload }) => reload(),
        vite: {
          build: {
            outDir: 'dist-electron',
            // Vite ignores rollupOptions.output.format in library mode, so the
            // format has to be set here. Getting this wrong is silent and
            // total: the preload emits ESM, a sandboxed renderer has no ESM
            // loader for preloads, the script never runs, window.seekr is
            // never defined, and the window renders blank with no error.
            lib: {
              entry: path.join(__dirname, 'electron/preload.ts'),
              formats: ['cjs'],
              fileName: () => 'preload.cjs',
            },
            rollupOptions: { external: ['electron'] },
          },
        },
      },
    ]),
  ],
  build: {
    rollupOptions: {
      // Two renderer entries: the browsing window and the hotkey overlay.
      input: {
        main: path.resolve(__dirname, "index.html"),
        overlay: path.resolve(__dirname, "overlay.html"),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
