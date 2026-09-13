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



