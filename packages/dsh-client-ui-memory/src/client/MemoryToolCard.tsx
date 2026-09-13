/** One engram memory tool call as an inline transcript card. */

import { useState } from 'react'
import { memoryCardModel, type MemoryBlockInput } from './memory-model.ts'
import css from './MemoryToolCard.module.css'

/** Translator seat the locale service injects for the registration namespace. */
export type MemoryTranslate = (key: string, params?: Readonly<Record<string, string | number>>) => string

/** Structural props: the framework seat delivers these plus extras the card ignores. */
export interface MemoryToolCardProps {
  /** Tool call identity, stable across running and settled forms. */
  readonly callId: string
  /** Wire tool name (`mcp__engram__<tool>`); the keyed dispatch value. */
  readonly toolName: string
  /** Frozen running call or settled result node. */
  readonly block: MemoryBlockInput
  /** Namespace translator. */
  readonly t: MemoryTranslate
}

/** Stroke path sets per glance kind, drawn at 16×16 and scaled by CSS. */
const ICON_PATHS: Record<string, [string, string]> = {
  write: ['M4 2.5h7.5a1 1 0 0 1 1 1v10l-2.4-1.6L7.7 13.5 5.3 11.9l-2.3 1.6v-9a1 1 0 0 1 1-1Z', 'M6.25 6.5h3.5M8 4.75v3.5'],
  read: ['M4.6 4.6a3.4 3.4 0 1 0 4.8 4.8 3.4 3.4 0 0 0-4.8-4.8Z', 'm10.4 10.4 2.85 2.85'],
  plain: ['M8 2.75a5.25 5.25 0 1 0 0 10.5 5.25 5.25 0 0 0 0-10.5Z', 'M8 7.5v3'],
}

/** The glance glyph per card kind: a 14px stroke icon, colored by the theme. */
function KindIcon({ kind, error }: { kind: string; error: boolean }) {
  if (error) {
    return (
      <svg className={css.icon} width='14' height='14' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' aria-hidden>
        <circle cx='8' cy='8' r='5.25' />
        <path d='M8 5.2v3.6' />
        <circle cx='8' cy='11' r='0.45' fill='currentColor' stroke='none' />
      </svg>
    )
  }
  const [body, extra] = ICON_PATHS[kind] ?? ICON_PATHS.plain!
  return (
    <svg className={css.icon} width='14' height='14' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
      <path d={body} />
      <path d={extra} />
    </svg>
  )
}

/** The collapsed-row chevron; rotates via CSS when the drawer is open. */
function Chevron() {
  return (
    <svg className={css.chev} width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' aria-hidden>
      <path d='m4 6 4 4 4-4' />
    </svg>
  )
}

/**
 * Renders what the call did to memory at a glance — one quiet row: icon,
 * action, headline, hit count, muted preview — with the full result behind a
 * row-click drawer. A pure function of the frozen block, so transcript
 * re-renders stay cheap.
 */
export function MemoryToolCard({ toolName, block, t }: MemoryToolCardProps) {
  const model = memoryCardModel(toolName, block)
  const [open, setOpen] = useState(false)
  const expandable = model.payload !== null
  const expanded = expandable && open
  const rowBody = (
    <>
      <KindIcon kind={model.kind} error={model.isError} />
      <span className={css.action}>{t(model.actionKey)}</span>
      {model.isError && <span className={css.state}>{t('card.error')}</span>}
      {!model.isError && model.running && <span className={css.state}>{t('card.running')}</span>}
      {model.headline !== null && <span className={css.headline}>{model.headline}</span>}
      {model.count !== null && <span className={css.count}>{t('card.count', { count: model.count })}</span>}
      {model.detail !== null && <span className={css.detail}>{model.detail}</span>}
      {!model.running && !model.isError && model.payload === null && model.detail === null
        && <span className={css.empty}>{t('card.empty')}</span>}
      {expandable && <Chevron />}
    </>
  )
  return (
    <div className={css.card} data-kind={model.kind} data-error={model.isError || undefined} data-open={expanded || undefined}>
      {expandable
        ? (
            <button
              type='button'
              className={css.row}
              aria-expanded={expanded}
              aria-label={expanded ? t('card.collapse') : t('card.expand')}
              onClick={() => setOpen(value => !value)}
            >
              {rowBody}
            </button>
          )
        : <span className={css.row}>{rowBody}</span>}
      {expandable && expanded && (
        <div className={css.drawer}>
          <pre className={css.payload}>{model.payload}</pre>
        </div>
      )}
    </div>
  )
}
