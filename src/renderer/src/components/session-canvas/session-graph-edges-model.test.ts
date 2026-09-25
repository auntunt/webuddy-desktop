import { describe, expect, it } from 'vitest'
import { buildSessionGraph } from './session-graph-model'
import {
  NOW,
  WT_B,
  WT_C,
  makeEntry,
  makeExternal,
  makeInputs,
  makeMessage
} from './session-graph-test-fixtures'

function edgesOf(inputs: ReturnType<typeof makeInputs>) {
  return buildSessionGraph(inputs).edges
}

describe('started edges', () => {
  it('links a parent pane to the pane it started (parentPaneKey)', () => {
    const edges = edgesOf(
      makeInputs({
        liveEntries: [
          makeEntry('parent'),
          makeEntry('child', {
            orchestration: { taskId: 't', dispatchId: 'd', parentPaneKey: 'parent' }
          })
        ]
      })
    )
    expect(edges).toEqual([
      {
        id: 'started:live:parent->live:child',
        source: 'live:parent',
        target: 'live:child',
        kind: 'started',
        animated: false
      }
    ])
  })

  it('resolves the coordinator handle to its pane', () => {
    const edges = edgesOf(
      makeInputs({
        liveEntries: [
          makeEntry('coord', { terminalHandle: 'term_1' }),
          makeEntry('worker', {
            orchestration: { taskId: 't', dispatchId: 'd', coordinatorHandle: 'term_1' }
          })
        ]
      })
    )
    expect(edges.map((edge) => edge.id)).toEqual(['started:live:coord->live:worker'])
  })

  it('drops edges whose parent is not on the canvas', () => {
    const edges = edgesOf(
      makeInputs({
        liveEntries: [
          makeEntry('parent', { terminalTitle: 'hidden' }),
          makeEntry('child', {
            terminalTitle: 'shown',
            orchestration: { taskId: 't', dispatchId: 'd', parentPaneKey: 'parent' }
          })
        ],
        filters: {
          query: 'shown',
          agents: [],
          states: [],
          projects: [],
          showExternal: true,
          hideIdleOlderThanMs: null
        }
      })
    )
    expect(edges).toEqual([])
  })
})

describe('messaged edges', () => {
  const liveEntries = [
    makeEntry('a', { terminalHandle: 'term_a' }),
    makeEntry('b', { terminalHandle: 'term_b' })
  ]

  it('merges messages per direction and animates when the latest is within 10 minutes', () => {
    const edges = edgesOf(
      makeInputs({
        liveEntries,
        messages: [
          makeMessage({ fromHandle: 'term_a', toHandle: 'term_b', at: NOW - 60 * 60_000 }),
          makeMessage({
            fromPaneKey: 'a',
            toPaneKey: 'b',
            kind: 'pass-along',
            at: NOW - 5 * 60_000
          }),
          makeMessage({ fromHandle: 'term_b', toHandle: 'term_a', at: NOW - 11 * 60_000 })
        ]
      })
    )
    expect(edges).toEqual([
      {
        id: 'messaged:live:a->live:b',
        source: 'live:a',
        target: 'live:b',
        kind: 'messaged',
        animated: true
      },
      {
        id: 'messaged:live:b->live:a',
        source: 'live:b',
        target: 'live:a',
        kind: 'messaged',
        animated: false
      }
    ])
  })

  it('drops messages with unresolved or off-canvas endpoints and self messages', () => {
    const edges = edgesOf(
      makeInputs({
        liveEntries,
        messages: [
          makeMessage({ fromHandle: 'term_a', toHandle: 'term_gone' }),
          makeMessage({ fromPaneKey: 'a', toPaneKey: 'a' }),
          makeMessage({ fromHandle: null, toPaneKey: 'b' })
        ]
      })
    )
    expect(edges).toEqual([])
  })
})

describe('same-file edges', () => {
  it('links sessions in the same repo whose changed files intersect', () => {
    const edges = edgesOf(
      makeInputs({
        liveEntries: [
          makeEntry('a'),
          makeEntry('b', { worktreeId: WT_B }),
          makeEntry('c', { worktreeId: WT_C })
        ],
        externalSessions: [makeExternal('e1', { cwd: '/work/app' })],
        changedFilesByWorktree: {
          'repo-1::/work/app': ['src/x.ts', 'src/y.ts'],
          [WT_B]: ['src/y.ts', 'src/z.ts'],
          [WT_C]: ['src/y.ts']
        }
      })
    )
    expect(edges).toEqual([
      {
        id: 'same-file:live:a|live:b',
        source: 'live:a',
        target: 'live:b',
        kind: 'same-file',
        animated: false,
        files: ['src/y.ts']
      }
    ])
  })

  it('caps the shared file list at 20', () => {
    const files = Array.from({ length: 30 }, (_, index) => `f${index}.ts`)
    const edges = edgesOf(
      makeInputs({
        liveEntries: [makeEntry('a'), makeEntry('b', { worktreeId: WT_B })],
        changedFilesByWorktree: { 'repo-1::/work/app': files, [WT_B]: files }
      })
    )
    expect(edges[0].files).toEqual(files.slice(0, 20))
  })

  it('skips pairs with no shared files', () => {
    const edges = edgesOf(
      makeInputs({
        liveEntries: [makeEntry('a'), makeEntry('b', { worktreeId: WT_B })],
        changedFilesByWorktree: { 'repo-1::/work/app': ['x'], [WT_B]: ['y'] }
      })
    )
    expect(edges).toEqual([])
  })
})
