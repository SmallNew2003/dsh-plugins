// @vitest-environment jsdom

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

  it('starts later html files collapsed and renders them on demand', async () => {
    const readFile = vi.fn((_sessionId: string, path: string) =>
      Promise.resolve(bytesOf('<p>' + path + '</p>')),
    )
    const { container } = render(
      <HtmlPresentCard {...htmlProps(okBlock([{ path: 'a.html' }, { path: 'b.html' }]), readFile)} />,
    )
    await waitFor(() => expect(container.querySelectorAll('iframe')).toHaveLength(1))
    expect(container.querySelector('iframe')!.getAttribute('srcdoc')).toContain('<p>a.html</p>')
    fireEvent.click(screen.getByRole('button', { name: zh['preview.expand'] }))
    await waitFor(() => expect(container.querySelectorAll('iframe')).toHaveLength(2))
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

  it('opens the rendered document in a new tab from the parent context', async () => {
    const readFile = vi.fn(() => Promise.resolve(bytesOf('<p>tab body</p>')))
    const { container } = render(
      <HtmlPresentCard {...htmlProps(okBlock([{ path: 'diagram.html' }]), readFile)} />,
    )
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull())
    const opened = vi.fn()
    vi.spyOn(window, 'open').mockImplementation(opened as unknown as typeof window.open)
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:rendered'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: zh['preview.openTab'] }))
    expect(opened).toHaveBeenCalledWith('blob:rendered', '_blank', 'noopener')
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
