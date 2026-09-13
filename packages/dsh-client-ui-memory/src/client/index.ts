/**
 * Memory card plugin, browser half: one inline transcript card per engram
 * memory tool call, keyed by the wire MCP tool name on the tool.call.toolview
 * slot the Tool layer declares. Registering is a takeover per tool name; an
 * engram tool name this plugin does not know falls back to the generic row.
 */

import { ENGRAM_TOOLS } from './memory-model.ts'
import { MemoryToolCard } from './MemoryToolCard.tsx'
import { en, NS, zh } from './locales.ts'
import { serviceOf, type ClientLocale, type ClientSlots } from './vendor-types.ts'

export { ENGRAM_TOOLS, memoryCardModel, rawToolOf } from './memory-model.ts'
export type { MemoryCardModel } from './memory-model.ts'
export type { MemoryToolCardProps } from './MemoryToolCard.tsx'

/** Required services for locale registration and toolview contribution. */
export const inject = ['slots', 'locale']

/** The wire names this plugin takes over (`mcp__engram__<tool>`). */
const WIRED_TOOLS: readonly string[] = ENGRAM_TOOLS.map(tool => `mcp__engram__${tool}`)

/**
 * Client plugin body: register the dictionaries and one memory card per
 * engram tool name.
 * @param ctx - client root context.
 */
export function apply(ctx: unknown): void {
  const locale = serviceOf<ClientLocale>(ctx, 'locale')
  const slots = serviceOf<ClientSlots>(ctx, 'slots')
  void locale.register(NS, { zh, en })
  for (const wired of WIRED_TOOLS) {
    slots.inject('tool.call.toolview', () =>
      slots.register({ name: 'tool.call.toolview', key: wired, locale: NS }, MemoryToolCard))
  }
}
