import { describe, expect, it } from 'vitest'
import {
  EMPTY_SESSION_FLOW_LOCAL_STATE,
  applySessionFlowChanges,
  clearSessionFlowDrags,
  toFlowEdges,
  toFlowNodes
} from './session-canvas-flow-model'
import { selectGitStatusTargets } from './session-canvas-git-targets-model'
import { buildSessionGraph } from './session-graph-model'
import { WT_A, WT_B, WT_C, makeEntry, makeInputs } from './session-graph-test-fixtures'

const graph = buildSessionGraph(
  makeInputs({
    liveEntries: [
      makeEntry('a'),
      makeEntry('b', { orchestration: { taskId: 't', dispatchId: 'd', parentPaneKey: 'a' } })
    ]
  })
)

describe('toFlowNodes', () => {
  it('maps groups and cards, echoing measured sizes and in-flight drags', () => {
    const local = applySessionFlowChanges(EMPTY_SESSION_FLOW_LOCAL_STATE, [
      { id: 'live:a', type: 'dimensions', dimensions: { width: 320, height: 200 } },
      { id: 'live:a', type: 'position', position: { x: 5, y: 6 }, dragging: true }
    ])
    const nodes = toFlowNodes(graph, local)
    const group = nodes.find((node) => node.type === 'sessionGroup')
    expect(group?.width).toBeGreaterThan(0)
    expect(group?.dragHandle).toBe('.session-group-drag-handle')
    const card = nodes.find((node) => node.id === 'live:a')
    expect(card).toMatchObject({
      type: 'live',
      parentId: group?.id,
      position: { x: 5, y: 6 },
      measured: { width: 320, height: 200 },
      connectable: true
    })
  })

  it('returns the same local state when changes are no-ops', () => {
    const local = applySessionFlowChanges(EMPTY_SESSION_FLOW_LOCAL_STATE, [
      { id: 'live:a', type: 'select', selected: false }
    ])
    expect(local).toBe(EMPTY_SESSION_FLOW_LOCAL_STATE)
  })

  it('clears finished drags so the graph position wins again', () => {
    const dragged = applySessionFlowChanges(EMPTY_SESSION_FLOW_LOCAL_STATE, [
      { id: 'live:a', type: 'position', position: { x: 5, y: 6 } }
    ])
    const cleared = clearSessionFlowDrags(dragged, ['live:a'])
    const node = toFlowNodes(graph, cleared).find((candidate) => candidate.id === 'live:a')
    expect(node?.position).toEqual(graph.nodes.find((n) => n.id === 'live:a')?.position)
  })
})

describe('toFlowEdges', () => {
  it('puts an arrow only on started edges', () => {
    const edges = toFlowEdges(graph)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({
      type: 'session',
      source: 'live:a',
      target: 'live:b',
      data: { kind: 'started', files: [] }
    })
    expect(edges[0].markerEnd).toBeDefined()
  })
})

describe('selectGitStatusTargets', () => {
  it('keeps only repos with at least two live worktrees', () => {
    const entries = [
      makeEntry('a', { worktreeId: WT_A }),
      makeEntry('b', { worktreeId: WT_B }),
      makeEntry('c', { worktreeId: WT_C })
    ]
    expect(selectGitStatusTargets(entries, {})).toEqual([WT_A, WT_B].sort())
  })
})
