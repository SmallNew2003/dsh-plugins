import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('usage locale', () => {
  it('keeps en keys aligned with the zh source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
