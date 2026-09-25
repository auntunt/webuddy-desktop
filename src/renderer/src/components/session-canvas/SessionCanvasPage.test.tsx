// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { installReactFlowTestDom } from './session-canvas-test-dom'
import {
  NOW,
  WT_A,
  WT_B,
  makeEntry,
  makeExternal,
  makeMessage
} from './session-graph-test-fixtures'

const mocks = vi.hoisted(() => {
  const state: { agentStatusByPaneKey: Record<string, AgentStatusEntry>; worktreesByRepo: {} } = {
    agentStatusByPaneKey: {},
    worktreesByRepo: {}
  }
  return {
    state,
    fetchChangedFiles: vi.fn(),
    api: { listExternalSessions: vi.fn(), listMessages: vi.fn() }
  }
})

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))

vi.mock('./session-canvas-git-status', () => ({
  fetchChangedFilesForWorktrees: mocks.fetchChangedFiles
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import SessionCanvasPage from './SessionCanvasPage'

let restoreDom: () => void = () => {}

beforeEach(() => {
  restoreDom = installReactFlowTestDom()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  localStorage.clear()
  mocks.fetchChangedFiles.mockResolvedValue({
    [WT_A]: ['src/shared.ts'],
    [WT_B]: ['src/shared.ts']
  })
  mocks.api.listExternalSessions.mockResolvedValue({
    ok: true,
    sessions: [makeExternal('e1', { cwd: null, title: 'Outside session' })]
  })
  mocks.api.listMessages.mockResolvedValue({
    ok: true,
    messages: [makeMessage({ fromPaneKey: 'a', toPaneKey: 'c', at: NOW - 1000 })]
  })
  Object.defineProperty(window, 'api', { configurable: true, value: { sessionCanvas: mocks.api } })
  mocks.state.agentStatusByPaneKey = {
    a: makeEntry('a', { worktreeId: WT_A, terminalTitle: 'Coordinator' }),
    b: makeEntry('b', {
      worktreeId: WT_A,
      terminalTitle: 'Worker',
      orchestration: { taskId: 't', dispatchId: 'd', parentPaneKey: 'a' }
    }),
    c: makeEntry('c', { worktreeId: WT_B, terminalTitle: 'Feature' })
  }
})

afterEach(() => {
  cleanup()
  restoreDom()
  vi.restoreAllMocks()
})

async function renderPage(): Promise<void> {
  render(
    <TooltipProvider>
      <SessionCanvasPage />
    </TooltipProvider>
  )
  // Let the polls resolve and React Flow measure nodes and handles.
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

describe('SessionCanvasPage', () => {
  it('renders repo groups, live and external cards', async () => {
    await renderPage()
    expect(screen.getByText('会话画布', { selector: 'h1' })).toBeTruthy()
    expect(screen.getAllByTestId('session-group-node').length).toBe(2)
    expect(screen.getByText('其他')).toBeTruthy()
    expect(screen.getAllByTestId('session-live-card')).toHaveLength(3)
    expect(screen.getByTestId('session-external-card').textContent).toContain('Outside session')
  })

  it('draws started, messaged and same-file edges', async () => {
    await renderPage()
    const edgeIds = [...document.querySelectorAll('.react-flow__edge')].map((edge) =>
      edge.getAttribute('data-id')
    )
    expect(edgeIds).toEqual(
      expect.arrayContaining([
        expect.stringContaining('started'),
        expect.stringContaining('messaged'),
        expect.stringContaining('same-file')
      ])
    )
    expect(screen.getByTestId('session-edge-flow')).toBeTruthy()
    // a and b share WT_A; each collides with c in WT_B.
    expect(screen.getAllByText('1 个相同文件')).toHaveLength(2)
  })

  it('shows the empty state without sessions', async () => {
    mocks.state.agentStatusByPaneKey = {}
    mocks.api.listExternalSessions.mockResolvedValue({ ok: true, sessions: [] })
    await renderPage()
    expect(screen.getByText(/还没有会话/)).toBeTruthy()
  })
})
