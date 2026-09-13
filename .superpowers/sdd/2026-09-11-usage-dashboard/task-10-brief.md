### Task 10: client controller(TDD)

**Files:**
- Create: packages/client-ui-usage/src/client/controller.ts
- Test: packages/client-ui-usage/tests/controller.spec.ts

**Interfaces:**
- Consumes: USAGE_SUMMARY_ROUTE / UsageSummaryResponse from 'dsh-usage-host/shared'。导入解析:先 cat packages/client-ui-git/tsconfig.json 看它如何解析 'dsh-git-host/shared'(paths 映射或 tsdown alias),照抄同构配置指向 packages/usage-host/src/shared.ts;tsdown 侧该常量被内联进 bundle(client-ui-git 对 dsh-git-host/shared 同样内联,常量内联无跨插件值泄漏)。
- Produces:
```
ts
export class UsageController {
  constructor(fetcher?: typeof fetch)
  /** 一次性拉取;5s TTL 内复用上次成功响应;并发调用共享同一 in-flight。 */
  fetchSummary(limit?: number): Promise<UsageSummaryResponse>
}
```

- [ ] **Step 1: 写失败测试**

fetch stub 按调用次序返回预设响应,断言:
1. URL 为 http://dsh.internal/dsh-usage/summary?limit=20(jsdom 无可信 location.origin 时回退 hostBase,逻辑照抄 client-ui-git/controller.ts)。
2. 并发两次 fetchSummary 共享一次 fetch(等同一 promise,fetch 只调一次)。
3. 非 ok 响应抛错,错误信息含状态码。
4. TTL 内重复调用返回上次成功响应不重发 fetch。

- [ ] **Step 2: 运行确认失败**

Run: pnpm --filter dsh-client-ui-usage exec vitest run tests/controller.spec.ts
Expected: FAIL。

- [ ] **Step 3: 实现 src/client/controller.ts**

```
ts
/**
 * Browser data carrier: one fetch surface for the usage summary route with a
 * short dedupe TTL. One instance per plugin life, shared through the inject
 * face.
 *
 * @module dsh-client-ui-usage/controller
 */

import { USAGE_SUMMARY_ROUTE, type UsageSummaryResponse } from 'dsh-usage-host/shared'

function hostBase(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin
  return origin !== undefined && origin !== 'null' ? origin : 'http://dsh.internal'
}

const TTL_MS = 5_000

export class UsageController {
  private readonly fetcher: typeof fetch
  private inflight: Promise<UsageSummaryResponse> | undefined
  private lastResolved: UsageSummaryResponse | undefined
  private fetchedAt = 0

  constructor(fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.fetcher = fetcher
  }

  async fetchSummary(limit = 20): Promise<UsageSummaryResponse> {
    if (this.inflight !== undefined) return this.inflight
    if (this.lastResolved !== undefined && Date.now() - this.fetchedAt < TTL_MS) return this.lastResolved
    this.inflight = this.run(limit)
      .then((response) => {
        this.fetchedAt = Date.now()
        this.lastResolved = response
        return response
      })
      .finally(() => {
        this.inflight = undefined
      })
    return this.inflight
  }

  private async run(limit: number): Promise<UsageSummaryResponse> {
    const url = new URL(USAGE_SUMMARY_ROUTE + '?limit=' + String(limit), hostBase())
    const response = await this.fetcher(url, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error('usage: summary route failed with ' + String(response.status))
    return await response.json() as UsageSummaryResponse
  }
}
```

- [ ] **Step 4: 运行确认通过,然后 Commit**

```
bash
git add packages/client-ui-usage/src/client/controller.ts packages/client-ui-usage/tests/controller.spec.ts
git commit -m "feat(client-ui-usage): summary fetch carrier"
```

---

