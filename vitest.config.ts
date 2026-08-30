import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Deliberately separate from vite.config.ts: that config loads
// vite-plugin-electron, which tries to spawn Electron on build.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
