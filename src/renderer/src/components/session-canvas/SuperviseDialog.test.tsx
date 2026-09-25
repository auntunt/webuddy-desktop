// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { makeEntry } from './session-graph-test-fixtures'

const mocks = vi.hoisted(() => ({
  supervise: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn()
}))
vi.mock('sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess, warning: mocks.toastWarning }
}))

import { SuperviseDialog } from './SuperviseDialog'

const connection = {
  from: makeEntry('a', { terminalTitle: 'Coordinator' }),
  to: makeEntry('b', { terminalTitle: 'Worker' })
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { sessionCanvas: { supervise: mocks.supervise } }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(target: typeof connection = connection): {
  onOpenChange: ReturnType<typeof vi.fn>
} {
  const onOpenChange = vi.fn()
  render(<SuperviseDialog connection={target} onOpenChange={onOpenChange} />)
  return { onOpenChange }
}

function taskField(): HTMLElement {
  return screen.getByRole('textbox', { name: '任务说明' })
}

function submitButton(): HTMLElement {
  return screen.getByRole('button', { name: /派发/ })
}

describe('SuperviseDialog', () => {
  it('requires a task before submitting', async () => {
    renderDialog()
    expect(submitButton()).toHaveProperty('disabled', true)
    fireEvent.change(taskField(), { target: { value: '   ' } })
    expect(submitButton()).toHaveProperty('disabled', true)
    await act(async () => {
      fireEvent.keyDown(taskField(), { key: 'Enter', metaKey: true, ctrlKey: true })
    })
    expect(mocks.supervise).not.toHaveBeenCalled()
  })

  it('dispatches A as coordinator of B and closes on success', async () => {
    mocks.supervise.mockResolvedValue({ ok: true, dispatchId: 'd-1' })
    const { onOpenChange } = renderDialog()
    fireEvent.change(taskField(), { target: { value: '  修复登录测试  ' } })
    await act(async () => {
      fireEvent.click(submitButton())
    })
    expect(mocks.supervise).toHaveBeenCalledWith({
      coordinatorPaneKey: 'a',
      workerPaneKey: 'b',
      task: '修复登录测试'
    })
    expect(mocks.toastSuccess).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('disables submit while the dispatch is pending', async () => {
    let resolve: (value: unknown) => void = () => {}
    mocks.supervise.mockReturnValue(new Promise((r) => (resolve = r)))
    renderDialog()
    fireEvent.change(taskField(), { target: { value: 'task' } })
    await act(async () => {
      fireEvent.click(submitButton())
    })
    expect(submitButton()).toHaveProperty('disabled', true)
    expect(submitButton().textContent).toContain('派发中')
    fireEvent.click(submitButton())
    expect(mocks.supervise).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve({ ok: true, dispatchId: 'd' })
    })
  })

  it('toasts the server reason verbatim and stays open on failure', async () => {
    mocks.supervise.mockResolvedValue({ ok: false, reason: 'B 不在同一个 worktree' })
    const { onOpenChange } = renderDialog()
    fireEvent.change(taskField(), { target: { value: 'task' } })
    await act(async () => {
      fireEvent.click(submitButton())
    })
    expect(mocks.toastError).toHaveBeenCalledWith('B 不在同一个 worktree')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(taskField()).toHaveProperty('value', 'task')
  })

  it('warns that an unknown outcome may have been delivered, with the dispatch id', async () => {
    mocks.supervise.mockResolvedValue({ ok: false, reason: 'timeout', dispatchId: 'd-9' })
    const { onOpenChange } = renderDialog()
    fireEvent.change(taskField(), { target: { value: 'task' } })
    await act(async () => {
      fireEvent.click(submitButton())
    })
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      expect.stringContaining('可能已送达'),
      expect.objectContaining({ description: expect.stringContaining('d-9') })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('disables dispatch while the worker host cannot be verified', () => {
    useAppStore.setState({
      sshConnectionStates: new Map([
        ['conn-1', { targetId: 't', status: 'disconnected', error: null, reconnectAttempt: 0 }]
      ])
    })
    renderDialog({
      ...connection,
      to: makeEntry('b', { terminalTitle: 'Worker', connectionId: 'conn-1' })
    })
    fireEvent.change(taskField(), { target: { value: '修复登录' } })
    expect(submitButton()).toHaveProperty('disabled', true)
    expect(screen.getByText(/无法确认「Worker」所在主机的连接/)).toBeTruthy()
    useAppStore.setState({ sshConnectionStates: new Map() })
  })
})
