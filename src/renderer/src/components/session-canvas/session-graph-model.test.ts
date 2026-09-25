import { describe, expect, it } from 'vitest'
import { SESSION_CANVAS_OTHER_GROUP_ID, buildSessionGraph } from './session-graph-model'
import { SESSION_GROUP_PADDING } from './session-layout-model'
import { NOW, WT_C, makeEntry, makeExternal, makeInputs } from './session-graph-test-fixtures'

function nodeIds(inputs: ReturnType<typeof makeInputs>): string[] {
  return buildSessionGraph(inputs).nodes.map((node) => node.id)
}

describe('buildSessionGraph nodes and groups', () => {
  it('ids live, external and group nodes and emits groups before their children', () => {
    const graph = buildSessionGraph(
      makeInputs({
        liveEntries: [makeEntry('tab1:leaf1'), makeEntry('tab2:leaf2', { worktreeId: WT_C })],
        externalSessions: [makeExternal('e1', { cwd: null })]
      })
    )
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))
    expect(byId.get('live:tab1:leaf1')).toMatchObject({ type: 'live', parentId: 'group:repo-1' })
    expect(byId.get('live:tab2:leaf2')).toMatchObject({ type: 'live', parentId: 'group:repo-2' })
    expect(byId.get('ext:e1')).toMatchObject({
      type: 'external',
      parentId: SESSION_CANVAS_OTHER_GROUP_ID
    })
    expect(byId.get('group:repo-1')?.data).toEqual({ label: 'app' })
    expect(byId.get(SESSION_CANVAS_OTHER_GROUP_ID)?.data).toEqual({ label: '其他' })
    for (const [index, node] of graph.nodes.entries()) {
      if (node.parentId) {
        expect(graph.nodes.findIndex((n) => n.id === node.parentId)).toBeLessThan(index)
      }
    }
  })

  it('puts live sessions without a worktree into the other group', () => {
    const graph = buildSessionGraph(
      makeInputs({ liveEntries: [makeEntry('p', { worktreeId: undefined })] })
    )
    const node = graph.nodes.find((n) => n.id === 'live:p')
    expect(node?.parentId).toBe(SESSION_CANVAS_OTHER_GROUP_ID)
    expect(node?.data).toMatchObject({ kind: 'live', repoLabel: null })
  })

  it('groups external sessions under a known worktree repo when cwd is inside it', () => {
    const graph = buildSessionGraph(
      makeInputs({ externalSessions: [makeExternal('e1', { cwd: '/work/lib/src' })] })
    )
    const node = graph.nodes.find((n) => n.id === 'ext:e1')
    expect(node?.parentId).toBe('group:repo-2')
    expect(node?.data).toMatchObject({ kind: 'external', repoLabel: 'lib' })
  })

  it('groups unknown external cwd by folder with a basename label', () => {
    const graph = buildSessionGraph(
      makeInputs({
        externalSessions: [
          makeExternal('e1', { cwd: '/elsewhere/tool' }),
          makeExternal('e2', { cwd: '/elsewhere/tool/' })
        ]
      })
    )
    const e1 = graph.nodes.find((n) => n.id === 'ext:e1')
    const e2 = graph.nodes.find((n) => n.id === 'ext:e2')
    expect(e1?.parentId).toBe('group:path:/elsewhere/tool')
    expect(e2?.parentId).toBe(e1?.parentId)
    expect(graph.nodes.find((n) => n.id === e1?.parentId)?.data).toEqual({ label: 'tool' })
  })
})

describe('buildSessionGraph external dedup', () => {
  it('drops an external session matching a live one by provider session id', () => {
    const live = makeEntry('p', {
      agentType: 'codex',
      providerSession: { key: 'session_id', id: 'sid-e1' }
    })
    expect(
      nodeIds(makeInputs({ liveEntries: [live], externalSessions: [makeExternal('e1')] }))
    ).not.toContain('ext:e1')
  })

  it('drops an external session matching a live one by transcript path', () => {
    const live = makeEntry('p', {
      agentType: 'claude-agent-teams',
      providerSession: { key: 'session_id', id: 'other', transcriptPath: '/t/e1.jsonl' }
    })
    const external = makeExternal('e1', { agent: 'claude', filePath: '/t/e1.jsonl' })
    expect(
      nodeIds(makeInputs({ liveEntries: [live], externalSessions: [external] }))
    ).not.toContain('ext:e1')
  })

  it('keeps the external session when the agent differs', () => {
    const live = makeEntry('p', {
      agentType: 'claude',
      providerSession: { key: 'session_id', id: 'sid-e1' }
    })
    expect(
      nodeIds(makeInputs({ liveEntries: [live], externalSessions: [makeExternal('e1')] }))
    ).toContain('ext:e1')
  })
})

describe('buildSessionGraph filters', () => {
  const entries = [
    makeEntry('work', { state: 'working', terminalTitle: 'Fix login bug' }),
    makeEntry('wait', { state: 'waiting', agentType: 'codex' }),
    makeEntry('old', { state: 'done', updatedAt: NOW - 20 * 3_600_000 }),
    makeEntry('oldBlocked', { state: 'blocked', updatedAt: NOW - 20 * 3_600_000 })
  ]
  const base = makeInputs({ liveEntries: entries, externalSessions: [makeExternal('e1')] })
  const live = (ids: string[]): string[] => ids.filter((id) => !id.startsWith('group:'))

  it('matches the query case-insensitively against titles', () => {
    expect(live(nodeIds({ ...base, filters: { ...base.filters, query: 'LOGIN' } }))).toEqual([
      'live:work'
    ])
  })

  it('filters by normalized agent for live and external sessions', () => {
    expect(live(nodeIds({ ...base, filters: { ...base.filters, agents: ['codex'] } }))).toEqual([
      'live:wait',
      'ext:e1'
    ])
  })

  it('filters live sessions by state and hides externals unless "external" is selected', () => {
    const filters = { ...base.filters, states: ['waiting'] }
    expect(live(nodeIds({ ...base, filters }))).toEqual(['live:wait'])
    expect(
      live(nodeIds({ ...base, filters: { ...filters, states: ['waiting', 'external'] } }))
    ).toEqual(['live:wait', 'ext:e1'])
  })

  it('hides external sessions when showExternal is off', () => {
    expect(nodeIds({ ...base, filters: { ...base.filters, showExternal: false } })).not.toContain(
      'ext:e1'
    )
  })

  it('hides only idle (done) sessions older than the threshold', () => {
    const filters = { ...base.filters, hideIdleOlderThanMs: 12 * 3_600_000 }
    const ids = live(nodeIds({ ...base, filters }))
    expect(ids).not.toContain('live:old')
    expect(ids).toContain('live:oldBlocked')
    const staleExternal = makeExternal('e2', {
      updatedAt: new Date(NOW - 13 * 3_600_000).toISOString()
    })
    expect(nodeIds({ ...base, externalSessions: [staleExternal], filters })).not.toContain('ext:e2')
  })

  it('omits groups that end up empty', () => {
    const filters = { ...base.filters, query: 'login', showExternal: false }
    expect(nodeIds({ ...base, filters }).filter((id) => id.startsWith('group:'))).toEqual([
      'group:repo-1'
    ])
  })
})

describe('buildSessionGraph positions', () => {
  it('prefers saved positions and auto-places the rest', () => {
    const graph = buildSessionGraph(
      makeInputs({
        liveEntries: [makeEntry('a'), makeEntry('b')],
        savedPositions: { 'live:a': { x: 900, y: 700 }, 'group:repo-1': { x: -50, y: 10 } }
      })
    )
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))
    expect(byId.get('live:a')?.position).toEqual({ x: 900, y: 700 })
    expect(byId.get('live:b')?.position).toEqual({
      x: SESSION_GROUP_PADDING,
      y: SESSION_GROUP_PADDING
    })
    expect(byId.get('group:repo-1')?.position).toEqual({ x: -50, y: 10 })
  })

  it('places a started child to the right of its parent in the same group', () => {
    const graph = buildSessionGraph(
      makeInputs({
        liveEntries: [
          makeEntry('child', {
            orchestration: { taskId: 't', dispatchId: 'd', parentPaneKey: 'parent' }
          }),
          makeEntry('parent')
        ],
        savedPositions: { 'live:parent': { x: 100, y: 100 } }
      })
    )
    const child = graph.nodes.find((node) => node.id === 'live:child')
    expect(child?.position).toEqual({ x: 460, y: 100 })
  })

  it('lays groups out left to right without overlap', () => {
    const graph = buildSessionGraph(
      makeInputs({ liveEntries: [makeEntry('a'), makeEntry('c', { worktreeId: WT_C })] })
    )
    const groups = graph.nodes.filter((node) => node.type === 'group')
    expect(groups).toHaveLength(2)
    const [first, second] = groups
    expect(second.position.x).toBeGreaterThanOrEqual(first.position.x + (first.width ?? 0))
  })
})
