# DSH 供应商 Token 消耗看板设计

> 状态:待用户评审。本文是设计文档,不是实现计划。
> 目标平台:DSH Desktop(原样运行上游 deepseek-harness)。

## 背景与目标

用户希望在 DSH Web GUI 中看到**供应商维度的 token 消耗统计看板**。DSH 已有 per-session 的 tokenUsage 投影(四桶:uncachedInput / output / cacheRead / cacheWrite),但只有总量,没有按供应商/模型的分组;跨会话聚合完全缺失。

**范围**:跨全部 workspace 的全部会话,按供应商聚合、细分到模型、按天趋势、会话消耗排行,并估算费用(¥/$)。入口在设置页新增「使用统计」模块。

**硬约束**:纯插件,零上游源码改动;全部代码落在 dsh-plugins 仓库;安装方式与 git-worktree 插件相同(profile 配置或 `dsh plugin` 语义)。

## 已验证的可行性依据

- 会话日志的 assistant/message 事件携带 `source: {provider, model}` 与流末尾 usage(含每次 retry 尝试)——按供应商归因的原始数据全部在场;上游 token-meter 的 `deriveTurnTokenUsage`(turn-usage.ts)即为同口径折叠除错参考。
- host 侧插件可注入 `sessionQuery` 服务(先例:dsh-git-host):`listSessions()` 枚举全部会话(SessionRecord,header 含 cwd/createdAt),可观察原始完整日志(SessionLogSnapshot.events)。**不直接碰磁盘布局与 zstd**,DSH 升级安全。
- client 侧插件可注册 `settings.section` slot(ui-settings 的 slots.ts 契约):每个注册条目即设置面板中一个独立页面,自带 nav 标签(order 定位),section 内容完全由注册者渲染。
- host 侧 webServer 具名路由 + connection.requestRejection 浏览器信任围栏,先例:dsh-git-host / dsh-host-open-in-app。
- 插件双语字典模式(zh 为 key-set 事实源、en 对齐断言),先例:client-ui-git。

## 总体结构:两个插件包

| 包 | 角色 | 模板 |
| --- | --- | --- |
| `dsh-usage-host` | host 侧:sessionQuery 枚举 + 折叠聚合 + 归一化 + 计价 + webServer 路由 + 增量索引 | `dsh-git-host` |
| `dsh-client-ui-usage` | 浏览器侧:settings.section「使用统计」页面 + 看板 UI | `client-ui-git`(controller + slots 模式) |

依赖关系:UI 要求 host 在场(host 缺席时路由 404,前端显示"服务未安装"并大声失败);host 可独立安装(供未来其他 UI/工具消费)。

## 数据流

1. **枚举**:`sessionQuery.listSessions()` 取全部会话记录。
2. **增量索引**:每会话缓存一条聚合摘要,键为观察到的日志事件数(`capturedThroughSeq` / 事件数)。事件数未变 → 直接复用缓存;变了 → 重载该会话事件并重折。索引持久化为 JSON(~/.dsh/storages/usage-host/index.json),含 `normalizerVersion`(见归一化节)。
3. **折叠**:遍历会话原始事件,对 assistant/message 流提取每尝试 `{provider, model, buckets, time, sessionId, turn}`;turn 内重试尝试的合并/替换修正逻辑与上游 `deriveTurnTokenUsage` 同口径(每 turn 只计一次最终 usage,替换消息不重复累计)。
4. **聚合**:一次折叠同时产出四个视图 + 总计:
   - `providers`:per provider 四桶;
   - `models`:canonical 模型四桶(附原始别名清单);
   - `daily`:按天四桶(日界按本机时区);
   - `topSessions`:per session 四桶 + 标题 + cwd,按 totalTokens 降序(默认 Top 20,路由支持 ?limit=)。
5. **路由**:`GET USAGE_SUMMARY_ROUTE`(常量定义于 shared.ts,路径形如 `/usage/summary`)返回 `{ generatedAt, scanning, totals, providers, models, daily, topSessions, unpricedModels, priceEstimate }`。
6. **首次扫描**:350+ 会话(约 200MB)全量折叠放后台任务,路由立即返回旧索引(或空)+ `scanning: true`;前端显示进度提示并轮询。日常刷新只重算变化的会话,秒级返回。

## 模型名归一化

1. 聚合引擎记录**原始** `(provider, rawModelId)`;归一化是展示视图,原始对永不丢弃。
2. **规范注册表 `models.json`**(包内置默认 + 用户可覆盖):canonical id → `{ displayName, aliases[], pricing{input, cacheRead, cacheWrite, output} }`($/M tokens)。例:`deepseek-v4-flash` 收录别名 `ds-v4-flash`、`deepseek-chat`、`deepseek-v4-flash-20260115`。
3. **自动归一兜底**(别名未命中时):小写化 → 剥离日期后缀 → 剥离常见供应商前缀(`ds-`、`deepseek-` 等)。
4. **未识别模型**:归入「未识别」分组,展示原始名与 token 数,不参与计价;UI 提示可在 models.json 补别名。
5. **缓存一致性**:`normalizerVersion` = 规则版本 + models.json 内容哈希;任一变化 → 下次扫描全量重算(一次性重折叠全部会话,量级可接受),补完别名刷新即生效。

## 费用估算

- 单价完全来自 models.json;每个 canonical 模型金额 = Σ(桶 tokens / 1e6 × 单价)。
- 未配置单价的模型不计入金额,进 `unpricedModels`;前端标注"未配置单价,未计入"。
- 所有金额展示均带「估算」标识与 disclaimer(价格表手动维护,可能与供应商实收不一致);不追求账单级精确。

## UI 设计(settings.section「使用统计」)

注册 `settings.section`(id `usage`,order 置于 Models 附近),页面自上而下:

1. **汇总卡**:四桶总量 + 总金额(估算)卡片;右上角显示数据生成时间与「扫描中」状态。
2. **供应商占比表**:每行 provider、四桶 token、金额、占比条(CSS 宽度百分比,不引入图表库)。
3. **模型细分**:供应商内可展开,行含 displayName、四桶、金额、原始别名 tooltip。
4. **每日趋势**:CSS 柱状图,聚合产出全部历史天,UI 默认渲染近 30 天(按天 output+uncachedInput 或总 token,hover 显示四桶明细)。
5. **会话排行**:Top 20 表(标题、cwd 尾段、时间、四桶、金额)。
6. **未识别模型提示条**(仅当存在):列出原始名与引导文案。
7. 双语字典 NS `usage`,zh 为事实源;所有文案走 locale,不硬编码。

交互:页面打开时 fetch 路由;scanning 为 true 时 5s 轮询;失败显示错误条 + 重试按钮。

## 错误处理

- 单会话日志读取/校验失败:**跳过该会话**并计入 `skippedSessions`(路由字段),UI 显示"n 个会话读取失败"徽标;不让一个坏文件毁掉整个看板。
- sessionQuery / 索引文件损坏:丢弃索引重建(全量重扫),索引写盘采用临时文件 + 原子改名。
- 路由层沿用 requestRejection 信任围栏(401/403),响应体大小受 topSessions limit 约束。
- host 包缺席:前端显式提示"使用统计服务未安装"。

## 测试

- **host 折叠纯函数**:构造含 retry、消息替换、多供应商混用、别名变体的合成事件序列,断言四视图与上游 deriveTurnTokenUsage 口径一致(端到端数字对齐用上游测试样例)。
- **归一化**:规则 + 别名表 + 未识别分组;normalizerVersion 变化触发全量重算。
- **增量索引**:同事件数命中缓存;变化会话重折;损坏索引重建;原子写。
- **路由**:信任围栏拒绝、scanning 行为、limit 参数。
- **client 组件**:jsdom 直喂 props(四视图 fixture 渲染、占比条、轮询、未识别提示、scanning 状态),与 client-ui-git 测试同模式;生命周期测试验证 section/字典随 dispose 移除。

## 非目标

- 不做实时流式更新(打开页面时快照 + 轮询足够)。
- 不做价格表管理 UI(models.json 手工维护)。
- 不做导出/CSV(后续需要再加)。
- 不动上游 deepseek-harness 任何源码。
