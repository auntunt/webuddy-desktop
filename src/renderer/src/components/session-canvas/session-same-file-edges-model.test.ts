import { describe, expect, it } from 'vitest'
import type { AgentActionHistoryEntry } from '../../../../shared/agent-status-types'
import { buildSessionGraph } from './session-graph-model'
import { WT_A, WT_B, makeEntry, makeInputs } from './session-graph-test-fixtures'

const edit = (path: string): AgentActionHistoryEntry => ({
  toolName: 'Edit',
  toolInput: path,
  at: 0
})

function sameFileEdges(inputs: ReturnType<typeof makeInputs>) {
  return buildSessionGraph(inputs).edges.filter((edge) => edge.kind === 'same-file')
}

describe('same-file edges within one worktree', () => {
  const changedFilesByWorktree = { [WT_A]: ['src/a.ts', 'src/b.ts'] }

  it('ignores shared git status when the sessions touched different files', () => {
    const edges = sameFileEdges(
      makeInputs({
        liveEntries: [
          makeEntry('a', { actionHistory: [edit('src/a.ts')] }),
          makeEntry('b', { actionHistory: [edit('src/b.ts')] })
        ],
        changedFilesByWorktree
      })
    )
    expect(edges).toEqual([])
  })

  it('links sessions that edited the same file, repo-relative', () => {
    const edges = sameFileEdges(
      makeInputs({
        liveEntries: [
          makeEntry('b', { actionHistory: [edit('/work/app/src/a.ts'), edit('src/c.ts')] }),
          makeEntry('a', { actionHistory: [edit('src/a.ts')] })
        ],
        changedFilesByWorktree
      })
    )
    expect(edges).toEqual([
      {
        id: 'same-file:live:a|live:b',
        source: 'live:a',
        target: 'live:b',
        kind: 'same-file',
        animated: false,
        files: ['src/a.ts']
      }
    ])
  })
})

describe('same-file edges across worktrees', () => {
  it('uses sorted endpoint ids for the edge id', () => {
    const edges = sameFileEdges(
      makeInputs({
        liveEntries: [makeEntry('z', { worktreeId: WT_B }), makeEntry('a')],
        changedFilesByWorktree: { [WT_A]: ['x'], [WT_B]: ['x'] }
      })
    )
    expect(edges.map((edge) => [edge.id, edge.source, edge.target])).toEqual([
      ['same-file:live:a|live:z', 'live:a', 'live:z']
    ])
  })

  it('stays fast for 200 sessions × 2000 files', () => {
    const files = Array.from({ length: 2000 }, (_, i) => `src/f${i}.ts`)
    const worktree = (i: number): string => `repo-1::/work/wt${i}`
    const scenarios = [
      // Disjoint files in 200 worktrees: the worst case for pairwise intersection.
      { worktrees: 200, fileFor: (w: number) => files.map((f) => `${w}/${f}`) },
      // Identical files in 20 worktrees of 10 sessions each.
      { worktrees: 20, fileFor: () => files }
    ]
    for (const { worktrees, fileFor } of scenarios) {
      const changed: Record<string, string[]> = {}
      const repoIdByWorktree: Record<string, string> = {}
      for (let w = 0; w < worktrees; w++) {
        changed[worktree(w)] = fileFor(w)
        repoIdByWorktree[worktree(w)] = 'repo-1'
      }
      const liveEntries = Array.from({ length: 200 }, (_, i) =>
        makeEntry(`p${i}`, { worktreeId: worktree(i % worktrees) })
      )
      const inputs = makeInputs({ liveEntries, changedFilesByWorktree: changed, repoIdByWorktree })
      // Why: warm up once so the bound measures steady-state recompute, not first-call JIT.
      sameFileEdges(inputs)
      const started = performance.now()
      const edges = sameFileEdges(inputs)
      const elapsed = performance.now() - started
      expect(elapsed).toBeLessThan(100)
      expect(edges.every((edge) => (edge.files?.length ?? 0) <= 20)).toBe(true)
    }
  })
})
