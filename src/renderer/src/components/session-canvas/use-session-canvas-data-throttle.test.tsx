// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { NOW, makeEntry } from './session-graph-test-fixtures'
import type * as SessionGraphModel from './session-graph-model'
import type { SessionCanvasFilters } from './session-graph-types'

const mocks = vi.hoisted(() => ({
  state: {
    agentStatusByPaneKey: {} as Record<string, AgentStatusEntry>,
    worktreesByRepo: {}
  },
  buildCount: 0,
  api: { listExternalSessions: vi.fn(), listMessages: vi.fn() }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))
vi.mock('./session-canvas-git-status', () => ({
  fetchChangedFilesForWorktrees: vi.fn(async () => ({}))
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('./session-graph-model', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionGraphModel>()
  return {
    ...actual,
    buildSessionGraph: (...args: Parameters<typeof actual.buildSessionGraph>) => {
      mocks.buildCount += 1
      return actual.buildSessionGraph(...args)
    }
  }
})

import { SESSION_CANVAS_STATUS_THROTTLE_MS, useSessionCanvasData } from './use-session-canvas-data'

const FILTERS: SessionCanvasFilters = {
  query: '',
  agents: [],
  states: [],
  projects: [],
  showExternal: true,
  hideIdleOlderThanMs: null
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mocks.buildCount = 0
  mocks.state.agentStatusByPaneKey = {}
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
})

function nodeData(result: { current: ReturnType<typeof useSessionCanvasData> }, id: string) {
  return result.current.graph.nodes.find((node) => node.id === id)?.data
}

describe('useSessionCanvasData status throttling', () => {
  it('rebuilds the graph at most once per throttle window under a status burst', async () => {
    mocks.state.agentStatusByPaneKey = { a: makeEntry('a') }
    const { result, rerender } = renderHook(() => useSessionCanvasData(FILTERS))
    await act(async () => {
      vi.advanceTimersByTime(SESSION_CANVAS_STATUS_THROTTLE_MS)
    })
    const baseline = mocks.buildCount

    for (let i = 1; i <= 20; i += 1) {
      mocks.state.agentStatusByPaneKey = { a: makeEntry('a', { prompt: `ping ${i}` }) }
      rerender()
    }
    expect(mocks.buildCount - baseline).toBeLessThanOrEqual(1)

    act(() => {
      vi.advanceTimersByTime(SESSION_CANVAS_STATUS_THROTTLE_MS)
    })
    expect(mocks.buildCount - baseline).toBeLessThanOrEqual(2)
    const data = nodeData(result, 'live:a')
    expect(data && 'entry' in data ? data.entry.prompt : null).toBe('ping 20')
  })

  it('keeps unchanged cards on the same data object across unrelated pings', async () => {
    const b = makeEntry('b')
    mocks.state.agentStatusByPaneKey = { a: makeEntry('a'), b }
    const { result, rerender } = renderHook(() => useSessionCanvasData(FILTERS))
    await act(async () => {
      vi.advanceTimersByTime(SESSION_CANVAS_STATUS_THROTTLE_MS)
    })
    const beforeA = nodeData(result, 'live:a')
    const beforeB = nodeData(result, 'live:b')

    mocks.state.agentStatusByPaneKey = { a: makeEntry('a', { prompt: 'new' }), b }
    rerender()
    act(() => {
      vi.advanceTimersByTime(SESSION_CANVAS_STATUS_THROTTLE_MS)
    })
    expect(nodeData(result, 'live:a')).not.toBe(beforeA)
    expect(nodeData(result, 'live:b')).toBe(beforeB)
  })
})
