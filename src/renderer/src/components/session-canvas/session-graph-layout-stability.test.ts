import { describe, expect, it } from 'vitest'
import { buildSessionGraph, collectGraphPositions } from './session-graph-model'
import { SESSION_CARD_WIDTH } from './session-layout-model'
import { WT_C, makeEntry, makeInputs } from './session-graph-test-fixtures'

function positionOf(graph: ReturnType<typeof buildSessionGraph>, id: string) {
  return graph.nodes.find((node) => node.id === id)?.position
}

describe('buildSessionGraph layout stability', () => {
  it('keeps an auto-placed card in its cell when an earlier session disappears', () => {
    const first = buildSessionGraph(makeInputs({ liveEntries: [makeEntry('a'), makeEntry('b')] }))
    const second = buildSessionGraph(
      makeInputs({ liveEntries: [makeEntry('b')], previousPositions: collectGraphPositions(first) })
    )
    expect(positionOf(second, 'live:b')).toEqual(positionOf(first, 'live:b'))
  })

  it('keeps a card still when an earlier session is filtered out', () => {
    const liveEntries = [
      makeEntry('a', { terminalTitle: 'alpha' }),
      makeEntry('b', { terminalTitle: 'beta' })
    ]
    const first = buildSessionGraph(makeInputs({ liveEntries }))
    const base = makeInputs({ liveEntries, previousPositions: collectGraphPositions(first) })
    const filtered = buildSessionGraph({ ...base, filters: { ...base.filters, query: 'beta' } })
    expect(positionOf(filtered, 'live:b')).toEqual(positionOf(first, 'live:b'))
  })

  it('does not shift later groups when an earlier group grows', () => {
    const first = buildSessionGraph(
      makeInputs({ liveEntries: [makeEntry('a'), makeEntry('c', { worktreeId: WT_C })] })
    )
    const grown = buildSessionGraph(
      makeInputs({
        liveEntries: [
          makeEntry('a'),
          makeEntry('a2'),
          makeEntry('a3'),
          makeEntry('c', { worktreeId: WT_C })
        ],
        previousPositions: collectGraphPositions(first)
      })
    )
    expect(positionOf(grown, 'group:repo-2')).toEqual(positionOf(first, 'group:repo-2'))
    expect(positionOf(grown, 'live:c')).toEqual(positionOf(first, 'live:c'))
  })

  it('places a new group right of a dragged group instead of over it', () => {
    const graph = buildSessionGraph(
      makeInputs({
        liveEntries: [makeEntry('a'), makeEntry('c', { worktreeId: WT_C })],
        savedPositions: { 'group:repo-2': { x: 0, y: 0 } }
      })
    )
    const saved = graph.nodes.find((node) => node.id === 'group:repo-2')
    const placed = graph.nodes.find((node) => node.id === 'group:repo-1')
    expect(placed?.position.x).toBeGreaterThanOrEqual((saved?.width ?? 0) + SESSION_CARD_WIDTH / 4)
  })

  it('clamps cards dragged to negative coordinates into their group', () => {
    const graph = buildSessionGraph(
      makeInputs({
        liveEntries: [makeEntry('a')],
        savedPositions: { 'live:a': { x: -120, y: -40 } }
      })
    )
    expect(positionOf(graph, 'live:a')).toEqual({ x: 0, y: 0 })
  })
})
