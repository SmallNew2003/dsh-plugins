import { describe, expect, it } from 'vitest'
import { presentModel } from '../src/client/present-model.ts'

const argsJson = (files: unknown[]): string => JSON.stringify({ files })

describe('presentModel', () => {
  it('classifies a running call and still parses declared files', () => {
    const model = presentModel({ argsRaw: argsJson([{ path: 'diagram.html' }, { path: 'logo.png' }]) })
    expect(model.state).toBe('running')
    expect(model.files).toEqual([{ path: 'diagram.html' }, { path: 'logo.png' }])
    expect(model.htmlFiles).toEqual([{ path: 'diagram.html' }])
    expect(model.output).toBe('')
  })

  it('classifies a settled successful call and keeps only html files for preview', () => {
    const block = {
      kind: 'result',
      call: { argsRaw: argsJson([{ path: 'diagram.html' }, { path: 'logo.png' }]) },
      content: [{ type: 'text', text: 'Saved 2 files.' }],
      isError: false,
    }
    const model = presentModel(block)
    expect(model.state).toBe('ok')
    expect(model.htmlFiles).toEqual([{ path: 'diagram.html' }])
    expect(model.output).toBe('Saved 2 files.')
    expect(model.details).toBe('Saved 2 files.')
  })

  it('marks a call interrupted by the user as stopped', () => {
    const block = { kind: 'result', error: { name: 'Error', code: 'interrupted' } }
    expect(presentModel(block).state).toBe('stopped')
  })

  it('marks a failed call as error and reports the error detail', () => {
    const block = {
      kind: 'result',
      isError: true,
      error: { name: 'PresentError', code: 'io' },
    }
    const model = presentModel(block)
    expect(model.state).toBe('error')
    expect(model.details).toBe('PresentError: io')
  })

  it('survives malformed args JSON without throwing', () => {
    const model = presentModel({ kind: 'result', argsRaw: 'not json {', isError: false })
    expect(model.state).toBe('ok')
    expect(model.files).toEqual([])
    expect(model.htmlFiles).toEqual([])
  })

  it('drops entries without a usable string path', () => {
    const model = presentModel({
      argsRaw: argsJson([42, { path: 5 }, { description: 'no path' }, { path: 'x.html' }]),
    })
    expect(model.files).toEqual([{ path: 'x.html' }])
  })

  it('matches the html extension case-insensitively, including .htm', () => {
    const model = presentModel({
      argsRaw: argsJson([
        { path: 'DIAGRAM.HTML' },
        { path: 'page.HtMl' },
        { path: 'legacy.htm' },
        { path: 'notes.html.bak' },
        { path: 'x.htmlpng' },
      ]),
    })
    expect(model.htmlFiles.map(file => file.path)).toEqual(['DIAGRAM.HTML', 'page.HtMl', 'legacy.htm'])
  })

  it('falls back to the top-level argsRaw when a settled call lacks call.argsRaw', () => {
    const model = presentModel({
      kind: 'result',
      argsRaw: argsJson([{ path: 'diagram.html' }]),
      isError: false,
    })
    expect(model.htmlFiles).toEqual([{ path: 'diagram.html' }])
  })
})
