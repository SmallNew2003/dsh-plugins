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

/** The glance glyph per card kind. */
const KIND_GLYPH: Record<string, string> = { write: '\u{1F4BE}', read: '\u{1F50D}', plain: '\u2139\uFE0F' }

/**
 * Renders what the call did to memory at a glance — action, headline, hit
 * count, content preview — with the full result behind an expand toggle.
 * A pure function of the frozen block, so transcript re-renders stay cheap.
 */
export function MemoryToolCard({ toolName, block, t }: MemoryToolCardProps) {
  const model = memoryCardModel(toolName, block)
  const [open, setOpen] = useState(false)
  return (
    <div className={css.card} data-kind={model.kind} data-error={model.isError || undefined}>
      <span className={css.glyph} aria-hidden>{KIND_GLYPH[model.kind]}</span>
      <span className={css.action}>{t(model.actionKey)}</span>
      {model.isError && <span className={css.state}>{t('card.error')}</span>}
      {!model.isError && model.running && <span className={css.state}>{t('card.running')}</span>}
      {model.headline !== null && <span className={css.headline}>{model.headline}</span>}
      {model.count !== null && <span className={css.count}>{t('card.count', { count: model.count })}</span>}
      {model.detail !== null && <span className={css.detail}>{model.detail}</span>}
      {!model.running && !model.isError && model.payload === null && model.detail === null
        && <span className={css.empty}>{t('card.empty')}</span>}
      {model.payload !== null && (
        open
          ? (
              <>
                <button type='button' className={css.toggle} onClick={() => setOpen(false)}>{t('card.collapse')}</button>
                <pre className={css.payload}>{model.payload}</pre>
              </>
            )
          : <button type='button' className={css.toggle} onClick={() => setOpen(true)}>{t('card.expand')}</button>
      )}
    </div>
  )
}
