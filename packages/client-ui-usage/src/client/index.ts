/**
 * Browser half: the usage settings section. Data rides the inject face (one
 * shared UsageController); the shell renders nav chrome.
 *
 * @module dsh-client-ui-usage/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the shell's SlotMap merge ('settings.section').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the ctx.locale Context merge.
import type {} from '@deepseek-ai/dsh-client-locale/client'
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

/**
 * Structural surface of the framework slot registry this plugin consumes.
 * Local type-only view over the two consumed methods (the client-ui-git
 * vendor-types precedent): the renderer package's client types are not built
 * in this workspace, so ctx.slots is read through the open-in-app service
 * access instead of the (currently unresolvable) Context merge. Erased at
 * runtime; register parameters follow the settings.section contract.
 */
interface ClientSlots {
  /** Contribute to one declared slot key; the callback registers this entry. */
  inject(name: string, contribute: () => unknown): void
  /** Register one entry into a declared slot key. */
  register(options: {
    readonly name: string
    readonly id: string
    readonly order: number
    readonly label: () => string
    readonly inject: () => UsageSectionInjected
  }, component: unknown): unknown
}

/** Read a browser-side service by name with a local structural surface. */
function serviceOf<T>(ctx: unknown, name: string): T {
  return Reflect.get(ctx as { [key: string]: unknown }, name) as T
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

  const slots = serviceOf<ClientSlots>(ctx, 'slots')
  const controller = new UsageController()
  const t = ctx.locale.bind(NS) as UsageSectionInjected['t']

  slots.inject('settings.section', () => slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 40,
    label: () => t('nav'),
    inject: (): UsageSectionInjected => ({ controller, t }),
  }, UsageSection))
}
