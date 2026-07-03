import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

// Fast unit tests for the pure layers (src/shared + pure src/main parsers).
// Electron-dependent code stays covered by the verify:* headless smokes.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
