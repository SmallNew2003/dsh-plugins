import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['packages/*/tests/**/*.spec.ts', 'packages/*/tests/**/*.spec.tsx'],
    environmentMatchGlobs: [
      ['packages/client-ui-git/tests/**', 'jsdom'],
    ],
  },
})
