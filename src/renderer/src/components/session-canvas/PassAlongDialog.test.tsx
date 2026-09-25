// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { makeEntry } from './session-graph-test-fixtures'

const mocks = vi.hoisted(() => ({
  sendPrompt: vi.fn(),
  recordPassAlong: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn()
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }))

import { PassAlongDialog } from './PassAlongDialog'

const connection = {
  from: makeEntry('a', { terminalTitle: 'Coordinator', lastCompletedAssistantMessage: '测试全绿' }),
  to: makeEntry('b', { terminalTitle: 'Worker' })
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      sessionCanvas: { sendPrompt: mocks.sendPrompt, recordPassAlong: mocks.recordPassAlong }
    }
  })
  mocks.sendPrompt.mockResolvedValue({ ok: true })
  mocks.recordPassAlong.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(target: typeof connection = connection): {
  onOpenChange: ReturnType<typeof vi.fn>
  onSent: ReturnType<typeof vi.fn>
} {
  const onOpenChange = vi.fn()
  const onSent = vi.fn()
  render(<PassAlongDialog connection={target} onOpenChange={onOpenChange} onSent={onSent} />)
  return { onOpenChange, onSent }
}

describe('PassAlongDialog', () => {
  it('previews the composed prompt including the note', () => {
    renderDialog()
    fireEvent.change(screen.getByRole('textbox', { name: '附言（可选）' }), {
      target: { value: '请复核' }
    })
    const preview = screen.getByTestId('pass-along-preview').textContent
    expect(preview).toContain('来自〈Coordinator〉的结果：')
    expect(preview).toContain('测试全绿')
    expect(preview).toContain('附言：请复核')
  })

  it('sends to B, records the pass-along, refreshes and toasts', async () => {
    const { onOpenChange, onSent } = renderDialog()
    fireEvent.change(screen.getByRole('textbox', { name: '附言（可选）' }), {
      target: { value: '请复核' }
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '传话' }))
    })
    expect(mocks.sendPrompt).toHaveBeenCalledWith({
      paneKey: 'b',
      text: '来自〈Coordinator〉的结果：\n测试全绿\n\n附言：请复核'
    })
    expect(mocks.recordPassAlong).toHaveBeenCalledWith({ fromPaneKey: 'a', toPaneKey: 'b' })
    expect(onSent).toHaveBeenCalled()
    expect(mocks.toastSuccess).toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps the dialog open and skips the log when the send fails', async () => {
    mocks.sendPrompt.mockResolvedValue({ ok: false, reason: '找不到会话' })
    const { onOpenChange, onSent } = renderDialog()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '传话' }))
    })
    expect(mocks.toastError).toHaveBeenCalledWith('找不到会话')
    expect(mocks.recordPassAlong).not.toHaveBeenCalled()
    expect(onSent).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('still closes when only the log write fails', async () => {
    mocks.recordPassAlong.mockResolvedValue({ ok: false, reason: 'disk full' })
    const { onOpenChange } = renderDialog()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '传话' }))
    })
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('disk full'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('disables sending and says why when A has no result yet', () => {
    renderDialog({ ...connection, from: makeEntry('a', { terminalTitle: 'Coordinator' }) })
    expect(screen.getByRole('button', { name: '传话' })).toHaveProperty('disabled', true)
    expect(screen.getByText('「Coordinator」还没有可传的结果。')).toBeTruthy()
  })

  it('disables sending while either host cannot be verified', () => {
    useAppStore.setState({
      sshConnectionStates: new Map([
        ['conn-1', { targetId: 't', status: 'disconnected', error: null, reconnectAttempt: 0 }]
      ])
    })
    renderDialog({
      ...connection,
      to: makeEntry('b', { terminalTitle: 'Worker', connectionId: 'conn-1' })
    })
    expect(screen.getByRole('button', { name: '传话' })).toHaveProperty('disabled', true)
    expect(screen.getByText(/无法确认「Worker」所在主机的连接/)).toBeTruthy()
    cleanup()
    renderDialog({
      ...connection,
      from: { ...connection.from, connectionId: 'conn-1' }
    })
    expect(screen.getByRole('button', { name: '传话' })).toHaveProperty('disabled', true)
    expect(screen.getByText(/无法确认「Coordinator」所在主机的连接/)).toBeTruthy()
    useAppStore.setState({ sshConnectionStates: new Map() })
  })
})
