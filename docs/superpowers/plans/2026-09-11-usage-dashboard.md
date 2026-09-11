# DSH 供应商 Token 消耗看板 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 在 dsh-plugins 仓库新增两个插件包(host 侧聚合服务 + 浏览器侧设置页看板),统计 DSH 全部会话的供应商/模型 token 消耗并估算费用。

**Architecture:** dsh-usage-host 注入 DSH 内置 sessionQuery 服务枚举全部会话、折叠原始日志事件得到每次请求的 provider/model/token 归因,经模型名归一化与计价后以一条 webServer 路由供出;持久化增量索引按会话事件数缓存,只有变化的会话重折。dsh-client-ui-usage 注册 settings.section slot,在设置面板渲染「使用统计」页面。

**Tech Stack:** TypeScript(ESM,tsdown 构建)、vitest、React 18(jsdom 组件测试)、cordis 插件框架、node:crypto(哈希)。无新增运行时依赖。

**Spec:** docs/design/2026-09-11-usage-dashboard-design.md(计划与 spec 配套阅读;数字口径以 spec 为准)

## Global Constraints

- 零上游 deepseek-harness 源码改动;所有代码在 dsh-plugins 仓库。
- 折叠口径必须与上游 packages/llm/token-meter/src/usage-projection.ts 的 tokenUsage 投影一致:同 (turn, step) 重复样本幂等跳过;llm/retry-started 清空 last 槽使重试尝试重新累计;替换样本按 last 槽做减法。唯一扩展:last 槽携带 routeKey,减法记到原 routeKey 上。
- client 半浏览器 bundle 禁止 @deepseek-ai/* 值导入(仅 import type);所有跨插件协作经 cordis 服务或 props 注入。
- 全部产品文案走 locale 字典 NS usage,zh 为 key-set 事实源,en 键集必须对齐(测试断言)。
- 金额一律标注估算;未配置单价的模型不计入金额并列入 unpricedModels。
- 每个任务以 pnpm --filter <pkg> test(或根 pnpm test)全绿收尾后 commit。

---

### Task 1: dsh-usage-host 包脚手架 + shared.ts 线上类型

**Files:**
- Create: packages/usage-host/package.json
- Create: packages/usage-host/tsconfig.json
- Create: packages/usage-host/tsdown.config.ts
- Create: packages/usage-host/src/index.ts(占位:仅 name/apply 空实现,Task 8 整体替换)
- Create: packages/usage-host/src/shared.ts

**Interfaces:**
- Produces: USAGE_SUMMARY_ROUTE 常量;UsageBuckets / UsageSummaryResponse / ProviderUsageRow / ModelUsageRow / DailyUsageRow / SessionUsageRow 线上类型与 usageTotal(buckets) 帮助函数(Task 5 聚合、Task 8 路由、Task 10/12 client 共同消费)。

- [ ] **Step 1: 创建 package.json**

```
json
{
  "name": "dsh-usage-host",
  "description": "Host-side usage service and webServer route: cross-session provider token aggregation behind the browser trust fence",
  "version": "0.1.0",
  "license": "MIT",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./shared": { "types": "./lib/types/shared.d.ts", "default": "./lib/types/shared.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "scripts": { "build": "tsc -p tsconfig.json && tsdown", "test": "vitest run" },
  "peerDependencies": {
    "@deepseek-ai/cordis": ">=4",
    "@deepseek-ai/dsh-host-webserver": ">=0.1.0",
    "@deepseek-ai/dsh-llm": ">=0.1.0",
    "@deepseek-ai/schemastery": ">=0.1.0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "link:../../../deepseek-harness/vendor/cordis",
    "@deepseek-ai/dsh-host-webserver": "link:../../../deepseek-harness/packages/host/webserver",
    "@deepseek-ai/dsh-llm": "link:../../../deepseek-harness/packages/llm/llm",
    "@deepseek-ai/schemastery": "link:../../../deepseek-harness/vendor/schemastery",
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "tsdown": "^0.12.0",
    "vitest": "^3.0.0"
  }
}
```

若 link 目标路径在 deepseek-harness 中不存在(以 ls 验证,如 vendor/cordis),修正为实际目录后再继续。

- [ ] **Step 2: 创建 tsconfig.json 与 tsdown.config.ts**

tsconfig.json(node-only,无 DOM):
```
json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types",
    "lib": ["ES2022"]
  },
  "include": ["src"]
}
```

tsdown.config.ts:复制 packages/git-host/tsdown.config.ts 全文,原样(node-only 单入口模板,头部注释保留)。

- [ ] **Step 3: 创建 src/shared.ts**

```
ts
/**
 * Wire vocabulary shared with the browser package: the summary route path and
 * its response payload types. Browser-safe by construction (types plus one
 * pure helper).
 *
 * @module dsh-usage-host/shared
 */

/** The one usage route: GET-only, behind the connection browser trust fence. */
export const USAGE_SUMMARY_ROUTE = '/dsh-usage/summary'

/** The four disjoint provider-reported buckets. Reasoning is inside output. */
export interface UsageBuckets {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** Sum of the four buckets — the share denominator and sort key. */
export function usageTotal(buckets: UsageBuckets): number {
  return buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

/** One canonical model's usage under one provider. */
export interface ModelUsageRow {
  readonly model: string
  readonly displayName: string
  /** false = 未识别模型:aliases 即原始名,不计价。 */
  readonly recognized: boolean
  /** 归并到该 canonical 模型出现过的原始 model 名列表。 */
  readonly aliases: readonly string[]
  readonly buckets: UsageBuckets
  /** 估算金额(USD);undefined = 未配置单价。 */
  readonly usd: number | undefined
}

/** One provider row with its model breakdown. */
export interface ProviderUsageRow {
  readonly provider: string
  readonly displayName: string
  readonly buckets: UsageBuckets
  /** 0..1,分母为全部四桶总和。 */
  readonly share: number
  readonly models: readonly ModelUsageRow[]
}

/** One local-calendar day of usage. */
export interface DailyUsageRow {
  /** YYYY-MM-DD in the host's local timezone. */
  readonly date: string
  readonly buckets: UsageBuckets
}

/** One session's usage for the Top list. */
export interface SessionUsageRow {
  readonly sessionId: string
  readonly title: string | undefined
  readonly cwd: string | undefined
  readonly createdAt: number
  readonly buckets: UsageBuckets
}

/** The GET USAGE_SUMMARY_ROUTE payload. */
export interface UsageSummaryResponse {
  readonly generatedAt: number
  /** true = 后台首次/全量扫描进行中,前端应轮询。 */
  readonly scanning: boolean
  /** 已纳入统计的会话数(不含 skipped)。 */
  readonly sessionCount: number
  /** 读取/校验失败被跳过的会话数。 */
  readonly skippedSessions: number
  readonly totals: UsageBuckets
  readonly providers: readonly ProviderUsageRow[]
  readonly daily: readonly DailyUsageRow[]
  readonly topSessions: readonly SessionUsageRow[]
  /** 未配置单价、未计入金额的 canonical 模型 id。 */
  readonly unpricedModels: readonly string[]
  /** 全部已计价模型金额合计(USD 估算);undefined = 一个可计价模型都没有。 */
  readonly estimate: { readonly totalUsd: number } | undefined
}
```

- [ ] **Step 4: 创建占位 src/index.ts**

```
ts
/**
 * Host half of the usage dashboard plugin: the aggregation service plus one
 * webServer summary route behind the connection browser trust fence.
 * @module dsh-usage-host
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'dsh-usage-host'

export function apply(ctx: Context): void {
  void ctx
}
```

- [ ] **Step 5: 安装并构建验证**

Run: pnpm install && pnpm --filter dsh-usage-host build
Expected: 退出码 0,生成 lib/index.js、lib/shared.js、lib/types/*。

- [ ] **Step 6: Commit**

```
bash
git add packages/usage-host
git commit -m "feat(usage-host): package scaffold and wire types"
```

---

### Task 2: fold-usage.ts 会话日志折叠纯函数(TDD)

**Files:**
- Create: packages/usage-host/src/fold-usage.ts
- Test: packages/usage-host/tests/fold-usage.spec.ts

**Interfaces:**
- Consumes: UsageBuckets(Task 1);lastAssistantStreamChunk from @deepseek-ai/dsh-llm/assistant-stream。
- Produces:
  - interface RawUsageEvent — { type: string; time: number; data: RawUsageEventData }
  - interface RawUsageEventData — { turn?: number; step?: number; usage?: unknown; stream?: readonly unknown[]; message?: { source?: { provider?: string; model?: string } } }
  - interface SessionUsageFold — { eventCount: number; totals: UsageBuckets; routes: Map<string, UsageBuckets>; daily: Map<string, UsageBuckets> }
  - routeKey(provider, model):string —— provider、NUL 分隔符(转义序列 \u0000)、model 三段拼接;无 source 的尝试 routeKey 为 unattributed + NUL + unattributed
  - dayKeyOf(time: number): string(本地日界 YYYY-MM-DD)
  - emptyBuckets(): UsageBuckets
- 口径规则(实现必须逐条满足,测试逐条覆盖):
  1. 样本来源:data.usage 优先,否则 lastAssistantStreamChunk(data.stream, 'usage')?.usage;都没有 → 事件不计。
  2. 仅处理 assistant/message 与 assistant/attempt;llm/retry-started 在其 (turn, step) 等于 last 槽时清空 last 槽。
  3. last 槽命中同 (turn, step) 且四桶完全相等 → 幂等跳过。
  4. last 槽命中同 (turn, step) 但桶不同 → 从 last 的 routeKey、last 的日桶与 totals 减去旧桶,再加新桶(跨供应商替换也正确)。
  5. usage 四桶必须为非负安全整数(cache 缺省按 0);非法则整个事件不计。

- [ ] **Step 1: 写失败测试**

```
ts
import { describe, expect, it } from 'vitest'
import { foldSessionUsage, routeKey, type RawUsageEvent } from '../src/fold-usage.ts'

const SOURCE = { source: { provider: 'deepseek', model: 'deepseek-v4-flash' } }

function message(turn: number, step: number, usage: Record<string, number>, extra: Partial<RawUsageEvent['data']> = {}): RawUsageEvent {
  return { type: 'assistant/message', time: Date.UTC(2026, 8, 11, 2), data: { turn, step, usage, ...SOURCE, ...extra } }
}

describe('foldSessionUsage', () => {
  it('accumulates usage with provider attribution', () => {
    const fold = foldSessionUsage([
      message(1, 1, { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 5000 }),
      message(1, 2, { inputTokens: 2000, outputTokens: 300 }),
    ])
    expect(fold.eventCount).toBe(2)
    expect(fold.totals).toEqual({ uncachedInputTokens: 3000, outputTokens: 400, cacheReadTokens: 5000, cacheWriteTokens: 0 })
    expect(fold.routes.get(routeKey('deepseek', 'deepseek-v4-flash')))
      .toEqual({ uncachedInputTokens: 3000, outputTokens: 400, cacheReadTokens: 5000, cacheWriteTokens: 0 })
  })

  it('is idempotent for the same repeated (turn, step) sample', () => {
    const fold = foldSessionUsage([message(1, 1, { inputTokens: 100, outputTokens: 10 }), message(1, 1, { inputTokens: 100, outputTokens: 10 })])
    expect(fold.totals.outputTokens).toBe(10)
  })

  it('replaces the sample when the same (turn, step) reports new buckets', () => {
    const fold = foldSessionUsage([message(1, 1, { inputTokens: 100, outputTokens: 10 }), message(1, 1, { inputTokens: 150, outputTokens: 20 })])
    expect(fold.totals).toEqual({ uncachedInputTokens: 150, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })

  it('re-adds after llm/retry-started closes the slot, including across routes', () => {
    const fold = foldSessionUsage([
      message(1, 1, { inputTokens: 100, outputTokens: 10 }),
      { type: 'llm/retry-started', time: 0, data: { turn: 1, step: 1 } },
      message(1, 1, { inputTokens: 120, outputTokens: 12 }, { source: { provider: 'anthropic', model: 'claude-x' } }),
    ])
    expect(fold.totals.outputTokens).toBe(22)
    expect(fold.routes.get(routeKey('deepseek', 'deepseek-v4-flash'))?.outputTokens).toBe(10)
    expect(fold.routes.get(routeKey('anthropic', 'claude-x'))?.outputTokens).toBe(12)
  })

  it('falls back to the last stream usage record and attributes unattributed attempts', () => {
    const stream = [{ delta: 'x' }, { usage: { inputTokens: 30, outputTokens: 5 } }]
    const fold = foldSessionUsage([{ type: 'assistant/attempt', time: 0, data: { turn: 2, step: 1, stream } }])
    expect(fold.routes.get(routeKey('unattributed', 'unattributed')))
      .toEqual({ uncachedInputTokens: 30, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })

  it('ignores events with invalid usage buckets', () => {
    const fold = foldSessionUsage([message(1, 1, { inputTokens: -5, outputTokens: 1 }), message(1, 2, { inputTokens: 10, outputTokens: 2 })])
    expect(fold.totals.uncachedInputTokens).toBe(10)
  })

  it('buckets by local-calendar day and subtracts replacements from the old day', () => {
    const morning = { type: 'assistant/message', time: new Date(2026, 8, 11, 1).getTime(), data: { turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10 }, ...SOURCE } }
    const evening = { type: 'assistant/message', time: new Date(2026, 8, 11, 23).getTime(), data: { turn: 1, step: 1, usage: { inputTokens: 200, outputTokens: 20 }, ...SOURCE } }
    const fold = foldSessionUsage([morning, evening])
    expect(fold.daily.size).toBe(1)
    expect(fold.daily.get('2026-09-11')).toEqual({ uncachedInputTokens: 200, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })

  it('reports the raw event count for index keying', () => {
    const events = [message(1, 1, { inputTokens: 1, outputTokens: 1 }), { type: 'user/message', time: 0, data: {} }]
    expect(foldSessionUsage(events).eventCount).toBe(2)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: pnpm --filter dsh-usage-host exec vitest run tests/fold-usage.spec.ts
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 src/fold-usage.ts**

```
ts
/**
 * Route-attributed usage fold over one session's raw log events.
 *
 * Mirrors the upstream token-meter tokenUsage projection fold exactly, with
 * one extension: the last-wins slot carries a routeKey so replacement
 * subtracts from the route that produced the superseded sample.
 *
 * @module dsh-usage-host/fold-usage
 */

import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm/assistant-stream'
import type { UsageBuckets } from './shared.ts'

export interface RawUsageEventData {
  readonly turn?: number
  readonly step?: number
  readonly usage?: unknown
  readonly stream?: readonly unknown[]
  readonly message?: { readonly source?: { readonly provider?: string; readonly model?: string } }
}

export interface RawUsageEvent {
  readonly type: string
  readonly time: number
  readonly data: RawUsageEventData
}

export interface SessionUsageFold {
  readonly eventCount: number
  readonly totals: UsageBuckets
  readonly routes: Map<string, UsageBuckets>
  readonly daily: Map<string, UsageBuckets>
}

const UNATTRIBUTED = routeKey('unattributed', 'unattributed')

export function routeKey(provider: string, model: string): string {
  return provider + '\u0000' + model
}

export function emptyBuckets(): UsageBuckets {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function bucketsOf(usage: unknown): UsageBuckets | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined
  const record = usage as Record<string, unknown>
  const input = record['inputTokens']
  const output = record['outputTokens']
  if (!isCount(input) || !isCount(output)) return undefined
  const cacheRead = record['cacheReadTokens'] ?? 0
  const cacheWrite = record['cacheWriteTokens'] ?? 0
  if (!isCount(cacheRead) || !isCount(cacheWrite)) return undefined
  return { uncachedInputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite }
}

function sampleOf(event: RawUsageEvent): UsageBuckets | undefined {
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return bucketsOf(event.data.usage)
  const stream = event.data.stream
  if (stream === undefined) return undefined
  return bucketsOf(lastAssistantStreamChunk(stream as never, 'usage')?.usage)
}

function bucketsEqual(left: UsageBuckets, right: UsageBuckets): boolean {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
}

function addInto(map: Map<string, UsageBuckets>, key: string, buckets: UsageBuckets, sign: 1 | -1): void {
  const current = map.get(key) ?? emptyBuckets()
  map.set(key, {
    uncachedInputTokens: current.uncachedInputTokens + sign * buckets.uncachedInputTokens,
    outputTokens: current.outputTokens + sign * buckets.outputTokens,
    cacheReadTokens: current.cacheReadTokens + sign * buckets.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens + sign * buckets.cacheWriteTokens,
  })
}

/** Local-calendar YYYY-MM-DD of one epoch-ms timestamp. */
export function dayKeyOf(time: number): string {
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return String(date.getFullYear()) + '-' + month + '-' + day
}

function sourceOf(event: RawUsageEvent): string {
  const provider = event.data.message?.source?.provider
  const model = event.data.message?.source?.model
  return provider !== undefined && provider.length > 0 && model !== undefined && model.length > 0
    ? routeKey(provider, model)
    : UNATTRIBUTED
}

export function foldSessionUsage(events: readonly RawUsageEvent[]): SessionUsageFold {
  const totals = emptyBuckets()
  const routes = new Map<string, UsageBuckets>()
  const daily = new Map<string, UsageBuckets>()
  let last: { turn: number; step: number; routeKey: string; day: string; buckets: UsageBuckets } | null = null

  for (const event of events) {
    if (event.type === 'llm/retry-started') {
      if (last !== null && last.turn === event.data.turn && last.step === event.data.step) last = null
      continue
    }
    const buckets = sampleOf(event)
    if (buckets === undefined) continue
    const turn = event.data.turn
    const step = event.data.step
    if (!isCount(turn) || !isCount(step)) continue

    const key = sourceOf(event)
    const day = dayKeyOf(event.time)
    const previous = last !== null && last.turn === turn && last.step === step ? last : undefined
    if (previous !== undefined && bucketsEqual(previous.buckets, buckets)) continue

    if (previous !== undefined) {
      addInto(routes, previous.routeKey, previous.buckets, -1)
      addInto(daily, previous.day, previous.buckets, -1)
      totals.uncachedInputTokens -= previous.buckets.uncachedInputTokens
      totals.outputTokens -= previous.buckets.outputTokens
      totals.cacheReadTokens -= previous.buckets.cacheReadTokens
      totals.cacheWriteTokens -= previous.buckets.cacheWriteTokens
    }
    addInto(routes, key, buckets, 1)
    addInto(daily, day, buckets, 1)
    totals.uncachedInputTokens += buckets.uncachedInputTokens
    totals.outputTokens += buckets.outputTokens
    totals.cacheReadTokens += buckets.cacheReadTokens
    totals.cacheWriteTokens += buckets.cacheWriteTokens
    last = { turn, step, routeKey: key, day, buckets }
  }

  return { eventCount: events.length, totals, routes, daily }
}
```

- [ ] **Step 4: 运行确认通过**

Run: pnpm --filter dsh-usage-host exec vitest run tests/fold-usage.spec.ts
Expected: PASS。

- [ ] **Step 5: 对照上游口径(抽检)**

Run: grep -n "retry-started" /Users/jelvin/000_source_code/deepseek-harness/packages/llm/token-meter/src/usage-projection.ts
人工核对实现与该文件 apply() 的分支顺序一致(retry 先于样本处理、幂等先于替换)。

- [ ] **Step 6: Commit**

```
bash
git add packages/usage-host/src/fold-usage.ts packages/usage-host/tests/fold-usage.spec.ts
git commit -m "feat(usage-host): route-attributed session usage fold"
```

---



### Task 3: 模型注册表与归一化(TDD)

**Files:**
- Create: packages/usage-host/src/models.json
- Create: packages/usage-host/src/registry.ts
- Test: packages/usage-host/tests/registry.spec.ts

**Interfaces:**
- Produces:
  - interface ModelPricing — { input: number; cacheRead: number; cacheWrite: number; output: number }($/M tokens)
  - interface ModelEntry — { displayName: string; aliases?: readonly string[]; pricing?: ModelPricing }
  - interface ProviderEntry — { displayName: string; aliases?: readonly string[] }
  - interface ModelRegistryData — { providers?: Record<string, ProviderEntry>; models?: Record<string, ModelEntry> }
  - interface NormalizedRoute — { providerKey: string; providerDisplayName: string; modelKey: string; displayName: string; recognized: boolean }
  - interface Normalizer — { version: string; normalize(provider: string, rawModel: string): NormalizedRoute; modelEntry(modelKey: string): ModelEntry | undefined }
  - loadModelRegistry(overridesPath?: string): ModelRegistryData(内置 models.json + 用户覆盖文件浅合并,同名 key 覆盖)
- 归一规则 RULES_VERSION = 1:model 候选序列 = [原值, 小写化, 去 -YYYYMMDD 日期后缀(正则 /-\d{8}$/), 去 ds-/deepseek- 前缀, 组合];每个候选先查 provider 作用域别名(providerKey 小写 + NUL + candidate),再查全局别名;provider 同法(小写化 + 别名表)。version = "v1:" + sha256(JSON.stringify(data)) 前 16 个 hex 字符。

- [ ] **Step 1: 写内置 models.json(数据文件,手工维护)**

```
json
{
  "providers": {
    "deepseek": { "displayName": "DeepSeek", "aliases": ["ds"] },
    "anthropic": { "displayName": "Anthropic", "aliases": [] },
    "openai": { "displayName": "OpenAI", "aliases": [] },
    "unattributed": { "displayName": "未归因 / Unattributed", "aliases": [] }
  },
  "models": {
    "deepseek-chat": {
      "displayName": "DeepSeek Chat",
      "aliases": ["deepseek-chat-20260115", "ds-chat"],
      "pricing": { "input": 0.27, "cacheRead": 0.027, "cacheWrite": 0.27, "output": 1.1 }
    },
    "deepseek-reasoner": {
      "displayName": "DeepSeek Reasoner",
      "aliases": ["deepseek-reasoner-20260115", "ds-reasoner"],
      "pricing": { "input": 0.55, "cacheRead": 0.055, "cacheWrite": 0.55, "output": 2.19 }
    }
  }
}
```

单价为示例美元价($/M tokens),交付前按当期官方价目核对修正——这是数据修正,不是实现占位。用户覆盖文件默认路径 ~/.dsh/storages/usage-host/models.json,存在时浅合并。

- [ ] **Step 2: 写失败测试**

```
ts
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
```

- [ ] **Step 3: 运行确认失败**

Run: pnpm --filter dsh-usage-host exec vitest run tests/registry.spec.ts
Expected: FAIL。

- [ ] **Step 4: 实现 src/registry.ts**

```
ts
/**
 * Canonical model/provider registry with alias normalization.
 *
 * Raw (provider, model) pairs are never rewritten in stored data; the
 * normalizer is a view. Version = rules version + content hash, so any
 * registry edit invalidates the persisted usage index wholesale.
 *
 * @module dsh-usage-host/registry
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

const RULES_VERSION = 1

export interface ModelPricing {
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
}

export interface ModelEntry {
  readonly displayName: string
  readonly aliases?: readonly string[]
  readonly pricing?: ModelPricing
}

export interface ProviderEntry {
  readonly displayName: string
  readonly aliases?: readonly string[]
}

export interface ModelRegistryData {
  readonly providers?: Record<string, ProviderEntry>
  readonly models?: Record<string, ModelEntry>
}

export interface NormalizedRoute {
  readonly providerKey: string
  readonly providerDisplayName: string
  readonly modelKey: string
  readonly displayName: string
  readonly recognized: boolean
}

export interface Normalizer {
  readonly version: string
  normalize(provider: string, rawModel: string): NormalizedRoute
  modelEntry(modelKey: string): ModelEntry | undefined
}

/** 注册表候选键:原值优先,逐步宽松。 */
function candidateIds(raw: string): string[] {
  const lower = raw.toLowerCase()
  const noDate = lower.replace(/-\d{8}$/, '')
  const stripped = [lower, noDate].flatMap(value => [
    value,
    value.replace(/^ds-/, ''),
    value.replace(/^deepseek-/, ''),
  ])
  return [...new Set([raw, ...stripped])]
}

export function buildNormalizer(data: ModelRegistryData): Normalizer {
  const models = new Map<string, ModelEntry>(Object.entries(data.models ?? {}))
  const modelAlias = new Map<string, string>()
  for (const [key, entry] of models) {
    for (const candidate of [key, ...(entry.aliases ?? [])]) modelAlias.set(candidate.toLowerCase(), key)
  }
  const providers = new Map<string, ProviderEntry>(Object.entries(data.providers ?? {}))
  const providerAlias = new Map<string, string>()
  for (const [key, entry] of providers) {
    for (const candidate of [key, ...(entry.aliases ?? [])]) providerAlias.set(candidate.toLowerCase(), key)
  }

  function normalize(provider: string, rawModel: string): NormalizedRoute {
    const providerKey = providerAlias.get(provider.toLowerCase()) ?? provider
    const providerDisplayName = providers.get(providerKey)?.displayName ?? providerKey
    for (const candidate of candidateIds(rawModel)) {
      const scoped = modelAlias.get(providerKey.toLowerCase() + '\u0000' + candidate)
      const aliasKey = scoped ?? modelAlias.get(candidate)
      if (aliasKey !== undefined) {
        const entry = models.get(aliasKey)!
        return {
          providerKey,
          providerDisplayName,
          modelKey: aliasKey,
          displayName: entry.displayName,
          recognized: true,
        }
      }
    }
    return { providerKey, providerDisplayName, modelKey: rawModel, displayName: rawModel, recognized: false }
  }

  const version = 'v' + RULES_VERSION + ':' + createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16)
  return {
    version,
    normalize,
    modelEntry: (modelKey) => models.get(modelKey),
  }
}

/** 内置注册表 + 用户覆盖文件(存在时浅合并)。 */
export function loadModelRegistry(overridesPath?: string): ModelRegistryData {
  const builtin = JSON.parse(readFileSync(new URL('./models.json', import.meta.url), 'utf8')) as ModelRegistryData
  if (overridesPath === undefined || !existsSync(overridesPath)) return builtin
  const overrides = JSON.parse(readFileSync(overridesPath, 'utf8')) as ModelRegistryData
  return {
    providers: { ...builtin.providers, ...overrides.providers },
    models: { ...builtin.models, ...overrides.models },
  }
}
```

注:buildNormalizer 内的 scoped/global 别名键里的 \u0000 是 JS 字符串转义(NUL),与 routeKey 的分隔约定一致;models.json 的 key 本身不含 NUL。

- [ ] **Step 5: 运行确认通过**

Run: pnpm --filter dsh-usage-host exec vitest run tests/registry.spec.ts
Expected: PASS。

- [ ] **Step 6: Commit**

```
bash
git add packages/usage-host/src/models.json packages/usage-host/src/registry.ts packages/usage-host/tests/registry.spec.ts
git commit -m "feat(usage-host): canonical model registry and alias normalization"
```

---

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

### Task 5: aggregate.ts 四视图聚合(TDD)

**Files:**
- Create: packages/usage-host/src/aggregate.ts
- Test: packages/usage-host/tests/aggregate.spec.ts

**Interfaces:**
- Consumes: SessionUsageFold(Task 2)、Normalizer(Task 3)、priceBuckets(Task 4)、usageTotal 与全部 Row 类型(Task 1)。
- Produces:
  - interface AggregateInput — { sessionId: string; title?: string; cwd?: string; createdAt: number; fold: SessionUsageFold }
  - aggregateSessions(records: readonly AggregateInput[], normalizer: Normalizer, limit: number): Omit<UsageSummaryResponse, 'generatedAt' | 'scanning' | 'skippedSessions'>
  - 排序:providers 与 models 按 usageTotal 降序;daily 按日期字符串升序;topSessions 按 usageTotal 降序取前 limit;share = providerTotal / grandTotal(grandTotal 为 0 时 share = 0)。aliases 收集归并到该 canonical 的全部原始 model 名(recognized 与否都收集)。

- [ ] **Step 1: 写失败测试**

```
ts
import { describe, expect, it } from 'vitest'
import { buildNormalizer, type ModelRegistryData } from '../src/registry.ts'
import { aggregateSessions, type AggregateInput } from '../src/aggregate.ts'
import { emptyBuckets, foldSessionUsage, type RawUsageEvent } from '../src/fold-usage.ts'

const registry: ModelRegistryData = {
  providers: { deepseek: { displayName: 'DeepSeek', aliases: [] } },
  models: { 'deepseek-v4-flash': { displayName: 'DeepSeek V4 Flash', aliases: ['ds-v4-flash'] } },
}
const normalizer = buildNormalizer(registry)

function record(sessionId: string, events: RawUsageEvent[], extra: Partial<AggregateInput> = {}): AggregateInput {
  return { sessionId, createdAt: 0, fold: foldSessionUsage(events), ...extra }
}

function message(provider: string, model: string, output: number, day = 11): RawUsageEvent {
  return {
    type: 'assistant/message',
    time: new Date(2026, 8, day).getTime(),
    data: { turn: 1, step: 1, usage: { inputTokens: 0, outputTokens: output }, message: { source: { provider, model } } },
  }
}

describe('aggregateSessions', () => {
  it('groups aliased model ids under one canonical model and provider', () => {
    const result = aggregateSessions([
      record('a', [message('deepseek', 'deepseek-v4-flash', 100)]),
      record('b', [message('deepseek', 'ds-v4-flash', 50)]),
    ], normalizer, 20)
    expect(result.providers).toHaveLength(1)
    expect(result.providers[0]!.displayName).toBe('DeepSeek')
    const model = result.providers[0]!.models[0]!
    expect(model.model).toBe('deepseek-v4-flash')
    expect(model.buckets.outputTokens).toBe(150)
    expect(model.aliases).toEqual(expect.arrayContaining(['deepseek-v4-flash', 'ds-v4-flash']))
    expect(model.usd).toBeUndefined()
  })

  it('lists unrecognized models unpriced and reports them', () => {
    const result = aggregateSessions([record('a', [message('mystery', 'goblin-9x', 10)])], normalizer, 20)
    expect(result.providers[0]!.models[0]!.recognized).toBe(false)
    expect(result.providers[0]!.models[0]!.usd).toBeUndefined()
    expect(result.unpricedModels).toContain('goblin-9x')
  })

  it('prices recognized models from the registry table', () => {
    const priced = buildNormalizer({
      models: { m: { displayName: 'M', pricing: { input: 0, cacheRead: 0, cacheWrite: 0, output: 1 } } },
    })
    const result = aggregateSessions([record('a', [message('x', 'm', 1_000_000)])], priced, 20)
    expect(result.providers[0]!.models[0]!.usd).toBeCloseTo(1, 10)
    expect(result.estimate?.totalUsd).toBeCloseTo(1, 10)
    expect(result.unpricedModels).toEqual([])
  })

  it('computes provider share from the four-bucket sum', () => {
    const result = aggregateSessions([
      record('a', [message('deepseek', 'deepseek-v4-flash', 75)]),
      record('b', [message('other', 'goblin-9x', 25)]),
    ], normalizer, 20)
    expect(result.providers[0]!.share).toBeCloseTo(0.75, 6)
    expect(result.totals.outputTokens).toBe(100)
  })

  it('sorts and limits top sessions by total', () => {
    const result = aggregateSessions([
      record('small', [message('deepseek', 'deepseek-v4-flash', 1)]),
      record('big', [message('deepseek', 'deepseek-v4-flash', 9)]),
    ], normalizer, 1)
    expect(result.topSessions).toHaveLength(1)
    expect(result.topSessions[0]!.sessionId).toBe('big')
    expect(result.topSessions[0]!.buckets.outputTokens).toBe(9)
    expect(result.topSessions[0]!.title).toBeUndefined()
  })

  it('merges daily rows ascending across sessions', () => {
    const result = aggregateSessions([
      record('a', [message('deepseek', 'deepseek-v4-flash', 2, 11), message('deepseek', 'deepseek-v4-flash', 1, 10)]),
    ], normalizer, 20)
    expect(result.daily.map(row => row.date)).toEqual(['2026-09-10', '2026-09-11'])
    expect(result.daily[1]!.buckets.outputTokens).toBe(2)
  })

  it('handles an empty corpus', () => {
    const result = aggregateSessions([], normalizer, 20)
    expect(result.providers).toEqual([])
    expect(result.totals).toEqual(emptyBuckets())
    expect(result.estimate).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: pnpm --filter dsh-usage-host exec vitest run tests/aggregate.spec.ts
Expected: FAIL。

- [ ] **Step 3: 实现 src/aggregate.ts**

纯函数无 IO。结构:
1. 跨会话按 routeKey 汇总 fold.routes 到 routeBuckets;fold.daily 同法合并;totals 累加 fold.totals;sessionRows 收集。
2. 每个 routeKey 拆出 provider 与 model(NUL 分隔,indexOf 定位),经 normalizer.normalize 归一,归入 provider → model 两层 Map;aliases 收集原始 model 名;同一 canonical 命中多个 route 时桶累加。
3. 计价:normalizer.modelEntry(canonical)?.pricing → priceBuckets;无 pricing → usd: undefined 且进 unpricedModels;estimate 在任一模型有价时为 { totalUsd: Σ }。
4. provider.displayName 用 normalize 返回的 providerDisplayName。
5. 排序截断如 Interfaces 所述。

```
ts
/**
 * Pure cross-session aggregation: session folds in, the four dashboard views
 * and the price estimate out. No IO.
 *
 * @module dsh-usage-host/aggregate
 */

import { emptyBuckets, type SessionUsageFold } from './fold-usage.ts'
import { priceBuckets } from './price.ts'
import type { Normalizer } from './registry.ts'
import {
  usageTotal,
  type DailyUsageRow,
  type ModelUsageRow,
  type ProviderUsageRow,
  type SessionUsageRow,
  type UsageBuckets,
  type UsageSummaryResponse,
} from './shared.ts'

export interface AggregateInput {
  readonly sessionId: string
  readonly title?: string
  readonly cwd?: string
  readonly createdAt: number
  readonly fold: SessionUsageFold
}

type Views = Omit<UsageSummaryResponse, 'generatedAt' | 'scanning' | 'skippedSessions'>

function mergeInto(target: UsageBuckets, source: UsageBuckets): UsageBuckets {
  return {
    uncachedInputTokens: target.uncachedInputTokens + source.uncachedInputTokens,
    outputTokens: target.outputTokens + source.outputTokens,
    cacheReadTokens: target.cacheReadTokens + source.cacheReadTokens,
    cacheWriteTokens: target.cacheWriteTokens + source.cacheWriteTokens,
  }
}

export function aggregateSessions(records: readonly AggregateInput[], normalizer: Normalizer, limit: number): Views {
  const routeBuckets = new Map<string, UsageBuckets>()
  const daily = new Map<string, UsageBuckets>()
  let totals = emptyBuckets()
  const sessionRows: SessionUsageRow[] = []

  for (const record of records) {
    for (const [key, buckets] of record.fold.routes) routeBuckets.set(key, mergeInto(routeBuckets.get(key) ?? emptyBuckets(), buckets))
    for (const [day, buckets] of record.fold.daily) daily.set(day, mergeInto(daily.get(day) ?? emptyBuckets(), buckets))
    totals = mergeInto(totals, record.fold.totals)
    sessionRows.push({
      sessionId: record.sessionId,
      title: record.title,
      cwd: record.cwd,
      createdAt: record.createdAt,
      buckets: record.fold.totals,
    })
  }

  interface ModelAcc { displayName: string; recognized: boolean; aliases: Set<string>; buckets: UsageBuckets }
  interface ProviderAcc { displayName: string; buckets: UsageBuckets; models: Map<string, ModelAcc> }
  const providerAcc = new Map<string, ProviderAcc>()
  const unpriced = new Set<string>()
  let totalUsd = 0
  let anyPriced = false

  for (const [key, buckets] of routeBuckets) {
    const separator = key.indexOf('\u0000')
    const normalized = normalizer.normalize(key.slice(0, separator), key.slice(separator + 1))
    const provider = providerAcc.get(normalized.providerKey) ?? {
      displayName: normalized.providerDisplayName,
      buckets: emptyBuckets(),
      models: new Map<string, ModelAcc>(),
    }
    const model = provider.models.get(normalized.modelKey) ?? {
      displayName: normalized.displayName,
      recognized: normalized.recognized,
      aliases: new Set<string>(),
      buckets: emptyBuckets(),
    }
    model.aliases.add(key.slice(separator + 1))
    provider.buckets = mergeInto(provider.buckets, buckets)
    model.buckets = mergeInto(model.buckets, buckets)
    provider.models.set(normalized.modelKey, model)
    providerAcc.set(normalized.providerKey, provider)
  }

  const grandTotal = usageTotal(totals)
  const providers: ProviderUsageRow[] = []
  for (const [providerKey, row] of providerAcc) {
    const models: ModelUsageRow[] = []
    for (const [modelKey, model] of row.models) {
      const pricing = normalizer.modelEntry(modelKey)?.pricing
      const usd = pricing === undefined ? undefined : priceBuckets(model.buckets, pricing)
      if (usd === undefined) unpriced.add(modelKey)
      else {
        totalUsd += usd
        anyPriced = true
      }
      models.push({
        model: modelKey,
        displayName: model.displayName,
        recognized: model.recognized,
        aliases: [...model.aliases].sort(),
        buckets: model.buckets,
        usd,
      })
    }
    models.sort((left, right) => usageTotal(right.buckets) - usageTotal(left.buckets))
    providers.push({
      provider: providerKey,
      displayName: row.displayName,
      buckets: row.buckets,
      share: grandTotal === 0 ? 0 : usageTotal(row.buckets) / grandTotal,
      models,
    })
  }
  providers.sort((left, right) => usageTotal(right.buckets) - usageTotal(left.buckets))

  const dailyRows: DailyUsageRow[] = [...daily.entries()]
    .map(([date, buckets]) => ({ date, buckets }))
    .sort((left, right) => left.date.localeCompare(right.date))
  sessionRows.sort((left, right) => usageTotal(right.buckets) - usageTotal(left.buckets))

  return {
    totals,
    providers,
    daily: dailyRows,
    topSessions: sessionRows.slice(0, limit),
    unpricedModels: [...unpriced].sort(),
    estimate: anyPriced ? { totalUsd } : undefined,
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: pnpm --filter dsh-usage-host exec vitest run tests/aggregate.spec.ts
Expected: PASS。

- [ ] **Step 5: Commit**

```
bash
git add packages/usage-host/src/aggregate.ts packages/usage-host/tests/aggregate.spec.ts
git commit -m "feat(usage-host): cross-session aggregation views"
```

---



### Task 6: 增量索引 usage-index.ts(TDD)

**Files:**
- Create: packages/usage-host/src/usage-index.ts
- Test: packages/usage-host/tests/usage-index.spec.ts

**Interfaces:**
- Consumes: SessionUsageFold(Task 2)、UsageBuckets(Task 1)。
- Produces:
  - interface SessionIndexEntry — { eventCount: number; title?: string; routes: Record<string, UsageBuckets>; daily: Record<string, UsageBuckets> }
  - interface UsageIndexFile — { version: 1; normalizerVersion: string; sessions: Record<string, SessionIndexEntry> }
  - loadIndex(path, normalizerVersion): UsageIndexFile(同步;不存在/损坏 JSON/version 不匹配 → 空索引)
  - saveIndexAtomic(path, index): Promise<void>(mkdir -p + 临时文件写 + rename)
  - entryOf(fold: SessionUsageFold, title?: string): SessionIndexEntry

- [ ] **Step 1: 写失败测试(临时目录)**

用 node:fs/promises 的 mkdtemp 建临时目录,覆盖五条:
1. 空路径(不存在的文件)load 得空索引(version: 1、sessions 空)。
2. saveIndexAtomic 后 loadIndex 往返相等。
3. loadIndex 对损坏 JSON(先写入 "<not json")→ 空索引。
4. normalizerVersion 不一致 → sessions 清空,文件结构保留。
5. saveIndexAtomic 后目录内无 .tmp- 残留文件。

- [ ] **Step 2: 运行确认失败**

Run: pnpm --filter dsh-usage-host exec vitest run tests/usage-index.spec.ts
Expected: FAIL。

- [ ] **Step 3: 实现 src/usage-index.ts**

```
ts
/**
 * Durable per-session usage index: one JSON file, event-count keyed, atomic
 * replace. Corruption or a normalizer-version change rebuilds from scratch.
 *
 * @module dsh-usage-host/usage-index
 */

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SessionUsageFold } from './fold-usage.ts'
import type { UsageBuckets } from './shared.ts'

export interface SessionIndexEntry {
  readonly eventCount: number
  readonly title?: string
  readonly routes: Record<string, UsageBuckets>
  readonly daily: Record<string, UsageBuckets>
}

export interface UsageIndexFile {
  readonly version: 1
  readonly normalizerVersion: string
  readonly sessions: Record<string, SessionIndexEntry>
}

function emptyIndex(normalizerVersion: string): UsageIndexFile {
  return { version: 1, normalizerVersion, sessions: {} }
}

export function entryOf(fold: SessionUsageFold, title?: string): SessionIndexEntry {
  const routes: Record<string, UsageBuckets> = {}
  for (const [key, buckets] of fold.routes) routes[key] = buckets
  const daily: Record<string, UsageBuckets> = {}
  for (const [key, buckets] of fold.daily) daily[key] = buckets
  return { eventCount: fold.eventCount, ...(title === undefined ? {} : { title }), routes, daily }
}

export function loadIndex(path: string, normalizerVersion: string): UsageIndexFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return emptyIndex(normalizerVersion)
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyIndex(normalizerVersion)
  const candidate = parsed as Partial<UsageIndexFile>
  if (candidate.version !== 1 || candidate.normalizerVersion !== normalizerVersion
    || typeof candidate.sessions !== 'object' || candidate.sessions === null) {
    return emptyIndex(normalizerVersion)
  }
  return { version: 1, normalizerVersion, sessions: candidate.sessions }
}

export async function saveIndexAtomic(path: string, index: UsageIndexFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = path + '.tmp-' + String(process.pid)
  await writeFile(tmp, JSON.stringify(index))
  await rename(tmp, path)
}
```

- [ ] **Step 4: 运行确认通过,然后 Commit**

Run: pnpm --filter dsh-usage-host exec vitest run tests/usage-index.spec.ts → PASS。

```
bash
git add packages/usage-host/src/usage-index.ts packages/usage-host/tests/usage-index.spec.ts
git commit -m "feat(usage-host): durable incremental usage index"
```

---

### Task 7: UsageService 扫描编排(TDD)

**Files:**
- Create: packages/usage-host/src/service.ts
- Test: packages/usage-host/tests/service.spec.ts

**Interfaces:**
- Consumes: Task 2-6 全部导出。
- Produces:
  - interface SessionQueryLike — { listSessions(): Promise<Array<{ header: { id: string; createdAt: number; cwd?: string } }>>; readSession(id: string): Promise<{ session: { id: string; createdAt: number; cwd?: string }; events: readonly RawUsageEvent[] }>; readTitle(id: string): Promise<{ title: string } | undefined>; eventCount?(id: string): Promise<number | undefined> }(结构化本地类型,不 peer 依赖 dsh-session-query;eventCount 是可选的廉价变更探针)
  - interface UsageServiceOptions — { registryOverridesPath?: string; indexPath?: string; refreshMs?: number }
  - class UsageService — constructor(sessionQuery, options);summary(limit?: number): UsageSummaryResponse(同步返回缓存;无缓存或超出 refresh 节流窗口时触发后台 scan);dispose(): void
- 行为:
  - indexPath 默认 homedir() + /.dsh/storages/usage-host/index.json;refreshMs 默认 30_000。
  - scan 串行遍历会话:索引无条目 → readSession + fold + readTitle;有条目 → 廉价探针:sessionQuery.eventCount 存在且返回值 === 索引 eventCount → 复用条目不读日志;探针缺失或返回 undefined → readSession 全读,events.length === 索引 eventCount 时复用,否则重折 + readTitle。
  - readSession/readTitle/eventCount 抛错 → skippedSessions++ 且保留旧条目;scan 结束 saveIndexAtomic + 刷新缓存 + lastScanAt = now。
  - scanning 期间 summary() 不再触发新 scan,返回当前缓存(或零壳 + scanning: true)。
  - 权衡(写进 service.ts 头注释):eventCount 探针缺失时变更检测退化为全量重读(正确但慢),由 refreshMs 节流兜底;真实 sessionQuery 的适配在 Task 8 的 SessionQueryLike 结构内由运行时对象是否具备该方法自然决定。

- [ ] **Step 1: 写失败测试**

内存 fake sessionQuery(会话 a、b;a 第一次 readSession 抛错)+ 临时目录 indexPath,断言:
1. refreshMs: 0:首次 summary() 返回 scanning: true 且 totals 为零壳;vi.waitFor 后 summary() 数字正确、skippedSessions 为 1(fake a 抛错),b 计入。
2. fake 修复 a 后再触发 scan → a 纳入,数字更新。
3. refreshMs: 60_000 时窗口内重复 summary() 不再调用 listSessions(fake 计数不变)。
4. 带 eventCount 探针的 fake:修改会话 b 的事件(改变 events.length)→ 下次 scan 中 a 的 readSession 未被调用(探针短路),b 被重读;无探针的 fake 下 a 也被重读(回退路径)。

- [ ] **Step 2: 运行确认失败**

Run: pnpm --filter dsh-usage-host exec vitest run tests/service.spec.ts
Expected: FAIL。

- [ ] **Step 3: 实现 src/service.ts**

```
ts
/**
 * Scan orchestration: sessionQuery corpus in, cached summary response out.
 * One background pass at a time; the persisted index plus the cheap
 * event-count probe keep steady-state refreshes off unchanged sessions. When
 * the corpus offers no probe, change detection falls back to a full re-read
 * (correct but slow), throttled by refreshMs.
 *
 * @module dsh-usage-host/service
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { aggregateSessions, type AggregateInput } from './aggregate.ts'
import { foldSessionUsage, type RawUsageEvent } from './fold-usage.ts'
import { buildNormalizer, loadModelRegistry } from './registry.ts'
import type { UsageBuckets, UsageSummaryResponse } from './shared.ts'
import { entryOf, loadIndex, saveIndexAtomic, type SessionIndexEntry } from './usage-index.ts'

export interface SessionQueryLike {
  listSessions(): Promise<Array<{ header: { id: string; createdAt: number; cwd?: string } }>>
  readSession(id: string): Promise<{ session: { id: string; createdAt: number; cwd?: string }; events: readonly RawUsageEvent[] }>
  readTitle(id: string): Promise<{ title: string } | undefined>
  /** Optional cheap change probe: the session's current raw event count. */
  eventCount?(id: string): Promise<number | undefined>
}

export interface UsageServiceOptions {
  readonly registryOverridesPath?: string
  readonly indexPath?: string
  /** 两次扫描之间的最小间隔毫秒;测试传 0。 */
  readonly refreshMs?: number
}

const EMPTY_TOTALS: UsageBuckets = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

export class UsageService {
  private readonly sessionQuery: SessionQueryLike
  private readonly indexPath: string
  private readonly registryOverridesPath: string | undefined
  private readonly refreshMs: number
  private scanning = false
  private lastScanAt = 0
  private cached: UsageSummaryResponse | undefined

  constructor(sessionQuery: SessionQueryLike, options: UsageServiceOptions = {}) {
    this.sessionQuery = sessionQuery
    this.registryOverridesPath = options.registryOverridesPath
    this.refreshMs = options.refreshMs ?? 30_000
    this.indexPath = options.indexPath ?? join(homedir(), '.dsh', 'storages', 'usage-host', 'index.json')
  }

  dispose(): void {
    this.scanning = false
  }

  summary(limit = 20): UsageSummaryResponse {
    if (!this.scanning && Date.now() - this.lastScanAt >= this.refreshMs) void this.scan(limit)
    if (this.cached === undefined) {
      return {
        generatedAt: Date.now(), scanning: true, sessionCount: 0, skippedSessions: 0,
        totals: EMPTY_TOTALS, providers: [], daily: [], topSessions: [],
        unpricedModels: [], estimate: undefined,
      }
    }
    return { ...this.cached, topSessions: this.cached.topSessions.slice(0, limit) }
  }

  private async scan(limit: number): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      const normalizer = buildNormalizer(loadModelRegistry(this.registryOverridesPath))
      const index = loadIndex(this.indexPath, normalizer.version)
      const records = await this.sessionQuery.listSessions()
      const sessions: Record<string, SessionIndexEntry> = {}
      let skipped = 0

      for (const record of records) {
        const id = record.header.id
        const cachedEntry = index.sessions[id]
        try {
          sessions[id] = cachedEntry === undefined
            ? await this.refresh(id, undefined)
            : await this.refreshOrReuse(id, cachedEntry)
        } catch {
          skipped += 1
          if (cachedEntry !== undefined) sessions[id] = cachedEntry
        }
      }

      await saveIndexAtomic(this.indexPath, { version: 1, normalizerVersion: normalizer.version, sessions })
      const headerOf = new Map(records.map(record => [record.header.id, record.header]))
      const inputs: AggregateInput[] = Object.entries(sessions).map(([sessionId, entry]) => {
        const header = headerOf.get(sessionId)
        return {
          sessionId,
          ...(entry.title === undefined ? {} : { title: entry.title }),
          createdAt: header?.createdAt ?? 0,
          ...(header?.cwd === undefined ? {} : { cwd: header.cwd }),
          fold: {
            eventCount: entry.eventCount,
            totals: sumEntries([entry]),
            routes: new Map(Object.entries(entry.routes)),
            daily: new Map(Object.entries(entry.daily)),
          },
        }
      })
      const views = aggregateSessions(inputs, normalizer, limit)
      this.cached = {
        generatedAt: Date.now(),
        scanning: false,
        sessionCount: inputs.length,
        skippedSessions: skipped,
        ...views,
      }
    } finally {
      this.scanning = false
      this.lastScanAt = Date.now()
    }
  }

  /** 全量读取并折叠一个会话(新会话,或回退路径)。 */
  private async refresh(id: string, previous: SessionIndexEntry | undefined): Promise<SessionIndexEntry> {
    const loaded = await this.sessionQuery.readSession(id)
    const fold = foldSessionUsage(loaded.events)
    const title = (await this.sessionQuery.readTitle(id))?.title ?? previous?.title
    return entryOf(fold, title)
  }

  /** 索引命中:探针短路或 eventCount 相同即复用;否则全量重折。 */
  private async refreshOrReuse(id: string, cachedEntry: SessionIndexEntry): Promise<SessionIndexEntry> {
    const probe = this.sessionQuery.eventCount
    if (probe !== undefined) {
      const count = await probe(id)
      if (count === cachedEntry.eventCount) return cachedEntry
      return this.refresh(id, cachedEntry)
    }
    const loaded = await this.sessionQuery.readSession(id)
    if (loaded.events.length === cachedEntry.eventCount) return cachedEntry
    const fold = foldSessionUsage(loaded.events)
    const title = (await this.sessionQuery.readTitle(id))?.title ?? cachedEntry.title
    return entryOf(fold, title)
  }
}

function sumEntries(entries: readonly SessionIndexEntry[]): UsageBuckets {
  const totals = { ...EMPTY_TOTALS }
  for (const entry of entries) {
    for (const buckets of Object.values(entry.routes)) {
      totals.uncachedInputTokens += buckets.uncachedInputTokens
      totals.outputTokens += buckets.outputTokens
      totals.cacheReadTokens += buckets.cacheReadTokens
      totals.cacheWriteTokens += buckets.cacheWriteTokens
    }
  }
  return totals
}
```

- [ ] **Step 4: 运行确认通过**

Run: pnpm --filter dsh-usage-host exec vitest run tests/service.spec.ts
Expected: PASS。

- [ ] **Step 5: Commit**

```
bash
git add packages/usage-host/src/service.ts packages/usage-host/tests/service.spec.ts
git commit -m "feat(usage-host): background scan orchestration with incremental index"
```

---

### Task 8: 路由与 cordis apply(TDD)

**Files:**
- Modify: packages/usage-host/src/index.ts(整体替换)
- Test: packages/usage-host/tests/routes.spec.ts

**Interfaces:**
- Consumes: UsageService(Task 7)、USAGE_SUMMARY_ROUTE / UsageSummaryResponse(Task 1)。
- Produces: cordis 插件 dsh-usage-host,inject ['webServer', 'connection', 'sessionQuery'],注册 GET USAGE_SUMMARY_ROUTE(kind: 'exact');受 connection.requestRejection 围栏;?limit= 透传(1..200,越界/非数字回退 20);405 非 GET。

- [ ] **Step 1: 写失败测试**

fake ctx(记录 webServer.register 调用;ctx.effect 立即执行注册回调)、fake connection(rejection 可切 undefined/401/403)、fake sessionQuery(带 eventCount);调用 apply 后取出注册的 handler,以手造 req(method/url/headers)与捕获型 res(记录 statusCode、setHeader、end body)调用,断言:
1. 200 + JSON payload 结构(scanning、providers 数组存在)。
2. POST → 405 且 allow: GET。
3. connection 返回 401 → 响应 401(且 handler 不再继续)。
4. ?limit=abc → topSessions 长度 ≤ 20;?limit=500 → 同样按 20 处理。

- [ ] **Step 2: 运行确认失败**

Run: pnpm --filter dsh-usage-host exec vitest run tests/routes.spec.ts
Expected: FAIL。

- [ ] **Step 3: 整体替换 src/index.ts**

```
ts
/**
 * Host half of the usage dashboard plugin: the aggregation service plus one
 * webServer summary route behind the same browser trust fence as the other
 * host plugins. The service is the single data authority; the route is a
 * consumer.
 *
 * @module dsh-usage-host
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { UsageService, type SessionQueryLike } from './service.ts'
import { USAGE_SUMMARY_ROUTE } from './shared.ts'

export type * from './shared.ts'
export { USAGE_SUMMARY_ROUTE } from './shared.ts'
export { UsageService, type SessionQueryLike, type UsageServiceOptions } from './service.ts'

export const name = 'dsh-usage-host'

/** Trust surface consumed here; the browser-side connection package owns the full type. */
interface UsageConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

function connectionOf(ctx: Context): UsageConnection {
  return Reflect.get(ctx, 'connection') as UsageConnection
}

/** dsh-usage-host configuration. */
export interface Config {
  /** 用户模型注册表覆盖文件路径;缺省不加载覆盖。 */
  readonly registryOverridesPath?: string
  /** 索引文件路径;缺省 ~/.dsh/storages/usage-host/index.json。 */
  readonly indexPath?: string
  /** 两次扫描之间的最小间隔毫秒。 */
  readonly refreshMs?: number
}

export const Config: z<Config> = z.object({
  registryOverridesPath: z.string().optional(),
  indexPath: z.string().optional(),
  refreshMs: z.number().int().min(0).max(3_600_000).optional(),
})

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

function rejected(connection: UsageConnection, req: IncomingMessage, res: ServerResponse): boolean {
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

function limitOf(req: IncomingMessage): number {
  const raw = new URL(String(req.url), 'http://localhost').searchParams.get('limit')
  const parsed = raw === null ? NaN : Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 200 ? parsed : 20
}

/** Register the usage service and its summary route behind the trust fence. */
export function apply(ctx: Context, config: Config = {}): void {
  const sessionQuery = Reflect.get(ctx, 'sessionQuery') as SessionQueryLike
  const service = new UsageService(sessionQuery, {
    ...(config.registryOverridesPath === undefined ? {} : { registryOverridesPath: config.registryOverridesPath }),
    ...(config.indexPath === undefined ? {} : { indexPath: config.indexPath }),
    ...(config.refreshMs === undefined ? {} : { refreshMs: config.refreshMs }),
  })
  const connection = connectionOf(ctx)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: USAGE_SUMMARY_ROUTE,
    handler: async (req, res) => {
      if (rejected(connection, req, res)) return
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.setHeader('allow', 'GET')
        res.end()
        return
      }
      sendJson(res, 200, service.summary(limitOf(req)))
    },
  }), 'dsh-usage-host: GET ' + USAGE_SUMMARY_ROUTE)
}
```

- [ ] **Step 4: 运行确认通过,然后 Commit**

Run: pnpm --filter dsh-usage-host exec vitest run → PASS(fold/registry/price/aggregate/index/service/routes 全绿)。

```
bash
git add packages/usage-host/src/index.ts packages/usage-host/tests/routes.spec.ts
git commit -m "feat(usage-host): summary route behind browser trust fence"
```

---



### Task 9: dsh-client-ui-usage 包脚手架

**Files:**
- Create: packages/client-ui-usage/package.json
- Create: packages/client-ui-usage/tsconfig.json
- Create: packages/client-ui-usage/tsdown.config.ts
- Create: packages/client-ui-usage/src/index.ts(node 半空 apply)
- Create: packages/client-ui-usage/src/client/index.ts(Task 12 前为占位)
- Modify: vitest.config.ts(根:environmentMatchGlobs 增加 client-ui-usage jsdom)

**Interfaces:**
- Produces: bundle id dsh-client-ui-usage;node 半空 apply 模式与 client-ui-git 一致;client 测试走根 vitest jsdom lane。

- [ ] **Step 1: package.json(复制 packages/client-ui-git/package.json 后修改)**

name → dsh-client-ui-usage;description → "Settings usage-statistics dashboard over the dsh-usage-host summary route";dsh.client.inject → ["@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-primitives"];devDependencies:保留 client-ui-git 现有 link 集,去掉 "dsh-git-host": "workspace:^" 与 "@deepseek-ai/dsh-client-ui-conversation",加 "@deepseek-ai/dsh-client-ui-settings": "link:../../../deepseek-harness/packages/client/ui-settings"。

- [ ] **Step 2: tsconfig.json** — 复制 packages/client-ui-git/tsconfig.json 全文(jsx/DOM 保留)。

- [ ] **Step 3: tsdown.config.ts** — 复制 client-ui-git,改 const id = 'dsh-client-ui-usage';EXTERNALS 改为 ['react', 'react/jsx-runtime', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives'];cssModulesPlugin 的 name 改为 'dsh-usage-css-modules'。

- [ ] **Step 4: node 半 src/index.ts**

```
ts
/**
 * Node half: presence only, so the loader sees the package. All behavior is
 * browser-side via exports["./client"].
 * @module dsh-client-ui-usage
 */

export function apply(): void {}
```

- [ ] **Step 5: 占位 src/client/index.ts(Task 12 整体替换)**

```
ts
export function apply(): void {}
```

- [ ] **Step 6: 根 vitest.config.ts 的 environmentMatchGlobs 增加**

```
ts
['packages/client-ui-usage/tests/**', 'jsdom'],
```

- [ ] **Step 7: 构建验证**

Run: pnpm install && pnpm --filter dsh-client-ui-usage build
Expected: 退出码 0,生成 lib/client.js(banner 含 dsh-client-ui-usage)。

- [ ] **Step 8: Commit**

```
bash
git add packages/client-ui-usage vitest.config.ts
git commit -m "feat(client-ui-usage): package scaffold"
```

---

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

### Task 13: 全仓构建 + 测试全绿

- [ ] **Step 1:** Run: pnpm -r run build && pnpm -r run test → 全部退出码 0。
- [ ] **Step 2:** 核对根 .gitignore 覆盖 lib/ 构建产物(没有则补),git status 无未跟踪产物。
- [ ] **Step 3:** 如有 .gitignore 变更:git commit -am "chore: ignore lib build output"。

---

### Task 14: 安装进 DSH Desktop 并人工验证

**Files:**
- Modify: /Users/jelvin/.dsh/profiles/desktop/package.json(profile 直连依赖)
- Modify: /Users/jelvin/.dsh/profiles/desktop/cordis.yml(当前为 [])

- [ ] **Step 1: profile 安装**

在 profile 目录安装两个包(file: 指向本仓库构建产物形态;与 git-worktree 插件走同一通道——实施时若 Desktop 已有 dsh plugin 安装 CLI,以 CLI 为准)。profile cordis.yml 增加两条插件条目,形状对照上游 bundle 的 packages/bundle/web-app/cordis.patch.yml 中 ui-jobs / ui-open-in-app 条目(id + name 两个字段):

```
yaml
- id: usage-host
  name: dsh-usage-host
- id: client-ui-usage
  name: dsh-client-ui-usage
```

- [ ] **Step 2: 重启 DSH Desktop,人工验证清单**

1. 设置面板 nav 出现「使用统计」;打开后显示扫描提示,数秒~十几秒后出现数据。
2. 四视图数字合理(抽样:取一个会话在界面显示的 token 数,与该会话日志里的 usage 对账)。
3. 别名归一:在 ~/.dsh/storages/usage-host/ 放 models.json 覆盖(把某已知别名并入既有 canonical),刷新后模型行归并、金额变化(normalizerVersion 变化触发全量重算,会再次短暂 scanning)。
4. 未识别模型出现时提示条可见。
5. 从 cordis.yml 临时移除 usage-host 条目重启:页面显示服务缺失文案,不白屏;验证后恢复。

- [ ] **Step 3: 验证通过后 Commit**

```
bash
git commit --allow-empty -m "chore: usage dashboard verified against running Desktop"
```

---

## Self-Review 记录

- Spec 覆盖:四视图(Task 5)、归一化与 normalizerVersion(Task 3/6/7)、计价与 unpriced(Task 4/5)、增量索引与后台扫描(Task 6/7)、信任围栏路由(Task 8)、设置页 UI 与轮询(Task 12)、双语(Task 11)、错误降级(Task 7/8/12/14)——全部有任务承载。
- 类型一致性:UsageBuckets 与全部 Row 类型单点定义于 shared.ts;fold → aggregate → service → route → client 字段名逐任务核对一致;Normalizer 接口在 Task 3 定型(normalize + modelEntry + version),Task 5/7 按此消费。
- 已知取舍(要求写进代码注释):变更检测的廉价探针 sessionQuery.eventCount 为可选方法,缺失时回退全量重读(正确但慢),由 refreshMs 节流兜底;scan 期间 summary 返回 scanning 快照。
- Task 14 的安装通道存在环境不确定性(profile 手工 vs dsh plugin CLI),计划给出两种路径并以运行中的 Desktop 实况为准——与 git-worktree 设计文档的待验证点 #4 同源,不是实现占位。

