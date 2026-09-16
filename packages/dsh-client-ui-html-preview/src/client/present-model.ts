/**
 * Pure parse model for one `present` tool call: classify the call state,
 * recover the declared file list, and pick the files an inline HTML preview
 * can render. Defensive by design — args are model-authored JSON and may be
 * partial while the call streams.
 */

export interface PresentFileArg {
  readonly path: string
  readonly description?: string
}

export type PresentCallState = 'running' | 'ok' | 'error' | 'stopped'

export interface PresentModel {
  /** Running while the call streams; stopped marks a user interruption. */
  readonly state: PresentCallState
  /** Every declared file with a usable string path, in declared order. */
  readonly files: readonly PresentFileArg[]
  /** The subset whose extension marks an HTML document (preview candidates). */
  readonly htmlFiles: readonly PresentFileArg[]
  /** Settled result text, joined from the content items. */
  readonly output: string
  /** Row detail line: result text, or the error identity for failed calls. */
  readonly details: string
}

/** Structural surface of the Tool layer's present block (running or settled). */
export interface PresentBlockLike {
  /** Presence marks a settled call. */
  readonly kind?: string
  readonly argsRaw?: string
  readonly call?: { readonly argsRaw?: string }
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
  readonly isError?: boolean
  readonly error?: { readonly name?: string; readonly code?: string }
}

const HTML_EXTENSION = /\.html?$/i

/** Recover the declared file list from one raw args JSON string. */
function parseFiles(raw: string | undefined): readonly PresentFileArg[] {
  if (raw === undefined || raw === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [] // Truncated or malformed tool JSON shows as zero declared files.
  }
  if (typeof parsed !== 'object' || parsed === null || !('files' in parsed)) return []
  const files = (parsed as { files: unknown }).files
  if (!Array.isArray(files)) return []
  const usable: PresentFileArg[] = []
  for (const entry of files) {
    if (typeof entry !== 'object' || entry === null) continue
    const path = (entry as { path?: unknown }).path
    if (typeof path !== 'string') continue
    const description = (entry as { description?: unknown }).description
    usable.push(typeof description === 'string' ? { path, description } : { path })
  }
  return usable
}

/**
 * Parse one present tool block into the row's display model.
 * @param block - the frozen running-or-settled block the Tool layer passes.
 */
export function presentModel(block: PresentBlockLike): PresentModel {
  const settled = typeof block.kind === 'string'
  const raw = (settled ? block.call?.argsRaw : undefined) ?? block.argsRaw
  const files = parseFiles(raw)
  const state: PresentCallState = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError === true
        ? 'error'
        : 'ok'
  const output = settled
    ? (block.content ?? [])
        .map(item => (item.type === 'text' ? item.text : JSON.stringify(item)))
        .join('\n')
    : ''
  const details = output || (settled && block.error ? `${block.error.name}: ${block.error.code}` : '')
  return { state, files, htmlFiles: files.filter(file => HTML_EXTENSION.test(file.path)), output, details }
}
