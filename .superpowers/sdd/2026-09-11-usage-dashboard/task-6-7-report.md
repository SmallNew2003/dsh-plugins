# Report — Tasks 6+7 (dsh-usage-host: usage-index + UsageService)

Branch `usage-dashboard` (worktree)。Status: **DONE_WITH_CONCERNS**(轻微,见 concerns;均为测试基建/命令路径层面,不影响交付接口)。

## Commits
- `03059ef` feat(usage-host): durable incremental usage index(Task 6:src/usage-index.ts + tests/usage-index.spec.ts)
- `d5c268a` feat(usage-host): background scan orchestration with incremental index(Task 7:src/service.ts + tests/service.spec.ts)

## 实现内容

### Task 6 — packages/usage-host/src/usage-index.ts
按 brief 骨架逐字实现:
- `SessionIndexEntry` / `UsageIndexFile`(version: 1)。
- `loadIndex(path, normalizerVersion)`:同步;文件不存在 / JSON.parse 抛错 / 非对象 / version ≠ 1 / normalizerVersion 不匹配 / sessions 非对象 → 空索引。
- `saveIndexAtomic(path, index)`:`mkdir -p` + `path + '.tmp-' + pid` 临时写 + `rename` 原子替换。
- `entryOf(fold, title?)`:routes/daily Map → Record;title === undefined 时省略字段。

### Task 7 — packages/usage-host/src/service.ts
按 brief 骨架实现,外加「额外约束」的两处接线:
- `SessionQueryLike`(结构化本地类型,`eventCount?` 可选廉价探针)、`UsageServiceOptions`、`UsageService`。
- 扫描编排:串行遍历 listSessions;索引无条目 → `refresh`(readSession + fold + readTitle);有条目 → `refreshOrReuse`(有探针:probe(id) === 索引 eventCount 复用,undefined/不一致 → 全读重折;无探针:readSession 后 events.length === eventCount 复用,否则重折)。readSession/readTitle/探针抛错 → skipped++ 且保留旧条目;scan 结束 saveIndexAtomic + 重建缓存 + lastScanAt = now;scanning 期间 summary() 不再触发新 scan,返回缓存或零壳(scanning: true)。
- **额外约束接线**:`registryOverridesPath` 默认 `join(homedir(), '.dsh', 'storages', 'usage-host', 'models.json')`(骨架原本是 undefined,已改;loadModelRegistry 自带 existsSync,默认路径不存在即回退内置注册表);`indexPath` 默认同目录 `index.json`。
- **与骨架的一处偏差(必要修正)**:缓存对象字面量中删去显式 `sessionCount: inputs.length` —— `...views`(aggregateSessions 的输入即 inputs)已携带等值 sessionCount,保留两者触发 tsc TS2783,构建失败。值语义不变(views.sessionCount === inputs.length)。此处显式注明,非静默改签名。
- 头注释含 brief 要求的权衡说明(探针缺失 → 全量重读,正确但慢,refreshMs 节流兜底)。

### index.ts 导出面(额外约束核查)
`src/index.ts` 已有 `export * from './registry.ts'`,经产物 `lib/types/index.d.ts` → `registry.d.ts` 确认 `loadModelRegistry` / `buildNormalizer` 已可达。无需改动。

## TDD 证据

### Task 6
- RED(实现前):`pnpm exec vitest run packages/usage-host/tests/usage-index.spec.ts`
  → `Error: Failed to load url ../src/usage-index.ts … Test Files 1 failed (1)`,no tests(模块不存在)。
- GREEN(实现后):同命令 → `Test Files 1 passed (1) / Tests 6 passed (6)`。
  覆盖:不存在路径空索引、save/load 往返相等、损坏 JSON(`<not json`)空索引、normalizerVersion 不匹配 sessions 清空且结构保留、无 `.tmp-` 残留 + 原子替换内容正确、title 缺省省略字段。

### Task 7
- RED(实现前):`pnpm exec vitest run packages/usage-host/tests/service.spec.ts`
  → `Failed to load url ../src/service.ts … Test Files 1 failed (1)`,no tests。
- GREEN:同命令 → `Test Files 1 passed (1) / Tests 5 passed (5)`。
  覆盖:refreshMs:0 首次 summary() 零壳 + scanning:true,waitFor 后数字正确且 skippedSessions:1(b 计入);修复 fake a 后下次 scan a 纳入(2 会话、skipped 0、totals 40);refreshMs:60_000 窗口内三次重复 summary() listSessions 计数不变;带探针 fake:b 事件数改变后 b 被重读且 a 的 readSession 保持 1(探针短路),totals 45;无探针 fake:a、b 均被重读(回退路径),totals 45。
- 全量:`pnpm exec vitest run` → `Test Files 14 passed (14) / Tests 125 passed (125)`。
- 构建:`pnpm --filter dsh-usage-host build`(tsc + tsdown)通过(修 TS2783 后)。

## 变更文件
- 新增 packages/usage-host/src/usage-index.ts、packages/usage-host/tests/usage-index.spec.ts
- 新增 packages/usage-host/src/service.ts、packages/usage-host/tests/service.spec.ts
- 未改任何既有文件(index.ts 未动 —— 导出面已满足)。

## Self-review 发现
1. 测试命令路径:brief 中的 `pnpm --filter dsh-usage-host exec vitest run tests/usage-index.spec.ts` 在包目录内运行时,vitest(root config include 为 `packages/*/tests/**/*.spec.ts`,相对 worktree 根)报 `No test files found`。按 dispatch 上下文「vitest 一律从 worktree 根运行」改用:`pnpm exec vitest run packages/usage-host/tests/<spec>`。两份 RED/GREEN 证据均来自根命令。
2. Task 7 测试需要 quiesce 原语:`refreshMs: 0` 时每次 summary() 都会派生后台 scan,scan 会在测试结束后仍写 index 文件,与 afterEach 的 mkdtemp 清理竞争(实测出现 rename ENOENT unhandled rejection)。解法:`vi.mock('../src/usage-index.ts')` 以 `vi.fn(actual.saveIndexAtomic)` 包真实实现做调用计数 spy,afterEach 等待 spy 计数稳定(25ms 窗口)后再 rm。生产代码未为测试改动。
3. Task 7 测试编写期曾把修改后 b 的期望 totals 写成 35(b 两事件=35 + a=10 应为 45),已修正。
4. `dispose()` 按 brief 只置 `scanning = false`(不中断进行中的 IO);语义以 brief 为准,未扩展。

## Concerns
- self-review 1/2 属 brief 命令/测试环境与实际的偏差,均按 dispatch 既有裁定处理;接口与行为未偏离 brief 的 Interfaces 段。
- full suite 125 与 dispatch 所记基线 107 的差值(18)> 本次新增 11;推测 dispatch 基线早于 e6093a6/44df2bc(Task 4/5)用例,未发现回归(14 文件全绿)。

---

# Fix Report — 审查 Important 裁定:非唯一 tmp 文件名破坏原子替换

Commit: `9aab02b` fix(usage-host): unique tmp suffix for atomic index saves。Status: **DONE**。

## 审查裁定(原文摘录)
saveIndexAtomic 用 `path + '.tmp-' + process.pid`,同 path 并发保存(dispose() 中断扫描后 summary() 再触发、或两个 UsageService 共享 path)会在同一 tmp 文件上交错:rename 可能发布截断文件、第二次 rename 可能 ENOENT。后果有界(loadIndex 视为损坏 → 全量重建),但原子性契约不应依赖"至多一个写者"。

## 变更内容
- `packages/usage-host/src/usage-index.ts`:`saveIndexAtomic` 的 tmp 文件名改为 `path + '.tmp-' + pid + '-' + (++tmpSequence)`,tmpSequence 为模块级单调递增计数器(选用方案:pid + 计数器,确定性、可测;同进程每次保存递增必不同,跨进程由 pid 区分)。仅改 tmp 后缀,未动任何其他语义(mkdir/writeFile/rename 流程、导出面均不变)。
- `packages/usage-host/tests/usage-index.spec.ts`:新增用例 "writes each save to a unique tmp filename"——通过 `vi.mock('node:fs/promises')` 用 `vi.fn(actual.writeFile)` 包真实实现做最小可观察钩子,断言两次连续 saveIndexAtomic 写入的两个 tmp 路径互不相同。既有 "no .tmp- residue" 用例未改(残渣检查是前缀/glob 关注点,新命名仍以 `.tmp-` 为前缀且 rename 后无残留),原样通过。其余测试行为不受影响(mkdir/rename 走 spread 的 actual 实现)。

## TDD 证据(均从 worktree 根运行)
- RED(实现前,旧 pid-only 实现):`pnpm exec vitest run packages/usage-host/tests/usage-index.spec.ts`
  → `FAIL … writes each save to a unique tmp filename — AssertionError: expected 1 to be 2 // Object.is equality`(两次写入同名 tmp,Set 去重后为 1);`Tests 1 failed | 6 passed (7)`。RED 为机械可达(旧实现两次保存确用同一 tmp 路径)。
- GREEN(实现后):同命令 → `Test Files 1 passed (1) / Tests 7 passed (7)`。
- 全量:`pnpm exec vitest run` → `Test Files 14 passed (14) / Tests 126 passed (126)`(基线 125 + 新增 1)。
- 构建:`pnpm --filter dsh-usage-host build` → exit 0(仅既有 tsdown "define" 无害警告,与本次无关)。

## 变更文件
- packages/usage-host/src/usage-index.ts(+7/-2:计数器声明 + tmp 模板 + 注释)
- packages/usage-host/tests/usage-index.spec.ts(+15 行:vi 导入、fs mock、mockClear、新用例)

## Self-review
1. 唯一性口径:同进程内计数器单调 → 两次保存必不同;不同进程 pid 不同;pid 重用跨进程同时写同一 path 的场景超出本契约范围(与审查裁定的两个触发场景均不重叠)。未引入 Date.now(时钟非单调,且计数器已足够确定)。
2. 计数器溢出:Number.MAX_SAFE_INTEGER 内递增,实际不可达;未做回绕特殊处理(回绕需 2^53 次保存)。
3. mock 影响面:vi.mock 仅本 spec 文件生效;所有用例均走 actual 包装,行为断言(往返/残留/损坏回退)不受影响,全量 126 绿佐证。
4. 未改 service.ts / dispose / 其他语义;零上游仓库改动,仅工作树内 2 文件。

---

# Fix Report — Final round: Critical scan containment + cheap batch

Commits: `8a700ae` fix(usage-host): contain scan failures so a bad corpus or index save cannot crash the host; `6d507d8` fix(usage-host): untruncated cache, zero-row filter; polish usage client and specs。Status: **DONE**。

## Critical: scan() 无 catch → unhandled rejection 崩进程
- 根因(reviewer node smoke 实证):summary() `void this.scan(limit)`,scan 只有 try/finally — listSessions 拒绝 / registryOverridesPath JSON 损坏 / saveIndexAtomic 失败任一 → promise 逃逸为 unhandled rejection,Node 默认 abort。
- 修复(`packages/usage-host/src/service.ts`):scan() body 包 try/catch — catch 保持旧 cache 原封不动(绝不发布部分结果)、console.warn 单行 `[dsh-usage-host] usage scan failed; keeping the previous summary`(文件无 logger,按 dispatch 用 console.warn);finally 仍重置 scanning 并更新 lastScanAt(refreshMs 节流在失败后依然生效)。
- TDD(observable hook:直接 await 私有 scan(),断言 resolves 不 rejects;辅以 process 'unhandledRejection' 监听器覆盖 fire-and-forget 路径):
  - RED(fix 前,旧实现):两条新用例均失败 — `promise rejected "Error: corpus down"/"disk full" instead of resolving`(Tests 2 failed | 5 passed (7))。
  - GREEN(fix 后):service.spec 7/7。
- Node smoke(built lib,`packages/usage-host/lib/index.js`):listSessions 永久拒绝 → 进程存活 exit 0,zero shell 保持(sessionCount 0 / providers 0 / outputTokens 0),单条 warning,无 unhandled rejection(SMOKE PASS)。

## Cheap batch(逐项)
- (q) 缓存不截断:`service.ts` scan() 去掉自身 limit 参数,`aggregateSessions(inputs, normalizer, Number.MAX_SAFE_INTEGER)` 全量入缓存;summary(limit) 层 slice(`service.ts:66` 既有)。routes.spec 新增 "serves a larger limit from the untruncated cache inside the refresh window"(25 会话,先 ?limit=3 后 ?limit=200 同窗口 → 25 行;RED:got 3 — 聚合期截断)。既有 clamp 用例不受影响(?limit=500 经 limitOf 回落 20,断言仍 20 行)。
- (b) 零行过滤:`aggregate.ts` 路由循环 skip `usageTotal(buckets) === 0`,dailyRows filter 同判据。aggregate.spec 新增 "drops routes and daily columns that were fully replaced back to zero"(经真实 fold 同 (turn,step) 替换回零构造;RED:providers 出现全零行)。
- (c) `fold-usage.spec.ts` 两用例:"does not count events with no usage and no stream"(totals 全零、routes/daily 空)、"prefers the usage field over the stream when both are present"(usage 优先钉住;行为已存在,characterization 性质)。
- (u) `UsageSection.tsx`:删除本地 bucketTotal(三处调用点换 usageTotal),改 `import { usageTotal, type ProviderUsageRow, type UsageSummaryResponse } from 'dsh-usage-host/shared'`(UsageBuckets 类型导入随本地函数删除一并移除)。构建后纯度:grep -c deepseek-ai packages/client-ui-usage/lib/client.js = 0 ✓。
- (a)(r) fold-usage.ts / routes.spec.ts 追加 EOF 换行(xxd 验证尾部 \n)。
- (aa) usage-section.spec 测试改名:'keeps polling while scanning and stops when settled' → 'keeps polling while scanning; a settled response keeps polling at the 60s cadence'(settled 不停轮、60s 节奏另有用例 "schedules exactly one refetch 60s…" 钉住)。

## 验证(均从 worktree 根)
- 全量:`pnpm exec vitest run` → Test Files 18 passed / **Tests 152 passed**(基线 146 + 新增 6:service 2、routes 1、aggregate 1、fold 2)。
- `pnpm -r run build` → exit 0(仅既有 tsdown "define" 无害警告)。
- 纯度:grep -c deepseek-ai packages/client-ui-usage/lib/client.js → **0**。
- Node smoke:见 Critical 节,SMOKE PASS / exit 0。
- worktree 干净,分支 usage-dashboard @ 6d507d8,未触碰上游 deepseek-harness。

## 变更文件
- Commit 8a700ae: packages/usage-host/src/service.ts(+catch 包裹)、packages/usage-host/tests/service.spec.ts(+2 用例)
- Commit 6d507d8: packages/usage-host/src/service.ts(去 limit 参数 + MAX_SAFE_INTEGER 聚合)、src/aggregate.ts(零行过滤)、src/fold-usage.ts(EOF)、tests/routes.spec.ts(cap 用例 + EOF)、tests/aggregate.spec.ts(+1 用例)、tests/fold-usage.spec.ts(+2 用例)、packages/client-ui-usage/src/client/UsageSection.tsx(usageTotal 导入)、tests/usage-section.spec.tsx(改名)

## Self-review notes
- 首扫失败后 zero shell 的 scanning 字段仍硬编码 true — 既有 deferred minor (m),WONTFIX 在案,本轮未扩大范围(测试经私有 scanning 字段断言后台标志已复位)。
- 直接 await 私有 scan() 属白盒断言;选用原因:summary() 同步返回 fire-and-forget promise,无公共可等待钩子,unhandledRejection 监听器作为补充断言双保险。

