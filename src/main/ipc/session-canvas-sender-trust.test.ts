import { describe, expect, it, vi } from 'vitest'

const { isTrustedMock, popout } = vi.hoisted(() => ({
  isTrustedMock: vi.fn((_sender: unknown) => false),
  popout: { isRenderer: vi.fn((_sender: unknown) => false) }
}))

vi.mock('./ui', () => ({ isTrustedUIRenderer: isTrustedMock }))
vi.mock('../window/session-canvas-popout-window', () => ({ sessionCanvasPopout: popout }))

import { sessionCanvasSenderRefusal } from './session-canvas-sender-trust'

function event(sender: { mainFrame: object }, frame: object = sender.mainFrame) {
  return { sender, senderFrame: frame }
}

const mainSender = { mainFrame: { id: 'main' } }
const canvasPopoutSender = { mainFrame: { id: 'canvas' } }
const dashboardPopoutSender = { mainFrame: { id: 'dashboard' } }

isTrustedMock.mockImplementation((sender) => sender === mainSender)
popout.isRenderer.mockImplementation((sender) => sender === canvasPopoutSender)

describe('sessionCanvasSenderRefusal', () => {
  it('admits the main window and the canvas pop-out main frames', () => {
    expect(sessionCanvasSenderRefusal(event(mainSender))).toBeNull()
    expect(sessionCanvasSenderRefusal(event(canvasPopoutSender))).toBeNull()
  })

  it('refuses the dashboard pop-out and any other renderer with a reason', () => {
    expect(sessionCanvasSenderRefusal(event(dashboardPopoutSender))).toBe(
      '只有主窗口或会话画布窗口可以执行此操作。'
    )
  })

  it('refuses subframes of a trusted window', () => {
    expect(sessionCanvasSenderRefusal(event(mainSender, { id: 'iframe' }))).toBe(
      '请求必须来自当前窗口。'
    )
  })
})
