import { describe, expect, it } from 'vitest'
import { priceBuckets } from '../src/price.ts'

const pricing = { input: 0.2, cacheRead: 0.02, cacheWrite: 0.2, output: 1.2 }

describe('priceBuckets', () => {
  it('converts each bucket at its unit price', () => {
    const usd = priceBuckets({ uncachedInputTokens: 1_000_000, outputTokens: 500_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 0 }, pricing)
    expect(usd).toBeCloseTo(0.2 + 0.6 + 0.04, 10)
  })

  it('returns 0 for an all-zero fold', () => {
    expect(priceBuckets({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, pricing)).toBe(0)
  })
})
