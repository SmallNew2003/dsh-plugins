/**
 * One present tool call as an inline transcript card, taking over the built-in
 * present row on the tool.call.toolview keyed seat. Status and result text
 * keep parity with the shipped row; every settled .html deliverable gains a
 * live preview rendered in a script-sandboxed iframe sourced from the
 * session-authorized file bytes.
 */

import { useEffect, useRef, useState } from 'react'
import { presentModel, type PresentBlockLike, type PresentCallState, type PresentFileArg } from './present-model.ts'
import css from './HtmlPresentCard.module.css'

export type HtmlTranslate = (key: string, params?: Readonly<Record<string, string | number>>) => string

/** Files beyond this size stay unrendered; the row hints instead of freezing the transcript. */
const MAX_INLINE_BYTES = 1_000_000

/** Session-authorized byte reader, supplied by the plugin's inject face. */
export type HtmlFileReader = (sessionId: string, path: string, signal?: AbortSignal) => Promise<Uint8Array>

export interface HtmlPresentCardProps {
  /** Tool call identity, stable across running and settled forms. */
  readonly callId: string
  /** Session identity for the authorized file reader. */
  readonly sessionId: string
  /** Frozen running call or settled result node. */
  readonly block: PresentBlockLike
  /** Inspect this call in the trajectory view when available. */
  readonly inspect?: (() => void) | undefined
  /** Translator seat the locale service injects for the registration namespace. */
  readonly t: HtmlTranslate
  /** Read one presented file's bytes through the session-authorized route. */
  readonly readFile: HtmlFileReader
}

type PreviewPhase = 'idle' | 'loading' | 'ready' | 'error' | 'tooLarge'

/** One .html deliverable: collapsed by default (the first expands), fetched once. */
function HtmlPreviewSection({ sessionId, file, readFile, t, defaultOpen }: {
  sessionId: string
  file: PresentFileArg
  readFile: HtmlFileReader
  t: HtmlTranslate
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [phase, setPhase] = useState<PreviewPhase>(defaultOpen ? 'loading' : 'idle')
  const [html, setHtml] = useState('')
  const requestedRef = useRef(false)

  useEffect(() => {
    if (!open || requestedRef.current) return
    requestedRef.current = true
    const controller = new AbortController()
    setPhase('loading')
    readFile(sessionId, file.path, controller.signal).then(
      bytes => {
        if (bytes.byteLength > MAX_INLINE_BYTES) {
          setPhase('tooLarge')
          return
        }
        setHtml(new TextDecoder().decode(bytes))
        setPhase('ready')
      },
      () => {
        if (!controller.signal.aborted) setPhase('error')
      },
    )
    return () => controller.abort()
  }, [open, readFile, sessionId, file.path])

  /** Open the rendered document from the parent context; the sandbox never gets popups. */
  const openTab = (): void => {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <section className={css.preview} data-path={file.path} data-phase={phase}>
      <header className={css.previewHeader}>
        <span className={css.previewPath}>{file.path}</span>
        <span className={css.previewActions}>
          {open ? (
            <button type="button" className={css.previewButton} onClick={() => { setOpen(false) }}>
              {t('preview.collapse')}
            </button>
          ) : (
            <button type="button" className={css.previewButton} onClick={() => { setOpen(true) }}>
              {t('preview.expand')}
            </button>
          )}
          {phase === 'ready' && (
            <button type="button" className={css.previewButton} onClick={openTab}>
              {t('preview.openTab')}
            </button>
          )}
        </span>
      </header>
      {phase === 'loading' && <p className={css.previewNote}>{t('preview.loading')}</p>}
      {phase === 'error' && <p className={css.previewNote}>{t('preview.error')}</p>}
      {phase === 'tooLarge' && <p className={css.previewNote}>{t('preview.tooLarge')}</p>}
      {phase === 'ready' && (
        <iframe
          className={css.frame}
          sandbox="allow-scripts"
          srcDoc={html}
          title={t('preview.frameLabel', { path: file.path })}
          referrerPolicy="no-referrer"
        />
      )}
    </section>
  )
}

const DOT_STATE: Record<PresentCallState, string> = {
  running: 'ongoing',
  ok: 'done',
  error: 'error',
  stopped: 'warning',
}

/**
 * Render one present call using its recorded arguments and result.
 * @param props - tool seat currency plus the injected file reader.
 * @returns a status row whose html deliverables render inline.
 */
export function HtmlPresentCard({ sessionId, block, inspect, t, readFile }: HtmlPresentCardProps) {
  const model = presentModel(block)
  const expandable = model.details !== '' || model.htmlFiles.length > 0
  const [expanded, setExpanded] = useState(model.state === 'ok' && model.htmlFiles.length > 0)
  const pathsText = model.files.map(file => file.path).join(', ')
  return (
    <div data-tool="present" data-state={model.state} className={css.card}>
      <button
        type="button"
        className={css.row}
        aria-expanded={expandable ? expanded : undefined}
        onClick={() => {
          if (expandable) setExpanded(value => !value)
        }}
      >
        <span className={css.dot} data-state={DOT_STATE[model.state]} aria-hidden="true" />
        <span className={css.title}>{t('row.title')}</span>
        <span className={css.state}>{t(`row.${model.state}`)}</span>
        {pathsText !== '' && <span className={css.paths}>{pathsText}</span>}
      </button>
      {expanded && (
        <div className={css.content}>
          {model.details !== '' && <pre className={css.output}>{model.details}</pre>}
          {inspect && (
            <button type="button" className={css.inspect} onClick={inspect}>
              {t('row.inspect')}
            </button>
          )}
          {model.htmlFiles.map((file, index) => (
            <HtmlPreviewSection
              key={file.path}
              sessionId={sessionId}
              file={file}
              readFile={readFile}
              t={t}
              defaultOpen={index === 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}
