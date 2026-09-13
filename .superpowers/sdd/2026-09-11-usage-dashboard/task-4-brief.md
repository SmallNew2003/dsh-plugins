### Task 4: 计价 price.ts(TDD)

**Files:**
- Create: packages/usage-host/src/price.ts
- Test: packages/usage-host/tests/price.spec.ts

**Interfaces:**
- Consumes: UsageBuckets(Task 1)、ModelPricing(Task 3)。
- Produces: priceBuckets(buckets: UsageBuckets, pricing: ModelPricing): number(USD;每桶 / 1e6 × 单价求和)。

- [ ] **Step 1: 写失败测试**

```
ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: pnpm --filter dsh-usage-host exec vitest run tests/price.spec.ts
Expected: FAIL。

- [ ] **Step 3: 实现 src/price.ts**

```
ts
/**
 * USD estimation from buckets and a unit-price row. Estimates only — never a
 * billing input; the registry table is hand-maintained.
 *
 * @module dsh-usage-host/price
 */

import type { ModelPricing } from './registry.ts'
import type { UsageBuckets } from './shared.ts'

export function priceBuckets(buckets: UsageBuckets, pricing: ModelPricing): number {
  const million = 1e6
  return (buckets.uncachedInputTokens / million) * pricing.input
    + (buckets.cacheReadTokens / million) * pricing.cacheRead
    + (buckets.cacheWriteTokens / million) * pricing.cacheWrite
    + (buckets.outputTokens / million) * pricing.output
}
```

- [ ] **Step 4: 运行确认通过,然后 Commit**

Run: pnpm --filter dsh-usage-host exec vitest run tests/price.spec.ts → PASS。

```
bash
git add packages/usage-host/src/price.ts packages/usage-host/tests/price.spec.ts
git commit -m "feat(usage-host): bucket pricing estimator"
```

---

