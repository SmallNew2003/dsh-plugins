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

type PreviewPhase = 'loading' | 'ready' | 'error' | 'tooLarge'
const HEIGHT_MESSAGE = 'dsh-html-preview-height'

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Append a sandbox-local reporter so the parent can show the full document without same-origin access. */
function withHeightReporter(html: string): string {
  const reporter = `<script>(()=>{const report=()=>{const root=document.documentElement,body=document.body;const height=Math.ceil(Math.max(root?.scrollHeight??0,root?.offsetHeight??0,body?.scrollHeight??0,body?.offsetHeight??0));parent.postMessage({type:'${HEIGHT_MESSAGE}',height},'*')};addEventListener('load',()=>{report();new ResizeObserver(report).observe(document.documentElement)},{once:true});setTimeout(report,0)})()</script>`
  return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, reporter + '</body>') : html + reporter
}

/** Rasterize static HTML through an SVG foreignObject without relaxing iframe isolation. */
async function saveHtmlAsImage(html: string, name: string, width: number, height: number): Promise<void> {
  const source = new DOMParser().parseFromString(html, 'text/html')
  const css = Array.from(source.head.querySelectorAll('style')).map(style => style.textContent ?? '').join('\n')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${source.body.innerHTML}</div></foreignObject></svg>`
  const imageUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image()
      next.onload = () => resolve(next)
      next.onerror = () => reject(new Error('image-render-failed'))
      next.src = imageUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('canvas-unavailable')
    context.drawImage(image, 0, 0, width, height)
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob === null ? reject(new Error('png-encode-failed')) : resolve(blob), 'image/png')
    })
    downloadBlob(png, fileName(name).replace(/\.html?$/i, '') + '.png')
  } finally {
    URL.revokeObjectURL(imageUrl)
  }
}

/** One .html deliverable rendered as a quiet conversation artifact. */
function HtmlPreviewSection({ sessionId, file, readFile, t, inspect }: {
  sessionId: string
  file: PresentFileArg
  readFile: HtmlFileReader
  t: HtmlTranslate
  inspect?: (() => void) | undefined
}) {
  const [phase, setPhase] = useState<PreviewPhase>('loading')
  const [html, setHtml] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [frameHeight, setFrameHeight] = useState(480)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (loadedRef.current) return
    const controller = new AbortController()
    setPhase('loading')
    readFile(sessionId, file.path, controller.signal).then(
      bytes => {
        if (controller.signal.aborted) return
        if (bytes.byteLength > MAX_INLINE_BYTES) {
          loadedRef.current = true
          setPhase('tooLarge')
          return
        }
        setHtml(new TextDecoder().decode(bytes))
        loadedRef.current = true
        setPhase('ready')
      },
      () => {
        if (!controller.signal.aborted) setPhase('error')
      },
    )
    return () => controller.abort()
  }, [readFile, sessionId, file.path])

  useEffect(() => {
    const receiveHeight = (event: MessageEvent<unknown>): void => {
      if (event.source !== frameRef.current?.contentWindow || typeof event.data !== 'object' || event.data === null) return
      const payload = event.data as { type?: unknown; height?: unknown }
      if (payload.type !== HEIGHT_MESSAGE || typeof payload.height !== 'number' || !Number.isFinite(payload.height) || payload.height < 1) return
      setFrameHeight(Math.ceil(payload.height))
    }
    window.addEventListener('message', receiveHeight)
    return () => window.removeEventListener('message', receiveHeight)
  }, [])

  const download = (): void => {
    downloadBlob(new Blob([html], { type: 'text/html' }), fileName(file.path))
    setMenuOpen(false)
  }

  const copyCode = (): void => {
    void navigator.clipboard?.writeText(html)
    setMenuOpen(false)
  }

  const saveImage = (): void => {
    const frame = frameRef.current
    const width = Math.max(frame?.clientWidth ?? 0, 960)
    const height = Math.max(frame?.clientHeight ?? 0, 540)
    setMenuOpen(false)
    setImageError(false)
    void saveHtmlAsImage(html, file.path, width, height).catch(() => setImageError(true))
  }

  return (
    <section className={css.preview} data-path={file.path} data-phase={phase}>
      <div className={css.artifactTitle}>{fileName(file.path)}</div>
      {phase === 'ready' && (
        <span className={css.moreWrap}>
          <button
            type="button"
            className={css.moreButton}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('preview.more')}
            onClick={() => setMenuOpen(open => !open)}
          >
            •••
          </button>
          {menuOpen && (
            <div className={css.menu} role="menu">
              <button type="button" role="menuitem" onClick={download}>{t('preview.download')}</button>
              <button type="button" role="menuitem" onClick={saveImage}>{t('preview.saveImage')}</button>
              <button type="button" role="menuitem" onClick={copyCode}>{t('preview.copyCode')}</button>
              <button type="button" role="menuitem" onClick={() => { setSourceOpen(open => !open); setMenuOpen(false) }}>
                {sourceOpen ? t('preview.hideCode') : t('preview.viewCode')}
              </button>
              {inspect && <><span className={css.menuDivider} /><button type="button" role="menuitem" onClick={() => { inspect(); setMenuOpen(false) }}>{t('row.inspect')}</button></>}
            </div>
          )}
        </span>
      )}
      {phase === 'loading' && <p className={css.previewNote}>{t('preview.loading')}</p>}
      {phase === 'error' && <p className={css.previewNote}>{t('preview.error')}</p>}
      {phase === 'tooLarge' && <p className={css.previewNote}>{t('preview.tooLarge')}</p>}
      {imageError && <p className={css.previewNote}>{t('preview.saveImageError')}</p>}
      {phase === 'ready' && (
        <>
          <iframe
            ref={frameRef}
            className={css.frame}
            sandbox="allow-scripts"
            srcDoc={withHeightReporter(html)}
            title={t('preview.frameLabel', { path: file.path })}
            referrerPolicy="no-referrer"
            style={{ height: frameHeight + 'px' }}
          />
          {sourceOpen && <pre className={css.source}>{html}</pre>}
        </>
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
  const showDetails = model.details !== '' && model.state !== 'ok'
  const showArtifacts = model.state === 'ok' && model.htmlFiles.length > 0
  const showContent = showDetails || showArtifacts
  const nativeArtifact = showArtifacts && !showDetails
  const nonHtmlPaths = model.htmlFiles.length === 0 ? model.files.map(file => fileName(file.path)).join(', ') : ''
  return (
    <div
      data-tool="present"
      data-state={model.state}
      data-native-artifact={nativeArtifact || undefined}
      className={css.card}
    >
      {!nativeArtifact && (
        <div className={css.row}>
          <span className={css.dot} data-state={DOT_STATE[model.state]} aria-hidden="true" />
          <span className={css.title}>{t('row.title')}</span>
          <span className={css.state}>{t(`row.${model.state}`)}</span>
          {nonHtmlPaths !== '' && <span className={css.paths}>{nonHtmlPaths}</span>}
        </div>
      )}
      {showContent && (
        <div className={nativeArtifact ? css.artifactContent : css.content}>
          {showDetails && <pre className={css.output}>{model.details}</pre>}
          {showArtifacts && model.htmlFiles.map(file => (
            <HtmlPreviewSection
              key={file.path}
              sessionId={sessionId}
              file={file}
              readFile={readFile}
              t={t}
              inspect={inspect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
