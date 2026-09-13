import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['packages/*/tests/**/*.spec.ts', 'packages/*/tests/**/*.spec.tsx'],
    environmentMatchGlobs: [
      ['packages/dsh-client-ui-git/tests/**', 'jsdom'],
      ['packages/dsh-client-ui-memory/tests/**', 'jsdom'],
      ['packages/dsh-client-ui-usage/tests/**', 'jsdom'],
    ],
  },
})
