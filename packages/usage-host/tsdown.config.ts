import { defineConfig } from 'tsdown'

/**
 * Node-only host half. The ./shared subpath (route paths and wire payload
 * types for the client package) resolves the tsc-emitted tree directly, so
 * the bundle has a single entry.
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    // registry.ts resolves ./models.json relative to import.meta.url; the
    // bundle lands in lib/, so the builtin data must sit next to it.
    copy: ['src/models.json'],
  },
])
