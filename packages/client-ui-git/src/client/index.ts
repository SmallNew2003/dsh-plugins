/**
 * Git badge plugin, browser half: one session-header action showing the
 * session repository's branch and managing its worktrees. Facts come from the
 * dsh-git-host routes; the badge renders nothing when the session is not in a
 * git repository.
 */

import { GitBadge } from './GitBadge.tsx'
import { GitController } from './controller.ts'
import { en, NS, zh } from './locales.ts'
import { serviceOf, type ClientLocale, type ClientSlots } from './vendor-types.ts'

export type { GitBadgeProps } from './GitBadge.tsx'
export { GitController } from './controller.ts'

/** Required services for locale registration and header-slot contribution. */
export const inject = ['sessions', 'slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the header badge.
 * @param ctx - client root context.
 */
export function apply(ctx: unknown): void {
  const controller = new GitController()
  const locale = serviceOf<ClientLocale>(ctx, 'locale')
  const slots = serviceOf<ClientSlots>(ctx, 'slots')
  void locale.register(NS, { zh, en })
  slots.inject(
    'conversation.session.header.actions',
    () => slots.register({
      name: 'conversation.session.header.actions',
      id: 'git-badge',
      // After the job list: process work reads before repository state.
      order: 30,
      locale: NS,
      inject: () => ({ controller }),
    }, GitBadge),
  )
}
