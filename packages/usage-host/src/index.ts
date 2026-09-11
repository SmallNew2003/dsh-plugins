/**
 * Host half of the usage dashboard plugin: the aggregation service plus one
 * webServer summary route behind the connection browser trust fence.
 * @module dsh-usage-host
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export * from './registry.ts'

export const name = 'dsh-usage-host'

export function apply(ctx: Context): void {
  void ctx
}
