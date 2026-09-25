// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sendPrompt: vi.fn(), toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }))

import { SessionApprovalActions } from './SessionApprovalActions'

const ESC = String.fromCharCode(27)
const approval = {
  title: 'Allow Bash?',
  detail: 'rm -rf build',
  options: [
    { label: 'Allow', send: '1' },
    { label: 'Deny', send: ESC }
  ]
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { sessionCanvas: { sendPrompt: mocks.sendPrompt } }
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SessionApprovalActions', () => {
  it('shows the request summary and each option', () => {
    render(<SessionApprovalActions paneKey="tab:leaf" approval={approval} />)
    expect(screen.getByText('Allow Bash?')).toBeTruthy()
    expect(screen.getByText('rm -rf build')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()
  })

  it('writes the chosen option key raw to the session', async () => {
    mocks.sendPrompt.mockResolvedValue({ ok: true })
    render(<SessionApprovalActions paneKey="tab:leaf" approval={approval} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    })
    expect(mocks.sendPrompt).toHaveBeenCalledWith({ paneKey: 'tab:leaf', text: ESC, keys: true })
    expect(screen.getByRole('button', { name: 'Allow' })).toHaveProperty('disabled', true)
  })

  it('offers a retry when the request lingers after a sent choice', async () => {
    vi.useFakeTimers()
    try {
      mocks.sendPrompt.mockResolvedValue({ ok: true })
      render(<SessionApprovalActions paneKey="tab:leaf" approval={approval} />)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
      })
      expect(screen.getByRole('button', { name: 'Allow' })).toHaveProperty('disabled', true)
      await act(async () => {
        vi.advanceTimersByTime(8000)
      })
      expect(screen.getByText('没有反应？可以重试')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Allow' })).toHaveProperty('disabled', false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('toasts the reason and re-enables the options when the send fails', async () => {
    mocks.sendPrompt.mockResolvedValue({ ok: false, reason: '终端当前不接受输入。' })
    render(<SessionApprovalActions paneKey="tab:leaf" approval={approval} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    })
    expect(mocks.toastError).toHaveBeenCalledWith('终端当前不接受输入。')
    expect(screen.getByRole('button', { name: 'Allow' })).toHaveProperty('disabled', false)
  })

  it('disables the options when the session cannot be verified', () => {
    render(<SessionApprovalActions paneKey="tab:leaf" approval={approval} disabled />)
    expect(screen.getByRole('button', { name: 'Allow' })).toHaveProperty('disabled', true)
  })
})
