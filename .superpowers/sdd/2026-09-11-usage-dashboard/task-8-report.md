# Task 8 Report — dsh-usage-host 路由 + cordis apply(src/index.ts 整体替换)

## Status
DONE(commit 70b6ba9,worktree branch usage-dashboard)

## 实现内容
- `packages/usage-host/src/index.ts` 整体替换为最终装配:
  - cordis 函数插件 `dsh-usage-host`,`inject = ['webServer', 'connection', 'sessionQuery']`。
  - `apply(ctx, config = {})` 构造 `UsageService`(registryOverridesPath / indexPath / refreshMs 逐字段透传),并在
    `ctx.effect(...)` 内以 `kind: 'exact'`、`path: USAGE_SUMMARY_ROUTE` 注册 GET handler。
  - handler 顺序:connection.requestRejection 围栏(401/403 直接 end,不再继续)→ 非 GET 405 + `allow: GET` →
    `sendJson(200, service.summary(limitOf(req)))`(`content-type: application/json; charset=utf-8`、`cache-control: no-store`)。
  - `limitOf`:仅接受 1..200 的 safe integer,否则(缺省/非数字/越界)回退 20。
  - 导出装配:`export type *` + `USAGE_SUMMARY_ROUTE`(shared)、`aggregateSessions`/`AggregateInput`(aggregate,补上 Task 5 裁定)、
    `UsageService`/`SessionQueryLike`/`UsageServiceOptions`(service)、保留既有 `export * from './registry.ts'`。
- `packages/usage-host/tests/routes.spec.ts` 新增 5 个用例:注册(kind='exact'、路径正确)、GET 200 首响应 scanning 零壳 +
  扫描完成后完整 payload(providers/models/totals/topSessions 结构断言)、POST→405+allow:GET、401/403 围栏短路、
  limit 钳制(25 会话:limit=abc→20、limit=500→20、limit=0→20、limit=3→3)。

## TDD 证据
- RED:`pnpm exec vitest run packages/usage-host/tests/routes.spec.ts`(worktree 根;等价于 brief 的
  `pnpm --filter dsh-usage-host exec vitest run tests/routes.spec.ts`,该命令在根 vitest.config include 下找不到测试文件,
  见“偏差”)→ 5 failed / 5(`expected undefined to be 'exact'`,stub apply 未注册路由)。
- GREEN:同一命令 → 5 passed (5)。
- 全量:`pnpm exec vitest run` → 15 files / 131 tests passed(基线 126 + 新增 5)。
- 构建:`pnpm --filter dsh-usage-host build`(tsc 严格 + tsdown)通过,models.json 随 bundle 拷贝到 lib/。

## 变更文件
- packages/usage-host/src/index.ts(整体替换)
- packages/usage-host/tests/routes.spec.ts(新增)
- Commit:`70b6ba9 feat(usage-host): summary route behind browser trust fence`

## 与 brief 的偏差(已交付代码/事实为准)
1. **inject**:brief Interfaces 明确要求 `inject ['webServer', 'connection', 'sessionQuery']`,但其代码块遗漏;
   已按 git-host 既有风格补上 `export const inject = [...]`。
2. **aggregate 导出**:dispatch 裁定要求从 src/index.ts 导出 aggregate;brief 代码块遗漏;已补
   `export { aggregateSessions, type AggregateInput } from './aggregate.ts'`。
3. **Config schema**:brief 的 `z.number().int()...optional()` 在 schemastery 中不存在(`.int()`、`.optional()` 均无此方法);
   按 git-host 已交付风格改为 `z.number().step(1).min(0).max(3_600_000)`,object 属性默认即可选(schemastery 仅 `.required()` 标记必填),
   运行时语义与 brief 等价(三字段全可选、整数有界)。类型注解仍为 `z<Config>`。
4. **保留 `export * from './registry.ts'`**:brief 整体替换代码未包含,但这是既有已交付导出,按“冲突以已交付代码为准”保留
   (与其余导出无命名冲突)。
5. **测试命令**:brief 的 `pnpm --filter dsh-usage-host exec vitest run` 因根 vitest.config.ts 的 include 以 worktree 根解析而在包内
   找不到测试文件;改为 worktree 根 `pnpm exec vitest run packages/usage-host/tests/routes.spec.ts`(dispatch 全量基线亦注明从根跑)。

## Self-review
- 围栏先于方法检查与 limit 解析;405 响应不带 body;401/403 不触发 service.summary。
- limitOf 与 service.summary(limit) 的 topSessions 截断语义一致(聚合阶段已按 limit 截断,响应阶段再 slice,双保险)。
- 纯函数风格、Readonly/严格 TS 通过(tsc -p 构建零错误);测试为真实 Context + Reflect 注入,与 git-host routes.spec 同构。
- 无 subagent;单提交。

## Concerns
- 无阻塞。备注:`apply` 未注册 service.dispose()(brief 代码同样未含);当前 UsageService.dispose 仅复位扫描标志,影响有限,
  如后续插件卸载语义要求停止后台扫描可在收尾任务统一处理。

## Verification commands & results
```
pnpm exec vitest run packages/usage-host/tests/routes.spec.ts   # RED 5 failed → GREEN 5 passed
pnpm exec vitest run                                            # 131 passed (15 files)
pnpm --filter dsh-usage-host build                              # exit 0
```
