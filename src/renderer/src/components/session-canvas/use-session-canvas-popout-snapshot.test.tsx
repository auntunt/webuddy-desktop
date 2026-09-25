// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { SessionCanvasPopoutSnapshot } from '../../../../shared/session-canvas-popout'
import { makeEntry, WT_A } from './session-graph-test-fixtures'
import {
  useSessionCanvasPopoutSnapshot,
  type SessionCanvasPopoutView
} from './use-session-canvas-popout-snapshot'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let deliver: ((snapshot: SessionCanvasPopoutSnapshot) => void) | null = null
const api = {
  requestSnapshot: vi.fn(async () => undefined),
  onSnapshot: vi.fn((callback: (snapshot: SessionCanvasPopoutSnapshot) => void) => {
    deliver = callback
    return () => {
      deliver = null
    }
  })
}

let view: SessionCanvasPopoutView | null = null
function Harness(): null {
  view = useSessionCanvasPopoutSnapshot()
  return null
}

const ENTRY = makeEntry('tab-1:leaf-1', {
  actionHistory: [{ toolName: 'Edit', toolInput: 'a.ts', at: 1 }]
})

function snapshot(
  overrides: Partial<SessionCanvasPopoutSnapshot> = {}
): SessionCanvasPopoutSnapshot {
  return {
    agentStatusByPaneKey: { [ENTRY.paneKey]: ENTRY },
    worktreesByRepo: { 'repo-1': [] },
    sshConnectionStates: {},
    sshTargetLabels: { 'conn-1': 'box' },
    changedFilesByWorktree: { [WT_A]: ['a.ts'] },
    ...overrides
  }
}

describe('useSessionCanvasPopoutSnapshot', () => {
  let root: Root

  beforeEach(() => {
    Object.assign(window, { api: { sessionCanvas: api } })
    root = createRoot(document.createElement('div'))
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    vi.clearAllMocks()
    view = null
  })

  it('asks for the replay on mount and waits for it before rendering', async () => {
    await act(async () => root.render(<Harness />))
    expect(api.requestSnapshot).toHaveBeenCalled()
    expect(view?.ready).toBe(false)
  })

  it('mirrors the main-window data (history included) into this window store', async () => {
    await act(async () => root.render(<Harness />))
    await act(async () => deliver?.(snapshot()))
    const state = useAppStore.getState()
    expect(state.agentStatusByPaneKey[ENTRY.paneKey]?.actionHistory).toEqual(ENTRY.actionHistory)
    expect(state.sshTargetLabels.get('conn-1')).toBe('box')
    expect(view).toEqual({ ready: true, changedFilesByWorktree: { [WT_A]: ['a.ts'] } })

    // A slim republish keeps the worktree map this window already has.
    const worktrees = state.worktreesByRepo
    const { worktreesByRepo: _omitted, ...slim } = snapshot({ agentStatusByPaneKey: {} })
    await act(async () => deliver?.(slim))
    expect(useAppStore.getState().worktreesByRepo).toBe(worktrees)
    expect(useAppStore.getState().agentStatusByPaneKey).toEqual({})
  })

  it('unsubscribes on unmount', async () => {
    await act(async () => root.render(<Harness />))
    await act(async () => root.unmount())
    expect(deliver).toBeNull()
    root = createRoot(document.createElement('div'))
  })
})
