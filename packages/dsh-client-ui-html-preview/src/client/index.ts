/**
 * HTML preview plugin, browser half: takes over the shipped present row on the
 * tool.call.toolview keyed seat (priority -1 shadows the shipped default 0;
 * same-priority registration throws) so presented .html deliverables render as
 * live sandboxed previews. All policy lives here — composing this plugin out
 * of cordis.yml restores the shipped row verbatim.
 */

import { HtmlPresentCard, type HtmlFileReader } from './HtmlPresentCard.tsx'
import { en, NS, zh } from './locales.ts'
import { bytesFromBase64, serviceOf, type ClientLocale, type ClientRemotes, type ClientSlots } from './vendor-types.ts'

export {
  HtmlPresentCard,
  type HtmlFileReader,
  type HtmlPresentCardProps,
  type HtmlTranslate,
} from './HtmlPresentCard.tsx'
export { presentModel, type PresentBlockLike, type PresentModel } from './present-model.ts'

/** Required services for the toolview takeover, its dictionaries, and the file reader. */
export const inject = ['slots', 'locale', 'remote', 'remote.workspaceFiles']

/**
 * Client plugin body: register the dictionaries and the present-tool takeover.
 * @param ctx - client root context.
 */
export function apply(ctx: unknown): void {
  const locale = serviceOf<ClientLocale>(ctx, 'locale')
  const slots = serviceOf<ClientSlots>(ctx, 'slots')
  const remote = serviceOf<ClientRemotes>(ctx, 'remote')

  locale.register(NS, { zh, en })
  const readFile: HtmlFileReader = async (sessionId, path, signal) => {
    const result = await remote.workspaceFiles.readAll(sessionId, path, signal)
    if (!result.ok) throw new Error(result.error?.message ?? 'Unable to read the presented file')
    return bytesFromBase64(result.value.data)
  }
  slots.inject('tool.call.toolview', () =>
    slots.register(
      { name: 'tool.call.toolview', key: 'present', priority: -1, locale: NS, inject: () => ({ readFile }) },
      HtmlPresentCard,
    ),
  )
}
