// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    api: { listExternalSessions: vi.fn(), listMessages: vi.fn(), openPopout: vi.fn() }
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

async function renderPage(
  popout?: Parameters<typeof SessionCanvasPage>[0]['popout']
): Promise<void> {
  render(
    <TooltipProvider>
      <SessionCanvasPage popout={popout} />
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
    // One edge per worktree pair: WT_A's most recent session collides with c in WT_B.
    expect(screen.getAllByText('1 个相同文件')).toHaveLength(1)
  })

  it('offers connection handles on live cards only', async () => {
    await renderPage()
    for (const card of screen.getAllByTestId('session-live-card')) {
      const node = card.closest('.react-flow__node')
      expect(node?.querySelectorAll('.react-flow__handle')).toHaveLength(2)
    }
    const external = screen.getByTestId('session-external-card').closest('.react-flow__node')
    expect(external?.querySelectorAll('.react-flow__handle')).toHaveLength(0)
  })

  it('shows the empty state without sessions', async () => {
    mocks.state.agentStatusByPaneKey = {}
    mocks.api.listExternalSessions.mockResolvedValue({ ok: true, sessions: [] })
    await renderPage()
    expect(screen.getByText(/还没有会话/)).toBeTruthy()
  })

  it('pops the canvas out into its own window', async () => {
    mocks.api.openPopout.mockResolvedValue(undefined)
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: '弹出' }))
    expect(mocks.api.openPopout).toHaveBeenCalledOnce()
  })

  it('in the pop-out, hides the button and uses the git status the main window sent', async () => {
    mocks.fetchChangedFiles.mockClear()
    await renderPage({ changedFilesByWorktree: { [WT_A]: ['src/x.ts'], [WT_B]: ['src/x.ts'] } })
    expect(screen.queryByRole('button', { name: '弹出' })).toBeNull()
    expect(mocks.fetchChangedFiles).not.toHaveBeenCalled()
    expect(screen.getAllByText('1 个相同文件')).toHaveLength(1)
  })
})
