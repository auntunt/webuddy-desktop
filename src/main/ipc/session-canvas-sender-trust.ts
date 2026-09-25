import type { IpcMainInvokeEvent } from 'electron'
import { sessionCanvasPopout } from '../window/session-canvas-popout-window'
import { isTrustedUIRenderer } from './ui'

type SessionCanvasSenderEvent = Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>

/** Canvas IPC is limited to the main window and the canvas pop-out; null means admitted. */
export function sessionCanvasSenderRefusal(event: SessionCanvasSenderEvent): string | null {
  if (event.senderFrame !== event.sender.mainFrame) {
    return '请求必须来自当前窗口。'
  }
  // Why: the dashboard pop-out and other renderers must not drive terminals through the canvas.
  return isTrustedUIRenderer(event.sender) || sessionCanvasPopout.isRenderer(event.sender)
    ? null
    : '只有主窗口或会话画布窗口可以执行此操作。'
}
