// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sendPrompt: vi.fn(), toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }))

import { SessionMessageComposer } from './SessionMessageComposer'

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

function field(): HTMLElement {
  return screen.getByRole('textbox', { name: '给这个会话发消息' })
}

describe('SessionMessageComposer', () => {
  it('sends the typed message with Enter and clears the field', async () => {
    mocks.sendPrompt.mockResolvedValue({ ok: true })
    render(<SessionMessageComposer paneKey="tab:leaf" />)
    fireEvent.change(field(), { target: { value: '  run the tests  ' } })
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' })
    })
    expect(mocks.sendPrompt).toHaveBeenCalledWith({ paneKey: 'tab:leaf', text: 'run the tests' })
    expect(field()).toHaveProperty('value', '')
  })

  it('ignores empty messages', async () => {
    render(<SessionMessageComposer paneKey="tab:leaf" />)
    fireEvent.change(field(), { target: { value: '   ' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送' }))
    })
    expect(mocks.sendPrompt).not.toHaveBeenCalled()
  })

  it('keeps the text and toasts the reason when the send fails', async () => {
    mocks.sendPrompt.mockResolvedValue({ ok: false, reason: '找不到会话' })
    render(<SessionMessageComposer paneKey="tab:leaf" />)
    fireEvent.change(field(), { target: { value: 'hello' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发送' }))
    })
    expect(mocks.toastError).toHaveBeenCalledWith('找不到会话')
    expect(field()).toHaveProperty('value', 'hello')
  })
})
