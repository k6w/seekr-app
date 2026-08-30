import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rollupOptions: {
              // Sandboxed renderers run the preload WITHOUT an ESM loader, so a
              // .mjs preload silently fails to load and `window.seekr` is never
              // defined. It must be a single bundled CommonJS file.
              output: { format: 'cjs', entryFileNames: 'preload.cjs' },
              external: ['electron'],
            },
          },
        },
      },
      // The renderer is sandboxed and has no Node access; polyfilling Node
      // built-ins into it would only mask mistakes.
      renderer: undefined,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
