import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from './agent-status-types'
import {
  isSessionCanvasPopoutSnapshot,
  mergeSessionCanvasPopoutSnapshot,
  type SessionCanvasPopoutSnapshot
} from './session-canvas-popout'

function entry(paneKey: string, prompt = ''): AgentStatusEntry {
  return {
    state: 'working',
    prompt,
    updatedAt: 1,
    stateStartedAt: 1,
    paneKey,
    stateHistory: []
  }
}

function snapshot(overrides: Partial<SessionCanvasPopoutSnapshot>): SessionCanvasPopoutSnapshot {
  return {
    agentStatusByPaneKey: {},
    sshConnectionStates: {},
    sshTargetLabels: {},
    changedFilesByWorktree: {},
    ...overrides
  }
}

describe('mergeSessionCanvasPopoutSnapshot', () => {
  it('applies a delta onto the previous entries, keeping unchanged entry objects', () => {
    const a = entry('a')
    const full = snapshot({ agentStatusByPaneKey: { a, b: entry('b'), c: entry('c') } })
    const delta = snapshot({
      agentStatusByPaneKey: { b: entry('b', 'new') },
      removedPaneKeys: ['c']
    })
    const merged = mergeSessionCanvasPopoutSnapshot(full, delta)
    expect(Object.keys(merged.agentStatusByPaneKey).sort()).toEqual(['a', 'b'])
    expect(merged.agentStatusByPaneKey.a).toBe(a)
    expect(merged.agentStatusByPaneKey.b?.prompt).toBe('new')
    expect('removedPaneKeys' in merged).toBe(false)
  })

  it('replaces entries on a full snapshot and keeps an omitted worktree map', () => {
    const worktreesByRepo = { repo: [] }
    const previous = snapshot({ agentStatusByPaneKey: { a: entry('a') }, worktreesByRepo })
    const merged = mergeSessionCanvasPopoutSnapshot(
      previous,
      snapshot({ agentStatusByPaneKey: { b: entry('b') } })
    )
    expect(Object.keys(merged.agentStatusByPaneKey)).toEqual(['b'])
    expect(merged.worktreesByRepo).toBe(worktreesByRepo)
  })
})

describe('isSessionCanvasPopoutSnapshot', () => {
  it('accepts string removal lists only', () => {
    expect(isSessionCanvasPopoutSnapshot(snapshot({ removedPaneKeys: ['a'] }))).toBe(true)
    expect(isSessionCanvasPopoutSnapshot({ ...snapshot({}), removedPaneKeys: [1] })).toBe(false)
  })
})
