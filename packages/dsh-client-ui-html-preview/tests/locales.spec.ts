import { describe, expect, it } from 'vitest'
import { en, NS, zh } from '../src/client/locales.ts'

/** The complete copy contract of the plugin, spelled out so a dropped key fails here. */
const EXPECTED_KEYS = [
  'row.title',
  'row.running',
  'row.ok',
  'row.error',
  'row.stopped',
  'row.inspect',
  'preview.title',
  'preview.more',
  'preview.download',
  'preview.saveImage',
  'preview.copyCode',
  'preview.viewCode',
  'preview.hideCode',
  'preview.saveImageError',
  'preview.loading',
  'preview.error',
  'preview.tooLarge',
  'preview.frameLabel',
] as const

describe('html-preview locales', () => {
  it('names the html-preview namespace', () => {
    expect(NS).toBe('html-preview')
  })

  it('defines exactly the expected copy keys in zh', () => {
    expect(Object.keys(zh).sort()).toEqual([...EXPECTED_KEYS].sort())
  })

  it('mirrors every zh key into en', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('keeps every translation non-empty', () => {
    for (const [namespace, dictionary] of [['zh', zh], ['en', en]] as const) {
      for (const [key, value] of Object.entries(dictionary)) {
        expect(value, namespace + '.' + key).not.toBe('')
      }
    }
  })

  it('keeps interpolation placeholders aligned across locales', () => {
    const placeholders = (template: string): readonly string[] =>
      [...template.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1])
    for (const key of Object.keys(zh)) {
      expect(placeholders(en[key] ?? ''), 'en.' + key).toEqual(placeholders(zh[key]))
    }
  })
})
