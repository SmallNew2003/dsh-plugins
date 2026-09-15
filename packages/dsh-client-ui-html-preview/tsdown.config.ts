import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { defineConfig, type UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/**
 * Dual-face build: the node half bundles the tsc-emitted entry into
 * lib/index.js; the browser half bundles lib/types/client/index.js into the
 * single-file CJS closure factory lib/client.js the Web module loader
 * consumes. react and the UI primitives stay module-table externals (never
 * bundled); everything else inlines. CSS Modules compile inline and inject a
 * tagged <style> at factory execution.
 */

const id = 'dsh-client-ui-html-preview'

/** Module-table specifiers this bundle requires from the loader, verbatim. */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
] as const

const isExternal = (specifier: string): boolean =>
  (EXTERNALS as readonly string[]).includes(specifier)

/** Map a lib-relative stylesheet import back to its src file. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  const boundary = emitted.indexOf('lib' + '/' + 'types' + '/')
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + 'lib/types/'.length))
}

/** One style injector plus the hashed class map, as the virtual module body. */
function styleModule(fileId: string, cssText: string, classMap?: Record<string, string>): string {
  const tagId = id + '/' + basename(fileId)
  const lines = [
    'const css = ' + JSON.stringify(cssText) + ';',
    'const tagId = ' + JSON.stringify(tagId) + ';',
    `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
    `  const tag = document.createElement('style');`,
    '  tag.dataset.plugin = ' + JSON.stringify(id) + ';',
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  lines.push(classMap === undefined ? 'export {};' : 'export default ' + JSON.stringify(classMap) + ';')
  return lines.join('\n')
}

/** CSS Modules virtual loader: compile, inject, and export the class map. */
const cssModulesPlugin = {
  name: 'dsh-html-preview-css-modules',
  enforce: 'pre' as const,
  resolveId(source: string, importer: string | undefined): string | null {
    if (!source.endsWith('.module.css')) return null
    const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
    return '\0dsh-css:' + abs + '.mjs'
  },
  async load(virtualId: string): Promise<string | null> {
    if (!virtualId.startsWith('\0dsh-css:')) return null
    const fileId = virtualId.slice('\0dsh-css:'.length, -'.mjs'.length)
    const source = await readFile(fileId)
    const result = transform({ filename: fileId, code: source, minify: true, cssModules: true })
    const classMap: Record<string, string> = {}
    for (const [local, exp] of Object.entries(result.exports ?? {})) classMap[local] = exp.name
    return styleModule(fileId, result.code.toString(), classMap)
  },
}

const node: UserConfig = {
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  clean: false,
}

const client: UserConfig = {
  name: id + '/client',
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: isExternal,
    alwaysBundle: (specifier: string) => !isExternal(specifier),
  },
  plugins: [cssModulesPlugin],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(id) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([node, client])