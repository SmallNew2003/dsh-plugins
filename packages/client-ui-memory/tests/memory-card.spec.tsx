// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryToolCard, type MemoryToolCardProps } from '../src/client/MemoryToolCard.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** A translator bound to the zh dictionary with {x} interpolation. */
function makeT() {
  return (key: string, params?: Record<string, string | number>): string => {
    const template = zh[key as keyof typeof zh] ?? key
    return template.replace(/\{([a-zA-Z]+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))
  }
}

const t = makeT()

/** Owner props of one settled call, shaped as the tool seat delivers them. */
function settledProps(toolName: string, args: Record<string, unknown>, resultText: string, isError = false): MemoryToolCardProps {
  return {
    callId: 'call-1',
    toolName,
    block: {
      kind: 'tool-result',
      seq: 1,
      time: 0,
      callId: 'call-1',
      call: { name: toolName, argsRaw: JSON.stringify(args) },
      callTime: null,
      content: [{ type: 'text', text: resultText }],
      isError,
      subCalls: [],
    },
    t,
  }
}

describe('glance row', () => {
  it('renders the action label and headline of a save', () => {
    render(<MemoryToolCard {...settledProps('mcp__engram__mem_save', { title: 'JWT auth', content: 'uses refresh rotation' }, '{"id":"obs-1"}')} />)
    expect(screen.getByText(t('card.action.mem_save'))).toBeTruthy()
    expect(screen.getByText('JWT auth')).toBeTruthy()
    expect(screen.getByText('uses refresh rotation')).toBeTruthy()
  })

  it('renders a search with its query and hit count', () => {
    const result = JSON.stringify([{ title: 'a' }, { title: 'b' }])
    render(<MemoryToolCard {...settledProps('mcp__engram__mem_search', { query: 'jwt refresh' }, result)} />)
    expect(screen.getByText(t('card.action.mem_search'))).toBeTruthy()
    expect(screen.getByText('jwt refresh')).toBeTruthy()
    expect(screen.getByText(t('card.count', { count: 2 }))).toBeTruthy()
  })

  it('renders a running write as in-flight', () => {
    render(<MemoryToolCard {...{
      callId: 'call-1',
      toolName: 'mcp__engram__mem_save',
      block: { callId: 'call-1', name: 'mem_save', argsRaw: JSON.stringify({ title: 'T', content: 'c' }), turn: 0, step: 0, time: 0, subCalls: [] },
      t,
    }} />)
    expect(screen.getByText(t('card.running'))).toBeTruthy()
    expect(screen.getByText('T')).toBeTruthy()
  })

  it('marks an error result with the error label', () => {
    render(<MemoryToolCard {...settledProps('mcp__engram__mem_save', { title: 'T' }, 'boom', true)} />)
    expect(screen.getByText(t('card.error'))).toBeTruthy()
  })
})

describe('expand toggle', () => {
  it('reveals the full result payload and collapses back', () => {
    const result = JSON.stringify([{ id: 'obs-1', title: 'one' }])
    const { container } = render(<MemoryToolCard {...settledProps('mcp__engram__mem_search', { query: 'q' }, result)} />)
    expect(container.querySelector('pre')).toBeNull()
    fireEvent.click(screen.getByText(t('card.expand')))
    expect(container.querySelector('pre')?.textContent).toBe(result)
    fireEvent.click(screen.getByText(t('card.collapse')))
    expect(container.querySelector('pre')).toBeNull()
  })

  it('renders the empty marker for a settled call without content', () => {
    render(<MemoryToolCard {...{
      callId: 'call-1',
      toolName: 'mcp__engram__mem_stats',
      block: {
        kind: 'tool-result', seq: 1, time: 0, callId: 'call-1',
        call: { name: 'mem_stats', argsRaw: '{}' }, callTime: null,
        content: [], isError: false, subCalls: [],
      },
      t,
    }} />)
    expect(screen.getByText(t('card.empty'))).toBeTruthy()
    expect(screen.queryByText(t('card.expand'))).toBeNull()
  })
})