import { defineConfig, configDefaults } from 'vitest/config'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

// Two projects (W4a):
// - logic: fast node-env tests for the pure layers (src/shared + pure src/main parsers).
// - renderer: jsdom component tests with window.moss mocked at the preload seam
//   (tests/helpers/mossMock.ts). Electron-dependent main-process code stays covered
//   by the verify:* headless smokes.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'logic',
          include: ['tests/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'tests/renderer/**'],
          environment: 'node'
        }
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'renderer',
          include: ['tests/renderer/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['tests/renderer/setup.ts']
        }
      }
    ]
  }
})
