### Task 12: UsageSection 组件 + settings.section 注册(TDD)

**Files:**
- Create: packages/client-ui-usage/src/client/UsageSection.tsx
- Create: packages/client-ui-usage/src/client/UsageSection.module.css
- Modify: packages/client-ui-usage/src/client/index.ts(整体替换)
- Test: packages/client-ui-usage/tests/usage-section.spec.tsx

**Interfaces:**
- Consumes: Task 1 Row 类型、Task 10 controller、Task 11 字典。
- Produces:
  - export interface UsageSectionInjected — { readonly controller: UsageController; readonly t: TranslateNS<'usage'> }
  - export type UsageSectionProps = Partial<InjectFace<UsageSectionInjected>>(模式照抄 ui-settings-models 的 ModelsSectionProps)
  - settings.section 注册参数 — { name: 'settings.section', id: 'usage', order: 40, label: () => t('nav'), inject: () => ({ controller, t }) }
- 组件结构(区块顺序即 spec):无 controller/t → null;首帧加载 → scanning 占位;成功 → 汇总卡(四桶 + 金额 + estimate.disclaimer)→ 供应商表(行:displayName、四桶、金额、CSS 占比条;行可展开模型明细,含 displayName 与原始别名文本)→ 每日柱状(近 30 天,div 高度按当日/当日最大比)→ Top 会话表(title 缺省用 sessions.untitled、cwd 尾段、四桶、金额)→ unpriced 提示条(条件渲染)。scanning 为 true 时 5s 轮询直到 false。请求失败 → state.error + state.retry 按钮重取。不使用 close prop。

- [ ] **Step 1: 写失败测试(直喂 props,不经 ctx.slots)**

```
tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { UsageSection } from '../src/client/UsageSection.tsx'
import { zh } from '../src/client/locales.ts'
import type { UsageSummaryResponse } from 'dsh-usage-host/shared'

const SUMMARY: UsageSummaryResponse = {
  generatedAt: 0,
  scanning: false,
  sessionCount: 2,
  skippedSessions: 0,
  totals: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 },
  providers: [{
    provider: 'deepseek',
    displayName: 'DeepSeek',
    buckets: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 },
    share: 1,
    models: [{
      model: 'deepseek-v4-flash',
      displayName: 'DeepSeek V4 Flash',
      recognized: true,
      aliases: ['ds-v4-flash'],
      buckets: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 },
      usd: 0.83,
    }],
  }],
  daily: [{ date: '2026-09-11', buckets: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 } }],
  topSessions: [{ sessionId: 's1', title: '大项目', cwd: '/tmp/x', createdAt: 0, buckets: { uncachedInputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 } }],
  unpricedModels: [],
  estimate: { totalUsd: 0.83 },
}

const t = (key: string, vars?: Record<string, string | number>): string => {
  let text = (zh as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll('{' + name + '}', String(value))
  return text
}

function mount(response: UsageSummaryResponse, fetchSummary = vi.fn().mockResolvedValue(response)) {
  const controller = { fetchSummary } as never
  render(<UsageSection controller={controller} t={t as never} />)
  return fetchSummary
}

describe('UsageSection', () => {
  it('renders provider rows with model detail and estimate', async () => {
    mount(SUMMARY)
    await waitFor(() => expect(screen.getByText('DeepSeek')).toBeTruthy())
    expect(screen.getByText('DeepSeek V4 Flash')).toBeTruthy()
    expect(screen.getByText('大项目')).toBeTruthy()
  })

  it('keeps polling while scanning and stops when settled', async () => {
    vi.useFakeTimers()
    const fetchSummary = vi.fn()
      .mockResolvedValueOnce({ ...SUMMARY, scanning: true })
      .mockResolvedValueOnce(SUMMARY)
    mount(SUMMARY, fetchSummary)
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(5_000)
    vi.useRealTimers()
    expect(fetchSummary).toHaveBeenCalledTimes(2)
  })

  it('renders the unpriced notice when models lack pricing', async () => {
    const unpriced: UsageSummaryResponse = {
      ...SUMMARY,
      estimate: undefined,
      unpricedModels: ['goblin-9x'],
      providers: [{
        ...SUMMARY.providers[0]!,
        models: [{ model: 'goblin-9x', displayName: 'goblin-9x', recognized: false, aliases: [], buckets: SUMMARY.totals, usd: undefined }],
      }],
    }
    mount(unpriced)
    await waitFor(() => expect(screen.getByText(/goblin-9x/)).toBeTruthy())
  })

  it('shows the error state with retry after a failed fetch', async () => {
    mount(SUMMARY, vi.fn().mockRejectedValue(new Error('boom')))
    await waitFor(() => expect(screen.getByText(t('state.error'))).toBeTruthy())
    expect(screen.getByText(t('state.retry'))).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: pnpm --filter dsh-client-ui-usage exec vitest run tests/usage-section.spec.tsx
Expected: FAIL。

- [ ] **Step 3: 实现 UsageSection.tsx + .module.css + 注册(整体替换 src/client/index.ts)**

组件实现要点(按上游 ui-settings-models/ModelsSection.tsx 的 inject-face 模式展开为完整代码):
- useState<UsageSummaryResponse | undefined> + useState<'loading' | 'ready' | 'error'>;effect:controller.fetchSummary() → ready;response.scanning → setTimeout 5s 重取(cleanup 清 timer);catch → error。
- 数字格式化本地 helper:formatTokens(n)(≥1e6 → x.xM;≥1e3 → x.xK;否则 String(n));formatUsd(n) 保留 2 位小数,前缀 $。
- 占比条:外层 div.bar 内层 span.barFill,宽度 Math.round(row.share * 100) + '%'。
- 展开模型明细:useState<ReadonlySet<string>> 记录展开的 providerKey,行头点击切换。
- CSS Module 类:.section .cards .card .cardValue .cardLabel .table .bar .barFill .daily .column .notice .error .retry,lightningcss 由 Task 9 配好的 tsdown 插件编译。
- 金额展示旁始终渲染 t('estimate.disclaimer')。

src/client/index.ts 整体替换为:

```
ts
/**
 * Browser half: the usage settings section. Data rides the inject face (one
 * shared UsageController); the shell renders nav chrome.
 *
 * @module dsh-client-ui-usage/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the shell's SlotMap merge ('settings.section').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: locale + SlotRegistry Context merges.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { UsageController } from './controller.ts'
import { UsageSection } from './UsageSection.tsx'
import { en, NS, zh } from './locales.ts'

export type { UsageKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    usage: keyof typeof zh
  }
}

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale']

/** Inject face consumed by UsageSection. */
export interface UsageSectionInjected {
  readonly controller: UsageController
  readonly t: TranslateNS<typeof NS>
}

/** Register the usage section once the settings.section declaration commits. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-usage: dictionaries')

  const controller = new UsageController()
  const t = ctx.locale.bind(NS) as UsageSectionInjected['t']

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 40,
    label: () => t('nav'),
    inject: (): UsageSectionInjected => ({ controller, t }),
  }, UsageSection))
}
```

若 TranslateNS / InjectFace 在 @deepseek-ai/dsh-client-ui-slots 的实际导出名不同(以 node_modules 内 .d.ts 为准,对照 client-ui-git 的 import 写法),修正 import 即可,模式不变。

- [ ] **Step 4: 运行确认通过**

Run: pnpm --filter dsh-client-ui-usage exec vitest run
Expected: PASS(controller/locales/usage-section 全绿)。

- [ ] **Step 5: 构建 + 纯度自查**

Run: pnpm --filter dsh-client-ui-usage build && grep -c "deepseek-ai" packages/client-ui-usage/lib/client.js
Expected: 构建退出码 0;grep 计数 0(@deepseek-ai 值不进 bundle)。

- [ ] **Step 6: Commit**

```
bash
git add packages/client-ui-usage
git commit -m "feat(client-ui-usage): settings usage-statistics section"
```

---

