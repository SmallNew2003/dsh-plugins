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
export * from './registry.ts'
export { aggregateSessions, type AggregateInput } from './aggregate.ts'
export { UsageService, type SessionQueryLike, type UsageServiceOptions } from './service.ts'

export const name = 'dsh-usage-host'

/** The route carrier, the trust fence guarding it, and the session corpus. */
export const inject = ['webServer', 'connection', 'sessionQuery']

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
  registryOverridesPath: z.string(),
  indexPath: z.string(),
  refreshMs: z.number().step(1).min(0).max(3_600_000),
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
