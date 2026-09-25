import { describe, expect, it } from 'vitest'
import type { SshConnectionState } from '../../../../shared/ssh-types'
import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
import {
  SESSION_CANVAS_POPOUT_REPLY_MAX_CHARS,
  buildSessionCanvasPopoutSnapshot,
  sessionCanvasPopoutInputsChanged,
  sessionCanvasPopoutStorePatch,
  type SessionCanvasPopoutSourceState
} from './session-canvas-popout-model'
import { makeEntry, WT_A } from './session-graph-test-fixtures'

const SSH: SshConnectionState = {
  targetId: 'box',
  status: 'connected',
  error: null,
  reconnectAttempt: 0
}

function makeState(): SessionCanvasPopoutSourceState {
  return {
    agentStatusByPaneKey: {
      'tab-1:leaf-1': makeEntry('tab-1:leaf-1', {
        actionHistory: [{ toolName: 'Edit', toolInput: 'a.ts', at: 1 }]
      })
    },
    worktreesByRepo: {
      'repo-1': [makeWorktree({ id: WT_A, repoId: 'repo-1', path: '/work/app' })]
    },
    sshConnectionStates: new Map([['conn-1', SSH]]),
    sshTargetLabels: new Map([['conn-1', 'build box']])
  }
}

describe('buildSessionCanvasPopoutSnapshot', () => {
  it('carries the main store entries (with derived action history) as plain data', () => {
    const state = makeState()
    const snapshot = buildSessionCanvasPopoutSnapshot(state, { [WT_A]: ['a.ts'] }, true)
    expect(snapshot).toEqual({
      agentStatusByPaneKey: {
        'tab-1:leaf-1': { ...state.agentStatusByPaneKey['tab-1:leaf-1'], stateHistory: [] }
      },
      worktreesByRepo: state.worktreesByRepo,
      sshConnectionStates: { 'conn-1': SSH },
      sshTargetLabels: { 'conn-1': 'build box' },
      changedFilesByWorktree: { [WT_A]: ['a.ts'] }
    })
    expect(snapshot.agentStatusByPaneKey['tab-1:leaf-1']?.actionHistory).toHaveLength(1)
  })

  it('omits the worktree map when asked to', () => {
    const snapshot = buildSessionCanvasPopoutSnapshot(makeState(), {}, false)
    expect('worktreesByRepo' in snapshot).toBe(false)
  })
})

describe('sessionCanvasPopoutStorePatch', () => {
  it('restores Maps and keeps the retained worktrees when the snapshot omits them', () => {
    const state = makeState()
    const slim = buildSessionCanvasPopoutSnapshot(state, {}, false)
    const patch = sessionCanvasPopoutStorePatch(slim, state.worktreesByRepo)
    expect(patch.sshConnectionStates.get('conn-1')).toEqual(SSH)
    expect(patch.sshTargetLabels.get('conn-1')).toBe('build box')
    expect(patch.worktreesByRepo).toBe(state.worktreesByRepo)
    expect(patch.agentStatusByPaneKey).toBe(slim.agentStatusByPaneKey)
  })

  it('takes the snapshot worktrees when present', () => {
    const full = buildSessionCanvasPopoutSnapshot(makeState(), {}, true)
    expect(sessionCanvasPopoutStorePatch(full, {}).worktreesByRepo).toBe(full.worktreesByRepo)
  })
})

describe('sessionCanvasPopoutInputsChanged', () => {
  it('fires only for slices the pop-out mirrors', () => {
    const state = makeState()
    expect(sessionCanvasPopoutInputsChanged(state, { ...state })).toBe(false)
    expect(sessionCanvasPopoutInputsChanged({ ...state, agentStatusByPaneKey: {} }, state)).toBe(
      true
    )
    expect(sessionCanvasPopoutInputsChanged({ ...state, sshTargetLabels: new Map() }, state)).toBe(
      true
    )
  })
})

describe('popout snapshot size', () => {
  it('drops fields the canvas never reads and caps long replies', () => {
    const state = makeState()
    state.agentStatusByPaneKey = {
      a: makeEntry('a', {
        stateHistory: [{ state: 'working', prompt: 'p', startedAt: 1 }],
        interactivePrompt: '{"questions":[]}',
        lastAssistantMessage: 'x'.repeat(SESSION_CANVAS_POPOUT_REPLY_MAX_CHARS + 50),
        model: 'opus'
      }),
      w: makeEntry('w', { state: 'waiting', interactivePrompt: '{"approval":{}}' })
    }
    const { agentStatusByPaneKey } = buildSessionCanvasPopoutSnapshot(state, {}, false)
    expect(agentStatusByPaneKey.a?.stateHistory).toEqual([])
    expect(agentStatusByPaneKey.a?.interactivePrompt).toBeUndefined()
    expect(agentStatusByPaneKey.a && 'model' in agentStatusByPaneKey.a).toBe(false)
    expect(agentStatusByPaneKey.a?.lastAssistantMessage).toHaveLength(
      SESSION_CANVAS_POPOUT_REPLY_MAX_CHARS
    )
    expect(agentStatusByPaneKey.w?.interactivePrompt).toBe('{"approval":{}}')
  })

  it('sends only changed entries and removals when given the previously sent entries', () => {
    const state = makeState()
    const kept = makeEntry('kept')
    const previous = { kept, gone: makeEntry('gone'), changed: makeEntry('changed') }
    state.agentStatusByPaneKey = { kept, changed: makeEntry('changed', { prompt: 'new' }) }
    const delta = buildSessionCanvasPopoutSnapshot(state, {}, false, previous)
    expect(Object.keys(delta.agentStatusByPaneKey)).toEqual(['changed'])
    expect(delta.removedPaneKeys).toEqual(['gone'])
  })
})
