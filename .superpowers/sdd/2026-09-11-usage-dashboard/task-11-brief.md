### Task 11: 双语字典 locales.ts(TDD)

**Files:**
- Create: packages/client-ui-usage/src/client/locales.ts
- Test: packages/client-ui-usage/tests/locales.spec.ts

**Interfaces:**
- Produces: export const NS = 'usage';zh(as const 事实源)/ en: Record<UsageKey, string>;export type UsageKey = keyof typeof zh;declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { usage: UsageKey } }。
- 必备 key(实现时按组件需要追加,保持 zh 为源):nav、summary.title、buckets.uncachedInput、buckets.output、buckets.cacheRead、buckets.cacheWrite、buckets.total、estimate.disclaimer、providers.title、models.title、daily.title、sessions.title、sessions.untitled、state.scanning、state.empty、state.error、state.retry、state.serviceMissing、unpriced.notice、share.of。

- [ ] **Step 1: 写失败测试**

```
ts
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('usage locale', () => {
  it('keeps en keys aligned with the zh source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: pnpm --filter dsh-client-ui-usage exec vitest run tests/locales.spec.ts
Expected: FAIL。

- [ ] **Step 3: 实现 locales.ts**

模式照抄 packages/client-ui-git/src/client/locales.ts:zh as const、en: Record<UsageKey, string>、NS 常量、declare module 合并。zh 文案定稿:'nav': '使用统计'、'state.scanning': '正在扫描会话历史…'、'estimate.disclaimer': '金额为按价目表估算,可能与实际账单不一致'、'unpriced.notice': '以下模型未配置单价,未计入金额:{models}'、'state.serviceMissing': '使用统计服务未安装或未响应'、'sessions.untitled': '(无标题会话)'。

- [ ] **Step 4: 运行确认通过,然后 Commit**

```
bash
git add packages/client-ui-usage/src/client/locales.ts packages/client-ui-usage/tests/locales.spec.ts
git commit -m "feat(client-ui-usage): bilingual usage dictionaries"
```

---

