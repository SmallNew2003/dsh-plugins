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

