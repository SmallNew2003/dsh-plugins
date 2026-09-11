/** memoryCardModel: tool-name classification and call/result shaping. */

import { describe, expect, it } from 'vitest'
import { ENGRAM_TOOLS, memoryCardModel, type MemoryBlockInput } from '../src/client/memory-model.ts'

/** A running call over the given args JSON. */
function running(args: Record<string, unknown>): MemoryBlockInput {
  return { argsRaw: JSON.stringify(args) }
}

/** A settled result over the given args and result text blocks. */
function settled(args: Record<string, unknown>, text: string, isError = false): MemoryBlockInput {
  return { kind: 'tool-result', argsRaw: JSON.stringify(args), content: [{ type: 'text', text }], isError }
}

describe('registry', () => {
  it('covers every engram agent-profile tool name', () => {
    expect(ENGRAM_TOOLS).toContain('mem_save')
    expect(ENGRAM_TOOLS).toContain('mem_search')
    expect(ENGRAM_TOOLS).toContain('mem_session_summary')
    expect(ENGRAM_TOOLS).toContain('mem_unpin')
    // 18 agent tools observed from engram 1.20.0 tools/list.
    expect(ENGRAM_TOOLS).toHaveLength(18)
    expect(new Set(ENGRAM_TOOLS).size).toBe(ENGRAM_TOOLS.length)
  })
})

describe('classification', () => {
  it('classifies write, read, and plain tools', () => {
    expect(memoryCardModel('mem_save', running({})).kind).toBe('write')
    expect(memoryCardModel('mem_update', running({})).kind).toBe('write')
    expect(memoryCardModel('mem_capture_passive', running({})).kind).toBe('write')
    expect(memoryCardModel('mem_search', running({})).kind).toBe('read')
    expect(memoryCardModel('mem_context', running({})).kind).toBe('read')
    expect(memoryCardModel('mem_get_observation', running({})).kind).toBe('read')
    expect(memoryCardModel('mem_stats', running({})).kind).toBe('plain')
    expect(memoryCardModel('mem_judge', running({})).kind).toBe('plain')
  })

  it('classifies an unlisted tool as plain fallback', () => {
    const model = memoryCardModel('mem_something_new', running({}))
    expect(model.kind).toBe('plain')
    expect(model.actionKey).toBe('card.action.fallback')
  })

  it('maps the wire MCP name to the raw engram tool', () => {
    const model = memoryCardModel('mcp__engram__mem_save', running({ title: 'T' }))
    expect(model.actionKey).toBe('card.action.mem_save')
    expect(model.kind).toBe('write')
  })
})

describe('running calls', () => {
  it('marks running and extracts the save title', () => {
    const model = memoryCardModel('mem_save', running({ title: 'JWT auth middleware', content: 'c' }))
    expect(model.running).toBe(true)
    expect(model.headline).toBe('JWT auth middleware')
    expect(model.detail).toBe('c')
    expect(model.payload).toBeNull()
    expect(model.isError).toBe(false)
  })

  it('falls back to a content preview when the save has no title', () => {
    const model = memoryCardModel('mem_save', running({ content: 'x'.repeat(200) }))
    expect(model.headline).toHaveLength(120)
    expect(model.detail).toBeNull()
  })

  it('extracts the search query', () => {
    expect(memoryCardModel('mem_search', running({ query: 'jwt refresh' })).headline).toBe('jwt refresh')
  })

  it('extracts the observation id', () => {
    expect(memoryCardModel('mem_get_observation', running({ id: 'obs-9' })).headline).toBe('obs-9')
  })

  it('leaves the headline empty for argumentless tools', () => {
    expect(memoryCardModel('mem_context', running({})).headline).toBeNull()
  })
})

describe('settled results', () => {
  it('parses an array result into a hit count and preview', () => {
    const result = JSON.stringify([
      { id: 'a', title: 'one', content: 'first' },
      { id: 'b', title: 'two', content: 'second' },
    ])
    const model = memoryCardModel('mem_search', settled({ query: 'jwt' }, result))
    expect(model.running).toBe(false)
    expect(model.count).toBe(2)
    expect(model.detail).toContain('one')
    expect(model.payload).toBe(result)
  })

  it('counts an observations array inside an object result', () => {
    const result = JSON.stringify({ observations: [{}, {}, {}], project: 'dsh' })
    expect(memoryCardModel('mem_search', settled({ query: 'q' }, result)).count).toBe(3)
  })

  it('counts a results array inside an object result', () => {
    const result = JSON.stringify({ results: [{}] })
    expect(memoryCardModel('mem_context', settled({}, result)).count).toBe(1)
  })

  it('keeps the raw text as payload when the result is not JSON', () => {
    const model = memoryCardModel('mem_save', settled({ title: 'T' }, 'Saved observation obs-1'))
    expect(model.count).toBeNull()
    expect(model.payload).toBe('Saved observation obs-1')
    expect(model.detail).toBe('Saved observation obs-1')
  })

  it('joins multiple text blocks', () => {
    const block: MemoryBlockInput = {
      kind: 'tool-result',
      argsRaw: '{}',
      content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
    }
    expect(memoryCardModel('mem_save', block).payload).toBe('a\nb')
  })

  it('propagates the error flag and skips detail shaping', () => {
    const model = memoryCardModel('mem_save', settled({ title: 'T' }, 'boom', true))
    expect(model.isError).toBe(true)
    expect(model.detail).toBeNull()
    expect(model.payload).toBe('boom')
  })

  it('keeps the settled call headline from the args', () => {
    expect(memoryCardModel('mem_search', settled({ query: 'q' }, '[]')).headline).toBe('q')
  })

  it('survives malformed args and malformed result JSON', () => {
    const model = memoryCardModel('mem_save', {
      kind: 'tool-result',
      argsRaw: '{not json',
      content: [{ type: 'text', text: '{also not' }],
    })
    expect(model.kind).toBe('write')
    expect(model.headline).toBeNull()
    expect(model.count).toBeNull()
    expect(model.payload).toBe('{also not')
  })

  it('renders a settled argumentless call without detail', () => {
    const model = memoryCardModel('mem_stats', { kind: 'tool-result', argsRaw: '{}' })
    expect(model.detail).toBeNull()
    expect(model.payload).toBeNull()
    expect(model.count).toBeNull()
  })
})
