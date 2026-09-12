import { describe, expect, it } from 'vitest'
import { buildNormalizer, type ModelRegistryData } from '../src/registry.ts'

const data: ModelRegistryData = {
  providers: { deepseek: { displayName: 'DeepSeek', aliases: ['ds'] } },
  models: {
    'deepseek-v4-flash': {
      displayName: 'DeepSeek V4 Flash',
      aliases: ['ds-v4-flash', 'deepseek-v4-flash-20260115'],
      pricing: { input: 0.2, cacheRead: 0.02, cacheWrite: 0.2, output: 1.2 },
    },
  },
}

describe('buildNormalizer', () => {
  const normalizer = buildNormalizer(data)

  it('maps exact and aliased model ids to the canonical entry', () => {
    expect(normalizer.normalize('deepseek', 'deepseek-v4-flash').modelKey).toBe('deepseek-v4-flash')
    expect(normalizer.normalize('deepseek', 'ds-v4-flash').modelKey).toBe('deepseek-v4-flash')
    expect(normalizer.normalize('deepseek', 'DeepSeek-V4-Flash').modelKey).toBe('deepseek-v4-flash')
  })

  it('strips date suffixes and provider prefixes as fallback candidates', () => {
    expect(normalizer.normalize('deepseek', 'deepseek-v4-flash-20260115').modelKey).toBe('deepseek-v4-flash')
    expect(normalizer.normalize('deepseek', 'ds-v4-flash-20260301').modelKey).toBe('deepseek-v4-flash')
  })

  it('normalizes provider aliases and carries the provider display name', () => {
    const route = normalizer.normalize('ds', 'ds-v4-flash')
    expect(route.providerKey).toBe('deepseek')
    expect(route.providerDisplayName).toBe('DeepSeek')
  })

  it('keeps unrecognized models under their raw id, unpriced', () => {
    const route = normalizer.normalize('mystery', 'goblin-9x')
    expect(route.recognized).toBe(false)
    expect(route.modelKey).toBe('goblin-9x')
    expect(route.displayName).toBe('goblin-9x')
  })

  it('answers modelEntry only for canonical keys', () => {
    expect(normalizer.modelEntry('deepseek-v4-flash')?.displayName).toBe('DeepSeek V4 Flash')
    expect(normalizer.modelEntry('ds-v4-flash')).toBeUndefined()
  })

  it('derives a stable version from the registry content', () => {
    expect(normalizer.version).toMatch(/^v1:[0-9a-f]{16}$/)
    expect(buildNormalizer(data).version).toBe(normalizer.version)
    expect(buildNormalizer({ ...data, models: {} }).version).not.toBe(normalizer.version)
  })
})
