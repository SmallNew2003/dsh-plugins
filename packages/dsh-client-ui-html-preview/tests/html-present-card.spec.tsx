// @vitest-environment jsdom

import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HtmlPresentCard, type HtmlPresentCardProps } from '../src/client/HtmlPresentCard.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SESSION = 'sess-1'

/** A translator bound to the zh dictionary with {x} interpolation. */
function makeT() {
  return (key: string, params?: Record<string, string | number>): string => {
    const template = zh[key as keyof typeof zh] ?? key
    return template.replace(/\{([a-zA-Z]+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))
  }
}

const t = makeT()

const okBlock = (files: unknown[]) => ({
  kind: 'result',
  call: { argsRaw: JSON.stringify({ files }) },
  content: [{ type: 'text', text: 'Saved.' }],
  isError: false,
})

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

function htmlProps(
  block: unknown,
  readFile: HtmlPresentCardProps['readFile'],
  extra?: Partial<HtmlPresentCardProps>,
): HtmlPresentCardProps {
  return {
    callId: 'call-1',
    sessionId: SESSION,
    block: block as HtmlPresentCardProps['block'],
    inspect: undefined,
    t,
    readFile,
    ...extra,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('HtmlPresentCard', () => {
  it('shows no preview for a present call without html files', () => {
    const readFile = vi.fn()
    const { container } = render(<HtmlPresentCard {...htmlProps(okBlock([{ path: 'logo.png' }]), readFile)} />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
    expect(screen.getByText('logo.png')).toBeTruthy()
  })

  it('renders the first html file inline by default in a script-sandboxed frame', async () => {
    const readFile = vi.fn((_sessionId: string, path: string) =>
      Promise.resolve(bytesOf(path === 'diagram.html' ? '<p>diagram body</p>' : '')),
    )
    const { container } = render(
      <HtmlPresentCard {...htmlProps(okBlock([{ path: 'diagram.html' }, { path: 'logo.png' }]), readFile)} />,
    )
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    const iframe = container.querySelector('iframe')!
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(iframe.getAttribute('srcdoc')).toContain('<p>diagram body</p>')
    expect(readFile).toHaveBeenCalledWith(SESSION, 'diagram.html', expect.anything())
  })

  it('removes process chrome around a successful html artifact', async () => {
    const readFile = vi.fn(() => Promise.resolve(bytesOf('<p>artifact body</p>')))
    render(<HtmlPresentCard {...htmlProps(okBlock([{ path: 'diagram.html' }]), readFile)} />)

    await screen.findByTitle(zh['preview.frameLabel'].replace('{path}', 'diagram.html'))

    expect(screen.queryByText(zh['row.title'])).toBeNull()
    expect(screen.queryByText(zh['row.ok'])).toBeNull()
    expect(screen.getByText('diagram.html')).toBeTruthy()
    expect(document.querySelector('[data-native-artifact]')).toBeTruthy()
  })

  it('expands the frame to the reported document height without scaling', async () => {
    const { container } = render(
      <HtmlPresentCard {...htmlProps(okBlock([{ path: 'diagram.html' }]), () => Promise.resolve(bytesOf('<p>tall artifact</p>')))} />,
    )
    const iframe = await screen.findByTitle(zh['preview.frameLabel'].replace('{path}', 'diagram.html'))

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'dsh-html-preview-height', height: 960 },
      source: iframe.contentWindow,
    }))

    await waitFor(() => expect(container.querySelector('iframe')?.style.height).toBe('960px'))
  })

  it('retries the initial read after StrictMode aborts its first effect', async () => {
    const readFile = vi.fn(() => Promise.resolve(bytesOf('<p>strict mode</p>')))
    const { container } = render(
      <StrictMode>
        <HtmlPresentCard {...htmlProps(okBlock([{ path: 'diagram.html' }]), readFile)} />
      </StrictMode>,
    )
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain('strict mode')
  })

  it('renders every presented html artifact directly in the transcript', async () => {
    const readFile = vi.fn((_sessionId: string, path: string) =>
      Promise.resolve(bytesOf('<p>' + path + '</p>')),
    )
    const { container } = render(
      <HtmlPresentCard {...htmlProps(okBlock([{ path: 'a.html' }, { path: 'b.html' }]), readFile)} />,
    )
    await waitFor(() => expect(container.querySelectorAll('iframe')).toHaveLength(2))
    expect(container.querySelector('iframe')!.getAttribute('srcdoc')).toContain('<p>a.html</p>')
    expect(container.querySelectorAll('iframe')[1]?.getAttribute('srcdoc')).toContain('<p>b.html</p>')
  })

  it('shows an error note when the file read fails', async () => {
    const readFile = vi.fn(() => Promise.reject(new Error('disk gone')))
    render(<HtmlPresentCard {...htmlProps(okBlock([{ path: 'diagram.html' }]), readFile)} />)
    await screen.findByText(zh['preview.error'])
  })

  it('skips inline rendering for files beyond the inline size cap', async () => {
    const readFile = vi.fn(() => Promise.resolve(new Uint8Array(1_000_001)))
    const { container } = render(
      <HtmlPresentCard {...htmlProps(okBlock([{ path: 'huge.html' }]), readFile)} />,
    )
    await screen.findByText(zh['preview.tooLarge'])
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('exposes the WorkBuddy-style artifact commands from one overflow menu', async () => {
    const readFile = vi.fn(() => Promise.resolve(bytesOf('<p>tab body</p>')))
    render(
      <HtmlPresentCard {...htmlProps(okBlock([{ path: 'diagram.html' }]), readFile)} />,
    )
    await screen.findByTitle(zh['preview.frameLabel'].replace('{path}', 'diagram.html'))

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))

    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '下载' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '保存为图片' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '复制代码' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '查看代码' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '收起预览' })).toBeNull()
    expect(screen.queryByRole('button', { name: '在新标签打开' })).toBeNull()
  })

  it('copies the rendered HTML when the artifact command is selected', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<HtmlPresentCard {...htmlProps(okBlock([{ path: 'diagram.html' }]), () => Promise.resolve(bytesOf('<p>copy me</p>')))} />)
    await screen.findByTitle(zh['preview.frameLabel'].replace('{path}', 'diagram.html'))

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制代码' }))

    expect(writeText).toHaveBeenCalledWith('<p>copy me</p>')
  })

  it('shows source code inline when the artifact command is selected', async () => {
    render(<HtmlPresentCard {...htmlProps(okBlock([{ path: 'diagram.html' }]), () => Promise.resolve(bytesOf('<p>inspect me</p>')))} />)
    await screen.findByTitle(zh['preview.frameLabel'].replace('{path}', 'diagram.html'))

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '查看代码' }))

    expect(screen.getByText('<p>inspect me</p>')).toBeTruthy()
  })

  it('shows no preview while the call is still running', () => {
    const readFile = vi.fn()
    const { container } = render(
      <HtmlPresentCard
        {...htmlProps({ argsRaw: JSON.stringify({ files: [{ path: 'diagram.html' }] }) }, readFile)}
      />,
    )
    expect(container.querySelector('iframe')).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
    expect(screen.getByText(zh['row.running'])).toBeTruthy()
  })
})
