/**
 * Pure shaping of one engram memory tool call into a display model. No
 * React, no framework: the same model feeds the card component and the tests.
 * Parsing is defensive end to end — the wire side (model JSON args, MCP text
 * results) is a trust boundary, so every read falls back instead of throwing.
 */

/** The raw tool name of every engram agent-profile tool (engram 1.20.0). */
export const ENGRAM_TOOLS = [
  'mem_capture_passive',
  'mem_compare',
  'mem_context',
  'mem_current_project',
  'mem_doctor',
  'mem_get_observation',
  'mem_judge',
  'mem_pin',
  'mem_review',
  'mem_save',
  'mem_save_prompt',
  'mem_search',
  'mem_session_end',
  'mem_session_start',
  'mem_session_summary',
  'mem_suggest_topic_key',
  'mem_unpin',
  'mem_update',
] as const

/** Tools that change stored memory. */
const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'mem_save',
  'mem_update',
  'mem_capture_passive',
  'mem_session_summary',
  'mem_save_prompt',
  'mem_session_end',
  'mem_delete',
  'mem_pin',
  'mem_unpin',
])

/** Tools that query stored memory. */
const READ_TOOLS: ReadonlySet<string> = new Set([
  'mem_search',
  'mem_context',
  'mem_get_observation',
  'mem_timeline',
  'mem_compare',
  'mem_session_start',
  'mem_current_project',
])

/** How a card summarizes the call at a glance. */
export type MemoryCardKind = 'write' | 'read' | 'plain'

/**
 * Structural subset of the chat ToolCallBlock the model needs: a running
 * call (argsRaw) or a settled result (content, isError). Structurally
 * satisfied by both, so the component passes the real block unchanged.
 */
export interface MemoryBlockInput {
  readonly kind?: 'tool-result'
  readonly name?: string | null
  /** Running-call argument head; a settled result backfills it under \`call\`. */
  readonly argsRaw?: string | null
  readonly call?: { readonly argsRaw?: string | null } | null
  readonly content?: readonly { readonly type?: string; readonly text?: string }[] | null
  readonly isError?: boolean
}

/** Display model of one memory tool call. */
export interface MemoryCardModel {
  /** Locale key of the action label; 'card.action.fallback' when unlisted. */
  readonly actionKey: string
  /** Glance classification driving the icon and emphasis. */
  readonly kind: MemoryCardKind
  /** The query, title, or id the call was about; null when none applies. */
  readonly headline: string | null
  /** Hit count of a settled read result; null when unknown. */
  readonly count: number | null
  /** One-line preview of the content written or the top result; null when hidden. */
  readonly detail: string | null
  /** Full result text behind the expand toggle; null while running or absent. */
  readonly payload: string | null
  /** True while the tool/result has not landed. */
  readonly running: boolean
  /** True when the settled result reports an error. */
  readonly isError: boolean
}

/** Longest preview the card shows before the expand toggle takes over. */
const DETAIL_LIMIT = 120

/** The raw engram tool name behind a wire tool name (`mcp__engram__mem_save`). */
export function rawToolOf(toolName: string): string {
  const index = toolName.lastIndexOf('__')
  return index < 0 ? toolName : toolName.slice(index + 2)
}

/** Collapse whitespace so multi-line results shape into one card line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Truncate with an implied ellipsis at the limit. */
function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit)
}

/** Join the settled content's text blocks; other block kinds contribute nothing. */
export function resultTextOf(block: MemoryBlockInput): string {
  return (block.content ?? [])
    .filter(block => block.type === 'text' || block.type === undefined)
    .map(block => block.text ?? '')
    .join('\n')
}

/** Parse the call arguments; malformed model JSON degrades to an empty object. */
function argsOf(block: MemoryBlockInput): Record<string, unknown> {
  const raw = block.argsRaw ?? block.call?.argsRaw
  if (typeof raw !== 'string' || raw === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

/** Parse JSON defensively; anything unparseable stays null. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** First present non-empty string field among the candidates. */
function stringArg(args: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return null
}

/** The truncated one-line preview of the first present content-ish field. */
function previewArg(args: Record<string, unknown>, keys: readonly string[]): string | null {
  const value = stringArg(args, keys)
  return value === null ? null : truncate(oneLine(value), DETAIL_LIMIT)
}

/** The glance headline for one call, from the args the model sent. */
function headlineOf(tool: string, args: Record<string, unknown>): string | null {
  switch (tool) {
    case 'mem_save':
      // A titleless save summarizes by its content instead.
      return stringArg(args, ['title']) ?? previewArg(args, ['content', 'observation'])
    case 'mem_update':
    case 'mem_get_observation':
    case 'mem_pin':
    case 'mem_unpin':
    case 'mem_review':
      return stringArg(args, ['id'])
    case 'mem_search':
      return stringArg(args, ['query'])
    case 'mem_compare':
      return compareHeadline(args)
    case 'mem_session_start':
    case 'mem_session_end':
      return stringArg(args, ['id'])
    case 'mem_capture_passive':
    case 'mem_session_summary':
    case 'mem_save_prompt':
      return previewArg(args, ['content'])
    default:
      return null
  }
}

/** `a ↔ b` over the two compared memory ids. */
function compareHeadline(args: Record<string, unknown>): string | null {
  const a = stringArg(args, ['memory_id_a'])
  const b = stringArg(args, ['memory_id_b'])
  if (a === null && b === null) return null
  return (a ?? '?') + ' \u2194 ' + (b ?? '?')
}

/** The array a read result reports its hits in, when parseable. */
function countOf(result: unknown): number | null {
  if (Array.isArray(result)) return result.length
  if (typeof result === 'object' && result !== null) {
    const record = result as Record<string, unknown>
    for (const key of ['observations', 'results', 'items']) {
      const value = record[key]
      if (Array.isArray(value)) return value.length
    }
  }
  return null
}

/** Shape one memory tool call into its card model. */
export function memoryCardModel(toolName: string, block: MemoryBlockInput): MemoryCardModel {
  const tool = rawToolOf(toolName)
  const running = block.kind !== 'tool-result'
  const isError = block.isError === true
  const args = argsOf(block)
  const write = WRITE_TOOLS.has(tool)
  const read = READ_TOOLS.has(tool)
  const headline = headlineOf(tool, args)
  const result = running ? null : resultTextOf(block)
  const hasResult = result !== null && result !== ''
  const payload = hasResult ? result : null
  const parsed = hasResult ? parseJson(result) : null
  // The glance detail: what a write stores (its content preview), or what a
  // settled call returned. The headline already carries the content when it
  // fell back to it, so the detail line would only repeat it. Errors show the
  // payload, never a shaped preview; a running write previews the content it
  // is about to store.
  const contentPreview = write ? previewArg(args, ['content', 'observation']) : null
  const headlineIsContent = headline !== null && headline === contentPreview
  const detail = isError || headlineIsContent
    ? null
    : contentPreview ?? (hasResult ? truncate(oneLine(result), DETAIL_LIMIT) : null)
  return {
    actionKey: (ENGRAM_TOOLS as readonly string[]).includes(tool) ? 'card.action.' + tool : 'card.action.fallback',
    kind: write ? 'write' : read ? 'read' : 'plain',
    headline,
    count: parsed === null || isError ? null : countOf(parsed),
    detail,
    payload,
    running,
    isError,
  }
}
