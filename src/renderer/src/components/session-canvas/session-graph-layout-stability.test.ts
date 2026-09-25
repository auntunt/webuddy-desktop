import { describe, expect, it } from 'vitest'
import { buildSessionGraph, collectGraphPositions } from './session-graph-model'
import { SESSION_CARD_HEIGHT, SESSION_CARD_WIDTH } from './session-layout-model'
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

  it('keeps a card dragged above/left of its group origin where the user put it', () => {
    const inputs = makeInputs({
      liveEntries: [makeEntry('a'), makeEntry('b')],
      savedPositions: {
        'group:repo-1': { x: 1000, y: 500 },
        'live:a': { x: -120, y: -40 },
        'live:b': { x: 200, y: 100 }
      }
    })
    const graph = buildSessionGraph(inputs)
    const group = graph.nodes.find((node) => node.id === 'group:repo-1')
    const absolute = (id: string) => {
      const relative = positionOf(graph, id)
      return {
        x: (group?.position.x ?? 0) + (relative?.x ?? 0),
        y: (group?.position.y ?? 0) + (relative?.y ?? 0)
      }
    }
    expect(absolute('live:a')).toEqual({ x: 880, y: 460 })
    expect(absolute('live:b')).toEqual({ x: 1200, y: 600 })
    for (const id of ['live:a', 'live:b']) {
      const relative = positionOf(graph, id)
      expect(relative?.x).toBeGreaterThanOrEqual(0)
      expect(relative?.y).toBeGreaterThanOrEqual(0)
      expect((relative?.x ?? 0) + SESSION_CARD_WIDTH).toBeLessThanOrEqual(group?.width ?? 0)
      expect((relative?.y ?? 0) + SESSION_CARD_HEIGHT).toBeLessThanOrEqual(group?.height ?? 0)
    }
    expect(inputs.savedPositions['live:a']).toEqual({ x: -120, y: -40 })
    // Feeding the rendered output back must not drift the group or the card.
    const again = buildSessionGraph({ ...inputs, previousPositions: collectGraphPositions(graph) })
    expect(again.nodes).toEqual(graph.nodes)
    expect(collectGraphPositions(graph)['group:repo-1']).toEqual({ x: 1000, y: 500 })
    expect(collectGraphPositions(graph)['live:a']).toEqual({ x: -120, y: -40 })
  })
})
