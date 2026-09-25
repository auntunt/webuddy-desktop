// @vitest-environment happy-dom

import { act, cleanup, fireEvent, screen, type RenderOptions } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { installReactFlowTestDom } from './session-canvas-test-dom'
import { renderSessionCardNode } from './session-card-test-render'
import { NOW, WT_A, makeEntry } from './session-graph-test-fixtures'

const LEAF = '11111111-1111-4111-8111-111111111111'
const PANE_KEY = `tab1:${LEAF}`

const mocks = vi.hoisted(() => {
  const worktreesByRepo: Record<string, unknown[]> = {}
  const noSettings = (): { skipCloseTerminalWithRunningProcessConfirm?: boolean } | null => null
  return {
    state: {
      worktreesByRepo,
      sshConnectionStates: new Map<string, { status: string }>(),
      sshTargetLabels: new Map<string, string>(),
      settings: noSettings()
    },
    reveal: vi.fn(),
    revealAgent: vi.fn(async () => undefined),
    closePane: vi.fn(),
    sendPrompt: vi.fn()
  }
})

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))
vi.mock('../dashboard/reveal-dashboard-agent', () => ({ revealDashboardAgent: mocks.reveal }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { useRunningTerminalCloseConfirmStore } from '@/store/running-terminal-close-confirm'
import { LiveSessionCard } from './LiveSessionCard'
import { revealInMainWindow, SessionCanvasRevealContext } from './session-canvas-reveal'

let restoreDom: () => void = () => {}

beforeEach(() => {
  restoreDom = installReactFlowTestDom()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  mocks.sendPrompt.mockResolvedValue({ ok: true })
  mocks.closePane.mockResolvedValue({ ok: true })
  useRunningTerminalCloseConfirmStore.setState({ runningTerminalCloseConfirm: null })
  mocks.state.worktreesByRepo = {
    'repo-1': [{ id: WT_A, branch: 'refs/heads/feature/login', displayName: 'app' }]
  }
  mocks.state.sshConnectionStates = new Map()
  mocks.state.sshTargetLabels = new Map()
  mocks.state.settings = null
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      sessionCanvas: {
        sendPrompt: mocks.sendPrompt,
        closePane: mocks.closePane,
        revealAgent: mocks.revealAgent
      }
    }
  })
})

afterEach(() => {
  cleanup()
  restoreDom()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

async function renderCard(
  overrides: Partial<AgentStatusEntry> = {},
  wrapper?: RenderOptions['wrapper']
): Promise<HTMLElement> {
  const entry = makeEntry(PANE_KEY, {
    tabId: 'tab1',
    terminalTitle: 'Fix login bug',
    stateStartedAt: NOW - 5 * 60_000,
    actionHistory: [
      { toolName: 'Read', toolInput: 'src/login.ts', at: NOW - 2000 },
      { toolName: 'Edit', toolInput: 'src/login.ts', at: NOW - 1000 }
    ],
    lastAssistantMessage: 'Patched the null check.',
    ...overrides
  })
  const { container } = renderSessionCardNode(
    { live: LiveSessionCard },
    { kind: 'live', entry, repoLabel: 'app' },
    wrapper
  )
  await act(async () => {})
  return container
}

describe('LiveSessionCard', () => {
  it('shows the session header, action stream, reply, footer and connection handles', async () => {
    const container = await renderCard()
    expect(screen.getByText('Fix login bug')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Patched the null check.')).toBeTruthy()
    expect(screen.getByText('app · feature/login · 5m')).toBeTruthy()
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(2)
  })

  it('shows approval options while waiting and writes the chosen key', async () => {
    await renderCard({
      state: 'waiting',
      interactivePrompt: JSON.stringify({ approval: { tool: 'Bash', summary: 'pnpm i' } })
    })
    const allow = screen.getByRole('button', { name: 'Allow' })
    await act(async () => {
      fireEvent.click(allow)
    })
    expect(mocks.sendPrompt).toHaveBeenCalledWith({ paneKey: PANE_KEY, text: '1', keys: true })
  })

  it('does not offer approvals while the agent is working', async () => {
    await renderCard({
      interactivePrompt: JSON.stringify({ approval: { tool: 'Bash', summary: 'pnpm i' } })
    })
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
  })

  it('reveals the terminal through the dashboard reveal path', async () => {
    await renderCard()
    fireEvent.click(screen.getByRole('button', { name: '跳到终端' }))
    expect(mocks.reveal).toHaveBeenCalledWith({
      repoId: 'repo-1',
      worktreeId: WT_A,
      tabId: 'tab1',
      leafId: LEAF
    })
  })

  it('hands reveal to the main window when rendered in the pop-out', async () => {
    await renderCard({}, ({ children }) => (
      <SessionCanvasRevealContext.Provider value={revealInMainWindow}>
        {children}
      </SessionCanvasRevealContext.Provider>
    ))
    fireEvent.click(screen.getByRole('button', { name: '跳到终端' }))
    expect(mocks.reveal).not.toHaveBeenCalled()
    expect(mocks.revealAgent).toHaveBeenCalledWith({
      repoId: 'repo-1',
      worktreeId: WT_A,
      tabId: 'tab1',
      leafId: LEAF
    })
  })

  it('opens the composer and sends a message', async () => {
    await renderCard()
    fireEvent.click(screen.getByRole('button', { name: '发消息' }))
    const field = screen.getByRole('textbox', { name: '给这个会话发消息' })
    fireEvent.change(field, { target: { value: 'also add a test' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(mocks.sendPrompt).toHaveBeenCalledWith({ paneKey: PANE_KEY, text: 'also add a test' })
  })

  it('closes only this pane when the agent is not working', async () => {
    await renderCard({ state: 'done' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '关闭终端' }))
    })
    expect(mocks.closePane).toHaveBeenCalledWith({ paneKey: PANE_KEY })
  })

  it('asks through the running-terminal confirmation before closing a working agent', async () => {
    await renderCard()
    fireEvent.click(screen.getByRole('button', { name: '关闭终端' }))
    const request = useRunningTerminalCloseConfirmStore.getState().runningTerminalCloseConfirm
    expect(request).toMatchObject({ terminalTabId: 'tab1', copyKind: 'agent' })
    expect(mocks.closePane).not.toHaveBeenCalled()
    await act(async () => {
      useRunningTerminalCloseConfirmStore.getState().confirmRunningTerminalClose()
    })
    expect(mocks.closePane).toHaveBeenCalledWith({ paneKey: PANE_KEY })
  })

  it('skips the confirmation when the user opted out of it', async () => {
    mocks.state.settings = { skipCloseTerminalWithRunningProcessConfirm: true }
    await renderCard()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '关闭终端' }))
    })
    expect(useRunningTerminalCloseConfirmStore.getState().runningTerminalCloseConfirm).toBeNull()
    expect(mocks.closePane).toHaveBeenCalledWith({ paneKey: PANE_KEY })
  })

  it('marks a remote session on a disconnected host as unverifiable, never ended', async () => {
    mocks.state.sshConnectionStates = new Map([['ssh-1', { status: 'disconnected' }]])
    mocks.state.sshTargetLabels = new Map([['ssh-1', 'build-box']])
    await renderCard({ connectionId: 'ssh-1', state: 'done' })
    expect(screen.getByText('无法确认')).toBeTruthy()
    expect(screen.queryByText('已完成')).toBeNull()
    expect(screen.getByLabelText('SSH host · build-box')).toBeTruthy()
    expect(screen.getByRole('button', { name: '关闭终端' }).getAttribute('aria-description')).toBe(
      '关闭终端（主机连接中断，关闭结果无法确认）'
    )
  })

  it('shows the host badge without the unverifiable label while connected', async () => {
    mocks.state.sshConnectionStates = new Map([['ssh-1', { status: 'connected' }]])
    await renderCard({ connectionId: 'ssh-1' })
    expect(screen.queryByText('无法确认')).toBeNull()
    expect(screen.getByLabelText('SSH host · ssh-1')).toBeTruthy()
  })
})
