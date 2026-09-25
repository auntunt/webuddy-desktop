// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardRevealAgentArgs } from '../../../../shared/dashboard-snapshot'
import type { SessionCanvasPopoutSnapshot } from '../../../../shared/session-canvas-popout'
import { makeEntry, WT_A, WT_B } from './session-graph-test-fixtures'

const mocks = vi.hoisted(() => {
  const state: { current: Record<string, unknown> } = { current: {} }
  return {
    state,
    storeListeners: new Set<(next: unknown, previous: unknown) => void>(),
    fetchChangedFiles: vi.fn(async (_targets: readonly string[]) => ({})),
    revealDashboardAgent: vi.fn((_args: unknown) => true),
    toastError: vi.fn()
  }
})

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mocks.state.current,
    subscribe: (listener: (next: unknown, previous: unknown) => void) => {
      mocks.storeListeners.add(listener)
      return () => mocks.storeListeners.delete(listener)
    }
  }
}))
vi.mock('./session-canvas-git-status', () => ({
  fetchChangedFilesForWorktrees: mocks.fetchChangedFiles
}))
vi.mock('../dashboard/reveal-dashboard-agent', () => ({
  revealDashboardAgent: mocks.revealDashboardAgent
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import { installSessionCanvasPopoutBridge } from './session-canvas-popout-bridge'

function installApi() {
  const listeners: {
    open: ((open: boolean) => void) | null
    reveal: ((args: DashboardRevealAgentArgs) => void) | null
    requested: Set<() => void>
  } = { open: null, reveal: null, requested: new Set() }
  const api = {
    publishSnapshot: vi.fn(async (_snapshot: SessionCanvasPopoutSnapshot) => undefined),
    getPopoutOpen: vi.fn(async () => false),
    onPopoutOpenChanged: (callback: (open: boolean) => void) => {
      listeners.open = callback
      return () => {
        listeners.open = null
      }
    },
    // Two subscribers (publisher + git refresh) share this channel in the real preload.
    onSnapshotRequested: (callback: () => void) => {
      listeners.requested.add(callback)
      return () => listeners.requested.delete(callback)
    },
    onRevealAgent: (callback: (args: DashboardRevealAgentArgs) => void) => {
      listeners.reveal = callback
      return () => {
        listeners.reveal = null
      }
    }
  }
  Object.assign(window, { api: { sessionCanvas: api } })
  return {
    api,
    listeners,
    open: (next: boolean) => listeners.open?.(next),
    reveal: (args: DashboardRevealAgentArgs) => listeners.reveal?.(args),
    request: () => {
      for (const callback of listeners.requested) {
        callback()
      }
    }
  }
}

function lastSnapshot(api: ReturnType<typeof installApi>['api']): SessionCanvasPopoutSnapshot {
  return api.publishSnapshot.mock.calls.at(-1)![0]
}

describe('installSessionCanvasPopoutBridge', () => {
  let harness: ReturnType<typeof installApi>
  let dispose: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.storeListeners.clear()
    mocks.state.current = {
      agentStatusByPaneKey: {
        a: makeEntry('a', {
          worktreeId: WT_A,
          actionHistory: [{ toolName: 'Edit', toolInput: 'x', at: 1 }]
        }),
        b: makeEntry('b', { worktreeId: WT_B })
      },
      worktreesByRepo: {},
      sshConnectionStates: new Map(),
      sshTargetLabels: new Map()
    }
    harness = installApi()
    dispose = installSessionCanvasPopoutBridge()
  })
  afterEach(() => {
    dispose()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('publishes the main store entries, including derived action history, once open', () => {
    expect(harness.api.publishSnapshot).not.toHaveBeenCalled()
    harness.open(true)
    const snapshot = lastSnapshot(harness.api)
    expect(snapshot.agentStatusByPaneKey).toBe(mocks.state.current.agentStatusByPaneKey)
    expect(snapshot.worktreesByRepo).toBe(mocks.state.current.worktreesByRepo)
  })

  it('republishes on mirrored store writes and omits an unchanged worktree map', () => {
    harness.open(true)
    harness.api.publishSnapshot.mockClear()
    vi.advanceTimersByTime(300)
    const previous = mocks.state.current
    mocks.state.current = { ...previous, agentStatusByPaneKey: {} }
    for (const listener of mocks.storeListeners) {
      listener(mocks.state.current, previous)
    }
    expect(harness.api.publishSnapshot).toHaveBeenCalledOnce()
    expect('worktreesByRepo' in lastSnapshot(harness.api)).toBe(false)
  })

  it('refreshes git status for the canvas targets when the pop-out asks, then republishes', async () => {
    harness.open(true)
    mocks.fetchChangedFiles.mockResolvedValueOnce({ [WT_A]: ['a.ts'] })
    harness.request()
    expect(mocks.fetchChangedFiles).toHaveBeenCalledWith([WT_A, WT_B])
    await vi.waitFor(() =>
      expect(lastSnapshot(harness.api).changedFilesByWorktree).toEqual({ [WT_A]: ['a.ts'] })
    )
  })

  it('reveals the terminal in this window and reports a failure', () => {
    const args = { repoId: 'repo-1', worktreeId: WT_A, tabId: 't', leafId: null }
    harness.reveal(args)
    expect(mocks.revealDashboardAgent).toHaveBeenCalledWith(args)
    expect(mocks.toastError).not.toHaveBeenCalled()
    mocks.revealDashboardAgent.mockReturnValueOnce(false)
    harness.reveal(args)
    expect(mocks.toastError).toHaveBeenCalledOnce()
  })

  it('releases every listener on dispose', () => {
    harness.open(true)
    dispose()
    expect(harness.listeners.open).toBeNull()
    expect(harness.listeners.reveal).toBeNull()
    expect(harness.listeners.requested.size).toBe(0)
    expect(mocks.storeListeners.size).toBe(0)
    dispose = () => {}
  })
})
