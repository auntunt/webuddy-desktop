import { describe, expect, it, vi } from 'vitest'

const { handlers, refusal } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  refusal: vi.fn((_event: unknown): string | null => '只有主窗口或会话画布窗口可以执行此操作。')
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: {
    removeHandler: vi.fn(),
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn)
  }
}))
vi.mock('./session-canvas-sender-trust', () => ({ sessionCanvasSenderRefusal: refusal }))

import { registerSessionCanvasActionHandlers } from './session-canvas-actions'
import { registerSessionCanvasDataHandlers } from './session-canvas-data'

const getTerminalHandleForPaneKey = vi.fn(() => 'term_a')
const getOrchestrationDb = vi.fn()
const runtime = { getTerminalHandleForPaneKey, getOrchestrationDb }

describe('session canvas IPC sender authority', () => {
  it('refuses every canvas channel for an untrusted renderer without touching the runtime', async () => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: handlers only reach the two stubbed runtime methods, and refusal short-circuits both.
    const stub = runtime as never
    registerSessionCanvasActionHandlers(stub)
    registerSessionCanvasDataHandlers(stub, { userDataDir: '/tmp' })
    const channels = [
      'sessionCanvas:sendPrompt',
      'sessionCanvas:closePane',
      'sessionCanvas:supervise',
      'sessionCanvas:listExternalSessions',
      'sessionCanvas:listMessages',
      'sessionCanvas:recordPassAlong'
    ]
    const dashboardEvent = { sender: { id: 7 } }
    for (const channel of channels) {
      await expect(
        handlers.get(channel)!(dashboardEvent, { paneKey: 'p', text: 'x' })
      ).resolves.toEqual({
        ok: false,
        reason: '只有主窗口或会话画布窗口可以执行此操作。'
      })
    }
    expect(refusal).toHaveBeenCalledTimes(channels.length)
    expect(getTerminalHandleForPaneKey).not.toHaveBeenCalled()
    expect(getOrchestrationDb).not.toHaveBeenCalled()
  })
})
