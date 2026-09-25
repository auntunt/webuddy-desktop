// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { NOW, WT_A, WT_B, WT_C, makeEntry, makeExternal } from './session-graph-test-fixtures'
import type { SessionCanvasFilters } from './session-graph-types'

type MockState = {
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
  worktreesByRepo: Record<string, { id: string; repoId: string; path: string }[]>
}

const mocks = vi.hoisted(() => {
  const state: MockState = { agentStatusByPaneKey: {}, worktreesByRepo: {} }
  return {
    state,
    fetchChangedFiles: vi.fn(),
    toastError: vi.fn(),
    api: { listExternalSessions: vi.fn(), listMessages: vi.fn() }
  }
})

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))

vi.mock('./session-canvas-git-status', () => ({
  fetchChangedFilesForWorktrees: mocks.fetchChangedFiles
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

import {
  SESSION_CANVAS_EXTERNAL_POLL_MS,
  SESSION_CANVAS_GIT_POLL_MS,
  SESSION_CANVAS_MESSAGE_POLL_MS,
  useSessionCanvasData
} from './use-session-canvas-data'
import { SESSION_CANVAS_POSITIONS_KEY } from './session-canvas-positions-storage'

const FILTERS: SessionCanvasFilters = {
  query: '',
  agents: [],
  states: [],
  projects: [],
  showExternal: true,
  hideIdleOlderThanMs: null
}

let visibility: DocumentVisibilityState = 'visible'

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility
  })
  localStorage.clear()
  mocks.state.agentStatusByPaneKey = {}
  mocks.state.worktreesByRepo = {}
  mocks.fetchChangedFiles.mockResolvedValue({})
  mocks.api.listExternalSessions.mockResolvedValue({ ok: true, sessions: [] })
  mocks.api.listMessages.mockResolvedValue({ ok: true, messages: [] })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { sessionCanvas: mocks.api }
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

function nodePosition(
  result: { current: ReturnType<typeof useSessionCanvasData> },
  id: string
): { x: number; y: number } | undefined {
  return result.current.graph.nodes.find((node) => node.id === id)?.position
}

describe('useSessionCanvasData polling', () => {
  it('polls messages every 15 s and external sessions every 60 s while visible', async () => {
    renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    expect(mocks.api.listExternalSessions).toHaveBeenCalledTimes(1)
    expect(mocks.api.listMessages).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CANVAS_MESSAGE_POLL_MS)
    })
    expect(mocks.api.listMessages).toHaveBeenCalledTimes(2)
    expect(mocks.api.listExternalSessions).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CANVAS_EXTERNAL_POLL_MS)
    })
    expect(mocks.api.listExternalSessions).toHaveBeenCalledTimes(2)
  })

  it('stops polling while the window is hidden and resumes when shown', async () => {
    renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    act(() => setVisibility('hidden'))
    mocks.api.listMessages.mockClear()
    mocks.api.listExternalSessions.mockClear()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CANVAS_EXTERNAL_POLL_MS * 3)
    })
    expect(mocks.api.listMessages).not.toHaveBeenCalled()
    expect(mocks.api.listExternalSessions).not.toHaveBeenCalled()

    act(() => setVisibility('visible'))
    await flush()
    expect(mocks.api.listMessages).toHaveBeenCalledTimes(1)
    expect(mocks.api.listExternalSessions).toHaveBeenCalledTimes(1)
  })

  it('stops polling after the page unmounts', async () => {
    const { unmount } = renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    unmount()
    mocks.api.listMessages.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CANVAS_EXTERNAL_POLL_MS * 2)
    })
    expect(mocks.api.listMessages).not.toHaveBeenCalled()
  })

  it('queries git status only for canvas worktrees of a repo with several worktrees', async () => {
    mocks.state.agentStatusByPaneKey = {
      a: makeEntry('a', { worktreeId: WT_A }),
      b: makeEntry('b', { worktreeId: WT_B })
    }
    mocks.fetchChangedFiles.mockResolvedValue({ [WT_A]: ['src/x.ts'], [WT_B]: ['src/x.ts'] })
    const { result } = renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    expect(mocks.fetchChangedFiles).toHaveBeenCalledWith([WT_A, WT_B])
    expect(result.current.graph.edges.some((edge) => edge.kind === 'same-file')).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CANVAS_GIT_POLL_MS)
    })
    expect(mocks.fetchChangedFiles).toHaveBeenCalledTimes(2)

    act(() => setVisibility('hidden'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CANVAS_GIT_POLL_MS * 4)
    })
    expect(mocks.fetchChangedFiles).toHaveBeenCalledTimes(2)
  })

  it('skips git status when no repo has two canvas worktrees', async () => {
    mocks.state.agentStatusByPaneKey = { a: makeEntry('a', { worktreeId: WT_A }) }
    renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    expect(mocks.fetchChangedFiles).not.toHaveBeenCalled()
  })

  it('shows external sessions returned by the poll', async () => {
    mocks.api.listExternalSessions.mockResolvedValue({
      ok: true,
      sessions: [makeExternal('e1')]
    })
    const { result } = renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    expect(result.current.graph.nodes.map((node) => node.id)).toContain('ext:e1')
  })
})

describe('useSessionCanvasData positions', () => {
  it('keeps auto-placed cards still when an earlier card disappears', async () => {
    mocks.state.agentStatusByPaneKey = { a: makeEntry('a'), b: makeEntry('b') }
    const { result, rerender } = renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    const before = nodePosition(result, 'live:b')
    expect(nodePosition(result, 'live:a')).not.toEqual(before)

    mocks.state.agentStatusByPaneKey = { b: makeEntry('b') }
    rerender()
    expect(nodePosition(result, 'live:b')).toEqual(before)

    act(() => result.current.resetLayout())
    expect(nodePosition(result, 'live:b')).not.toEqual(before)
  })

  it('persists dragged positions and clears them on reset', async () => {
    mocks.state.agentStatusByPaneKey = { a: makeEntry('a') }
    const { result } = renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    const auto = nodePosition(result, 'live:a')

    act(() => result.current.savePosition('live:a', { x: 700, y: 400 }))
    expect(nodePosition(result, 'live:a')).toEqual({ x: 700, y: 400 })
    expect(JSON.parse(localStorage.getItem(SESSION_CANVAS_POSITIONS_KEY) ?? '{}')).toEqual({
      'live:a': { x: 700, y: 400 }
    })

    act(() => result.current.resetLayout())
    expect(nodePosition(result, 'live:a')).toEqual(auto)
    expect(localStorage.getItem(SESSION_CANVAS_POSITIONS_KEY)).toBeNull()
  })

  it('restores saved positions on the next mount', async () => {
    localStorage.setItem(
      SESSION_CANVAS_POSITIONS_KEY,
      JSON.stringify({ 'live:a': { x: 900, y: 120 } })
    )
    mocks.state.agentStatusByPaneKey = { a: makeEntry('a') }
    const { result } = renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    expect(nodePosition(result, 'live:a')).toEqual({ x: 900, y: 120 })
  })

  it('follows a drag saved by the other canvas window (main or pop-out)', async () => {
    mocks.state.agentStatusByPaneKey = { a: makeEntry('a') }
    const { result } = renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    localStorage.setItem(
      SESSION_CANVAS_POSITIONS_KEY,
      JSON.stringify({ 'live:a': { x: 640, y: 320 } })
    )
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: SESSION_CANVAS_POSITIONS_KEY }))
    })
    expect(nodePosition(result, 'live:a')).toEqual({ x: 640, y: 320 })
  })

  it('reuses the graph when nothing changed', async () => {
    mocks.state.agentStatusByPaneKey = { a: makeEntry('a') }
    const { result, rerender } = renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    const graph = result.current.graph
    rerender()
    expect(result.current.graph).toBe(graph)
  })
})

describe('useSessionCanvasData failures and in-flight guards', () => {
  it('toasts each {ok:false} reason once across polls', async () => {
    mocks.api.listMessages.mockResolvedValue({ ok: false, reason: '邮箱不可用' })
    renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CANVAS_MESSAGE_POLL_MS * 2)
    })
    expect(mocks.api.listMessages).toHaveBeenCalledTimes(3)
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).toHaveBeenCalledWith('邮箱不可用')
  })

  it('toasts a rejected request once instead of swallowing it', async () => {
    mocks.api.listExternalSessions.mockRejectedValue(new Error('ipc gone'))
    renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CANVAS_EXTERNAL_POLL_MS * 2)
    })
    expect(mocks.api.listExternalSessions).toHaveBeenCalledTimes(3)
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(mocks.toastError.mock.calls[0][0]).toContain('ipc gone')
  })

  it('skips a tick while the previous request is still pending', async () => {
    let settle: (value: unknown) => void = () => {}
    mocks.api.listMessages.mockReturnValue(new Promise((resolve) => (settle = resolve)))
    mocks.api.listExternalSessions.mockReturnValue(new Promise(() => {}))
    renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SESSION_CANVAS_EXTERNAL_POLL_MS * 2)
    })
    expect(mocks.api.listMessages).toHaveBeenCalledTimes(1)
    expect(mocks.api.listExternalSessions).toHaveBeenCalledTimes(1)

    mocks.api.listMessages.mockResolvedValue({ ok: true, messages: [] })
    await act(async () => {
      settle({ ok: true, messages: [] })
      await vi.advanceTimersByTimeAsync(SESSION_CANVAS_MESSAGE_POLL_MS)
    })
    expect(mocks.api.listMessages).toHaveBeenCalledTimes(2)
  })

  it('refreshMessages still runs while a tick is pending', async () => {
    mocks.api.listMessages.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useSessionCanvasData(FILTERS))
    await flush()
    act(() => result.current.refreshMessages())
    expect(mocks.api.listMessages).toHaveBeenCalledTimes(2)
  })
})

describe('useSessionCanvasData filters', () => {
  it('puts every card back where it was after a search is cleared', async () => {
    mocks.state.agentStatusByPaneKey = {
      a: makeEntry('a', { worktreeId: WT_A, terminalTitle: 'alpha' }),
      c: makeEntry('c', { worktreeId: WT_C, terminalTitle: 'gamma' })
    }
    let filters = FILTERS
    const { result, rerender } = renderHook(() => useSessionCanvasData(filters))
    await flush()
    const groupBefore = nodePosition(result, 'group:repo-1')
    const cardBefore = nodePosition(result, 'live:a')

    filters = { ...FILTERS, query: 'gamma' }
    rerender()
    expect(nodePosition(result, 'live:a')).toBeUndefined()
    filters = FILTERS
    rerender()
    expect(nodePosition(result, 'group:repo-1')).toEqual(groupBefore)
    expect(nodePosition(result, 'live:a')).toEqual(cardBefore)
  })

  it('filters by project and still offers the hidden projects', async () => {
    mocks.state.agentStatusByPaneKey = {
      a: makeEntry('a', { worktreeId: WT_A }),
      c: makeEntry('c', { worktreeId: WT_C })
    }
    const filters = { ...FILTERS, projects: ['group:repo-2'] }
    const { result } = renderHook(() => useSessionCanvasData(filters))
    await flush()
    expect(result.current.graph.nodes.map((node) => node.id).sort()).toEqual([
      'group:repo-2',
      'live:c'
    ])
    expect(result.current.projectOptions.map((option) => option.id).sort()).toEqual([
      'group:repo-1',
      'group:repo-2'
    ])
  })
})
