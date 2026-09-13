# SDD ledger — plan: docs/superpowers/plans/2026-09-11-usage-dashboard.md

Branch: usage-dashboard @ .worktrees/usage-dashboard (base 153cf56, master 15661c0)
Spec: docs/design/2026-09-11-usage-dashboard-design.md(权威,与计划冲突时以 spec 为准)

## Environment facts
- Worktree 内 lib/ 需先构建(pnpm -r build)再跑根 vitest;基线 91 tests 全绿。
- 根 vitest.config.ts 的 environmentMatchGlobs 已含 client-ui-git;Task 9 需追加 client-ui-usage。
- 主仓库存在并行提交活动(engram/dsh-client-ui-memory);每任务 dispatch 前查 worktree 内 git status,不合流不 rebase 到 master(由 finishing 阶段处理)。

## Preflight conflict scan
| 检查项 | 结果 | 裁定 |
| --- | --- | --- |
| Task 1 shared.ts ← Task 5/7/8/10/12 消费 | 字段名逐一对过(providers/daily/topSessions/unpricedModels/estimate);Task 5 Views 类型 = Omit<UsageSummaryResponse,...> 一致 | 无冲突 |
| Task 2 SessionUsageFold ← Task 5/6/7 | eventCount/totals/routes/daily 四字段一致;Task 7 sumEntries 从 entry.routes 重建 totals 与 fold.totals 等价 | 无冲突 |
| Task 3 Normalizer ← Task 5/7 | normalize/modelEntry/version 三个成员一致;NormalizedRoute 含 providerDisplayName(Task 5 消费) | 无冲突 |
| Task 7 SessionQueryLike.eventCount 可选 ← Task 8 真实 sessionQuery 适配 | 真实 ctx.sessionQuery 是 SessionQueryEngine 实例,无 eventCount 方法 → 回退全量重读路径,refreshMs 节流兜底;计划已声明该权衡 | 无冲突(记录为已知取舍) |
| Task 8 Config.refreshMs ← Task 7 UsageServiceOptions.refreshMs | Task 8 代码含 refreshMs 透传,一致 | 无冲突 |
| Task 9 vitest environmentMatchGlobs ← Task 12 jsdom 测试 | Task 9 Step 6 显式追加,一致 | 无冲突 |
| Task 10 dsh-git-host/shared 解析参照 ← client-ui-git tsconfig | 计划已要求先 cat 对照再抄同构配置;探针步骤存在 | 无冲突 |
| Task 2 测试 eventCount 断言 ← Task 2 实现 | 测试断言 fold.eventCount=2(含非 usage 事件),实现 events.length 一致 | 无冲突 |
| Task 12 轮询测试用 fakeTimers ← 组件 setTimeout 轮询 | 测试用 advanceTimersByTimeAsync,组件用 setTimeout 链;兼容 | 无冲突 |
| Task 5 aliases 断言 arrayContaining(['deepseek-v4-flash','ds-v4-flash']) ← 实现 alias.add(原始 model) | routeKey 拆出的原始 model 名正是这两个;一致 | 无冲突 |

Ruling: 本 harness 的 subagent 工具无 model 参数,Model Selection 的分级要求不可执行 — 以单一模型 + 严格 dispatch 简报(完整代码已在计划中)替代 — 代价:实现者模型可能高于必要档位,多花 token,不影响正确性。

## Progress

Task 1-2: implementer reconciliations ruled on (brief defects, all reasonable — spec is authority):
- Ruling: 测试 fixture 的 source 位置修正为 data.message.source — 与真实日志/上游类型/计划 Task 5 fixtures 一致,brief 文本错误 — 若错:折叠归因取不到 provider/model。
- Ruling: stream fixture 改为上游 wrapped {type:'chunk',chunk:{type:'usage',usage}} 记录 — lastAssistantStreamChunk 只识别 wrapped 形态 — 若错:流式 usage 漏计。
- Ruling: 弃用 @deepseek-ai/dsh-llm/assistant-stream 导入(上游 checkout staged 未构建、只读不可重建),以私有 lastUsageChunk() 镜像上游扫描逻辑并标注还原点 — 若错:上游构建出 lib 后逻辑漂移,最终 review 时核对镜像与上游实现一致。
- Ruling: 折叠 totals 改纯函数 replaceTotals()(readonly 接口下 TS2540,算术与 brief 等价、镜像上游 addReplacing)— 若错:仅类型层面,数值行为不变。
- Ruling: 计划中"focused vitest 命令"更正为从 worktree 根运行 pnpm exec vitest run <path>(include-pattern cwd 既有问题,见 Environment facts)。

Task 1-2: fix-loop 前置审查包 review-153cf56..7b2564e.diff 已生成,派发任务审查者。


Task 1-2: minor (deferred): (a) fold-usage.ts 缺 EOF 换行; (b) addInto 不清除全零 route/daily 条目,Task 5 需过滤零桶并补测试; (c) 缺"无 usage 且无 stream 不计"与"usage 优先于 stream"两条测试。
Task 1-2: complete (commits 153cf56..7b2564e, review clean, 3 deferred minors)

Task 1-2: minor (deferred): (d) bucketsOf 对 null 的 ?? 0 宽松处理与上游 normalizeUsage 的拒绝口径不同(此处镜像的是指定投影文件,可接受)——最终 review 一并裁断。

Task 3-4: review verdict Approved, 1 Important (plan-mandated build-asset: models.json 不随 tsdown bundle 落盘,lib 下运行时 ENOENT)→ fix round 1 已发给原实现者(09db6863)。
Task 3-4: minor (deferred): (e) provider 作用域别名优先级无测试钉住; (f) loadModelRegistry 零覆盖(覆盖文件合并/坏 JSON); (g) priceBuckets 缺非零 cacheWrite 测试。
Task 3-4: ⚠️ 裁定 — 覆盖文件默认路径的接线属 Task 7(UsageServiceOptions 默认值),已写入 dispatch-tasks-6-7.md。

Task 3-4: fix round 1/5 (1 addressed, 0 open — models.json 随 bundle 落盘 via tsdown copy + lib/index.js re-export; re-reviewer 独立 node smoke 复核通过; commit e6093a6..f62dcb2)
Task 3-4: complete (commits 7b2564e..f62dcb2, review clean after 1 fix round, 3 deferred minors)
Task 3-4: minor (deferred): tsc 中间产物 lib/types/registry.js 相对解析无 models.json(仅 deep-import 才触发,pre-existing,fix diff 未触及)

Task 5: implementer reconciliations ruled on (pre-approved in dispatch: delivered-code-wins, snippet fixes allowed with报告注明):
- Ruling: daily 测试 fixture 改 day-10 turn=2(brief 自相矛盾,与已交付 fold 语义冲突;行为与签名零变更)— 若错:每日视图口径错,审查者会抓住。
- Ruling: 聚合返回补 sessionCount 字段(tsc 按返回类型强制的 snippet 修正)— 若错:类型不符,Task 8 路由装配失败。
- aggregate 不经 index.ts 导出:留待 Task 8 装配(brief 范围如此),已记入 Task 8 派发要求。

Task 5: minor (deferred): (h) alias 断言用 arrayContaining 未钉排序精确列表; (i) 空语料测试未断言 sessionCount/topSessions/unpricedModels; (j) recognized 但无 pricing 分支仅经未识别路径间接覆盖; (k) limit 负数未防(slice(0,-1) 丢行,caller-controlled)。
Task 5: complete (commits f62dcb2..44df2bc, review clean, 4 deferred minors)

Task 6-7: implementer reconciliations ruled on:
- Ruling: registryOverridesPath 默认接线 join(homedir(),'.dsh','storages','usage-host','models.json')(Task 3-4 审查裁定的消费侧落地)— 若错:用户覆盖文件不生效。
- Ruling: 缓存响应字面量去掉显式 sessionCount(...views 已携带同值,TS2783 强制)— 等价修正 — 若错:字段缺失,Task 8 装配失败(审查覆盖)。
- Ruling: service.spec 用 vi.mock 包 real saveIndexAtomic + afterEach quiesce 修测试基础设施竞态(生产码零变更)— 若错:掩盖生产问题;审查者核。

Task 6-7: review verdict Approved, 1 Important (plan-mandated): saveIndexAtomic tmp 名仅 process.pid,dispose 边缘的双 scan 并发可交叉同名 tmp,rename 可发布截断文件(有损可自愈:loadIndex 视为损坏全量重建)。
Ruling: 修复它 — spec"临时文件 + 原子改名"意图是安全替换,pid+计数器/随机后缀成本极低;顺带消除 quiesce 类测试竞态的土壤 — 若错:极小,原子写语义略变但仍向下兼容。
Task 6-7: minor (deferred): (l) 探针返回 undefined 走全重折(骨架权威,略过 events.length 复用); (m) 首扫失败前零壳报 scanning:true 误信号; (n) quiesce 25ms 启发式可能偶发 flake; (o) 复用条目标题陈旧(设计内,无标题探针)。

Task 6-7: fix round 1/5 (1 addressed, 0 open — tmp 唯一后缀 pid+单调计数器,re-reviewer 实跑 focused 7/7 复核; commit d5c268a..9aab02b)
Task 6-7: complete (commits 44df2bc..9aab02b, review clean after 1 fix round, 4 deferred minors)

Task 8: implementer reconciliations ruled on:
- Ruling: inject ['webServer','connection','sessionQuery'] 按 git-host 惯例补上(brief Interfaces 要求而代码块遗漏)— 若错:插件不激活。
- Ruling: aggregateSessions/AggregateInput 从 index.ts 导出(派发裁定,路由装配需要)— 若错:类型不可达,仅导出面冗余。
- Ruling: schemastery 无 .int()/.optional() → .step(1).min(0).max(3600000) + 对象属性缺省可选(git-host 同款)— 运行时语义等价 — 若错:配置校验松紧差异,人工验证阶段核对。
- Ruling: 保留 export * from './registry.ts'(delivered-code-wins)。
- Ruling: apply 不 dispose service(brief 如此;dispose 仅重置标志位,进程退出即回收)— 最终 review 复核。

Task 8: minor (deferred): (p) limit 上限 200 未被测试真判别(缓存 topSessions 已被首扫 limit 截断); (q) refresh 窗口内更大的 ?limit 静默欠填(聚合期截断继承自 Task 7,由 refreshMs 界定)— 最终 review 裁断是否值得改(方案:缓存 daily/topSessions 不在聚合期截断,聚合全量存、路由层 slice); (r) routes.spec.ts 缺 EOF 换行。
Task 8: complete (commit 9aab02b..70b6ba9, review clean, 3 deferred minors)
dsh-usage-host 包完成(8/8 任务)。

Task 9-11: implementer reconciliations ruled on:
- Ruling: package.json 增加 dsh-usage-host workspace 依赖(Task 10 import dsh-usage-host/shared 必需,client-ui-git 同构,常量内联无纯度问题)— 若错:纯度门禁或解析失败,审查者核 lib/client.js。
- Ruling: TS2664 修 LocaleNamespaceMap 增广用 type-only import type {}(ui-theme 同款,擦除不影响纯度)。
- Ruling: 测试命令从 worktree 根跑(既有裁定)。

Task 9-11: minor (deferred): (s) controller.spec 部分 URL 断言与 hostBase 同源表达式(略循环,test 1 已钉字面 URL); (t) TTL 边界未精确探测(4s/5.5s)。
Task 9-11: complete (commits 70b6ba9..573bfb9, review clean, 2 deferred minors)

Task 12: implementer reconciliations ruled on:
- Ruling: ctx.slots 经本地结构化 ClientSlots + serviceOf 读取(ui-renderer client 类型未构建,git-host vendor-types 先例;注册参数/导出/字典合并逐字保留)— 若错:运行时注册失败,Task 14 人工验证会暴露。
- Ruling: 模型明细默认展开(brief 测试 1 无点击即断言;ReadonlySet 记 collapsed,语义反转但状态形状/交互与要点一致)— 若错:审查者对照 brief 要点裁断。
- Ruling: 未定价提示不带模型名(展开行已含 goblin-9x,getByText 单匹配约束);'unpriced.notice' 键保留未用 — 若错:信息缺失,Minor 级。
- Ruling: Top 会话表无金额列(SessionUsageRow 线上类型无金额;若加需 host 侧改契约)— 计划文本与已交付 wire 类型冲突,以已交付为准。
- Ruling: 增 keys estimate.title/unpriced.intro(键集对齐)+ css-modules.d.ts(client-ui-git/memory 先例)。

Task 12: 3 个 Important 均为 brief 文本 vs 计划全局文本冲突(brief 被忠实执行,报告未主动上报),裁定如下:
- (1) serviceMissing 死键 + 通用 error:裁定 修复轮 — 真实价值高(DSH 未装 host 包时用户看到的是兜底文案而非报错),实现路径已明确(controller fetch ok 且响应含 serviceMissing 语义/或 404 判别)。按 received-code-review 精神,这是计划意图,不是可选润色。修法:controller 抛出带 status 的错误已含 status 字段;组件 catch 时 status===404 → serviceMissing;否则 error。不改 wire 契约。
- (2) 60s 成功后轮询:裁定 修复轮 — 计划全局文本明确,成本低(成功后 setTimeout 60s 递归,卸载/scan-settle 清理);对"看板"用途是核心体验(数据自刷新)。修法:scanning 5s 分支保留;成功且非 scanning → 60s 一次;卸载/错误态清除。
- (3) 会话数卡片:裁定 修复轮 — wire 已有 sessionCount,卡片列表补一张(sessionCount,含 skippedSessions 副文案),成本极低,信息价值明确。
- Minor 全部 defer:(u) bucketTotal 重复实现(最终 review 顺手收敛为 usageTotal 导入); (v) provider 折叠无键盘路径; (w) 扫描中失败重拉以错误视图替换好表格(60s 轮询修复时一并看); (x) pathTail 仅处理 '/'; (y) 卸载清理/重试测试缺失; (z) retry 不重置 loading(良性)。
Task 12: fix round 1/5 dispatched (3 Important addressed in one round)。

Task 12: fix round 1/5 (3 addressed, 0 open — serviceMissing 404 判别/60s 空闲轮询/会话数卡片;re-reviewer 逐条核对无新破坏; commit 08dda67..0c7207f)
Task 12: minor (deferred): (u) bucketTotal 重复实现(最终 review 收敛为 usageTotal 导入); (v) provider 折叠无键盘路径; (w) 扫描中失败重拉以错误视图替换好表格; (x) pathTail 仅处理 '/'; (y) 卸载清理/重试实际重拉无测试; (z) retry 不重置 loading(良性); (aa) 测试名 'stops when settled' 误导(改名后续 pass); (ab) 失败后 keep-fresh 循环永久停止(符合 spec,备忘)。
Task 12: complete (commits 573bfb9..0c7207f, review clean after 1 fix round, 8 deferred minors)
全部 12 个实现任务完成。

Task 13: complete — controller 自验:全仓 vitest 18 files/146 tests 全绿;pnpm -r run build 全部成功;纯度 grep client lib(usage)两文件均 0;工作树干净。

最终 review verdict: NEEDS FIXES — Critical: UsageService.scan 无 catch,listSessions/registry JSON/saveIndexAtomic 任一失败 → unhandled rejection 可崩 DSH 进程(node smoke 实证)。 Cheap round: (q) 缓存不截断(aggregate 用 MAX_SAFE_INTEGER,summary 层 slice)+ 真 ?limit=200 测试; (u) bucketTotal 收敛为 usageTotal 导入; (b) 聚合过滤全零 route/daily 行+测试; (c) 补 fold 两测试(无 usage 无 stream 不计;usage 优先于 stream); (a)(r) EOF 换行; (aa) 误导测试名改名。 其余全部 WONTFIX(已裁定,理由在案)。 Seam 全 PASS;与 master 零冲突(merge-tree 实测);(d) bucketsOf 经上游对照判非问题。

最终 review fix round: 6/6 findings ADDRESSED(re-reviewer 独立 node smoke 复核 Critical 遏制; commits 0c7207f..6d507d8; 152/152; 无新破坏)。分支全部工作完成 — 可合并。

Task 14: 安装完成 — profile package.json 注册(dsh-usage-host + dsh-client-ui-usage:link 依赖 + bundles 条目,提权审批通过);profile pnpm install 成功,node_modules 符号链接指向 master packages(usage-host lib 含 index.js+models.json;client lib 含 client.js)。等待:用户重启 Desktop + 人工验证清单(5 项)→ 空提交 chore: usage dashboard verified against running Desktop。

Task 14 修复: 首次重启未出现「使用统计」— 根因: profile 加载器只认声明 dsh.bundle.patch 的包(app-boot/src/profile.ts: bundle 清单须含 patch 文件);两个插件包缺 cordis.patch.yml + manifest 声明,被静默跳过。修复: 补两包 bundle 层(id usage-host / client-ui-usage, name ./lib/index.js)+ manifest dsh.bundle.patch,commit e10e33e(master 直提,4 文件 +15)。等用户再次重启验证。

Task 14 第二次排查: 15:30 重启仍不显示 — 根因 #2: 浏览器 roster 组装要求 patch 条目 name 为裸包名(exactPackageSpecifier 对 './lib/index.js' 返回 undefined → roster 行跳过 → 设置区永不出现; 上游 web-app 的 ui-jobs 等全部用包名)。修复: dsh-client-ui-usage patch name → dsh-client-ui-usage, commit 9275d5e。发现: (a) 存在并行会话在改同一仓库(f769447 给 client-ui-git 补 manifest 声明, fa0892d 重命名包目录 + 重跑 profile 安装 — 链接已由对方更新为 dsh- 前缀路径); (b) client-ui-git / client-ui-memory 的 patch 同样用 './lib/index.js',浏览器半区同样进不了 roster(未动,留给并行会话/用户决定)。

Task 14 第三次排查: 根因 #3(直接原因)— 并行会话重写 profile package.json,丢失 dsh-usage-host/dsh-client-ui-usage 的 bundles 条目与 client-ui-usage 依赖,最后一次重启根本没加载插件。已恢复(提权)并 pnpm install 验证:bundles 8 项、双链接完好。注意: 两个会话在竞争同一 profile 文件 — 需用户协调,否则可能再次被覆盖。

