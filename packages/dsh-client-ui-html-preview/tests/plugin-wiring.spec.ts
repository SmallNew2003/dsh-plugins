/** Plugin wiring: service declaration, the toolview takeover, and the injected file reader. */

import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { HtmlPresentCard } from '../src/client/HtmlPresentCard.tsx'
import { en, NS, zh } from '../src/client/locales.ts'

describe('plugin wiring', () => {
  /** A stub client context recording slot registrations and locale dictionaries. */
  function stubCtx() {
    const registrations: { name: string; key?: string; priority?: number; locale?: string; inject?: () => unknown; component?: unknown }[] = []
    const dictionaries: { ns: string; dicts: unknown }[] = []
    const readAll = vi.fn(() => Promise.resolve({ ok: true as const, value: { data: btoa('preview') } }))
    const ctx = {
      locale: { register: (ns: string, dicts: unknown) => { dictionaries.push({ ns, dicts }) } },
      remote: { workspaceFiles: { readAll } },
      slots: {
        inject: (_name: string, contribute: () => unknown) => { contributed.push(contribute) },
        register: (options: Record<string, unknown>, component: unknown) => {
          registrations.push(options as (typeof registrations)[number])
          registrations[registrations.length - 1].component = component
          return options
        },
      },
    }
    const contributed: (() => unknown)[] = []
    return { ctx, registrations, contributed, dictionaries, readAll }
  }

  it('declares the slots, locale, and remote services', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.workspaceFiles'])
  })

  it('registers the dictionaries under the html-preview namespace', () => {
    const { ctx, dictionaries } = stubCtx()
    apply(ctx)
    expect(dictionaries).toEqual([{ ns: NS, dicts: { zh, en } }])
  })

  it('takes over the present tool row at a shadowing priority', () => {
    const { ctx, contributed, registrations } = stubCtx()
    apply(ctx)
    expect(contributed).toHaveLength(1)
    contributed[0]!()
    expect(registrations).toHaveLength(1)
    const entry = registrations[0]!
    expect(entry.name).toBe('tool.call.toolview')
    expect(entry.key).toBe('present')
    expect(entry.priority).toBeLessThan(0)
    expect(entry.locale).toBe(NS)
    expect(entry.component).toBe(HtmlPresentCard)
  })

  it('injects a file reader that decodes the workspace files remote result', async () => {
    const { ctx, contributed, registrations, readAll } = stubCtx()
    apply(ctx)
    contributed[0]!()
    const face = registrations[0]!.inject as () => { readFile: (sessionId: string, path: string, signal?: AbortSignal) => Promise<Uint8Array> }
    const { readFile } = face()
    const signal = new AbortController().signal
    await expect(readFile('sess-9', 'diagram.html', signal)).resolves.toSatisfy(bytes =>
      Array.from(bytes).join(',') === Array.from(new TextEncoder().encode('preview')).join(','),
    )
    expect(readAll).toHaveBeenCalledWith('sess-9', 'diagram.html', signal)
  })

  it('rejects a failed workspace file response', async () => {
    const { ctx, contributed, registrations, readAll } = stubCtx()
    readAll.mockResolvedValueOnce({ ok: false, error: { message: 'not found' } })
    apply(ctx)
    contributed[0]!()
    const face = registrations[0]!.inject as () => { readFile: (sessionId: string, path: string) => Promise<Uint8Array> }
    await expect(face().readFile('sess-9', 'missing.html')).rejects.toThrow('not found')
  })
})
