/** Plugin wiring: dictionary parity and the toolview registrations apply() makes. */

import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'
import { ENGRAM_TOOLS } from '../src/client/memory-model.ts'

describe('dictionaries', () => {
  it('mirrors the zh key set in en', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('has one action key per engram tool', () => {
    for (const tool of ENGRAM_TOOLS) {
      expect(zh).toHaveProperty('card.action.' + tool)
      expect(en).toHaveProperty('card.action.' + tool)
    }
  })
})

describe('apply', () => {
  /** A stub slots service recording its registrations. */
  function stubCtx() {
    const registrations: { name: string; key?: string }[] = []
    const ctx = {
      locale: { register: (_ns: string, dicts: { zh: unknown; en: unknown }) => dicts },
      slots: {
        inject: (_name: string, contribute: () => unknown) => {
          contributed.push(contribute)
        },
        register: (options: { name: string; key?: string }) => {
          registrations.push(options)
          return options
        },
      },
    }
    const contributed: (() => unknown)[] = []
    return { ctx, registrations, contributed }
  }

  it('declares the slots and locale services', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers one keyed toolview per engram tool and the dictionaries', () => {
    const { ctx, registrations, contributed } = stubCtx()
    apply(ctx)
    expect(contributed).toHaveLength(ENGRAM_TOOLS.length)
    for (const contribute of contributed) contribute()
    const wired = new Set(registrations.map(options => options.key))
    expect(wired.size).toBe(ENGRAM_TOOLS.length)
    expect(wired).toContain('mcp__engram__mem_save')
    expect(wired).toContain('mcp__engram__mem_search')
    for (const options of registrations) {
      expect(options.name).toBe('tool.call.toolview')
      expect((options as { locale?: string }).locale).toBe('memory')
    }
  })
})
