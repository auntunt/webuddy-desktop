import { ipcRenderer } from 'electron'
import type {
  SessionCanvasClosePaneArgs,
  SessionCanvasClosePaneResult,
  SessionCanvasSendPromptArgs,
  SessionCanvasSendPromptResult,
  SessionCanvasSuperviseArgs,
  SessionCanvasSuperviseResult
} from '../../shared/session-canvas-actions'
import type {
  SessionCanvasListExternalSessionsResult,
  SessionCanvasListMessagesArgs,
  SessionCanvasListMessagesResult,
  SessionCanvasRecordPassAlongArgs,
  SessionCanvasRecordPassAlongResult
} from '../../shared/session-canvas-types'
import type { PreloadApi } from '../api-types'

export const sessionCanvasApi = {
  sendPrompt: (args: SessionCanvasSendPromptArgs): Promise<SessionCanvasSendPromptResult> =>
    ipcRenderer.invoke('sessionCanvas:sendPrompt', args),
  closePane: (args: SessionCanvasClosePaneArgs): Promise<SessionCanvasClosePaneResult> =>
    ipcRenderer.invoke('sessionCanvas:closePane', args),
  supervise: (args: SessionCanvasSuperviseArgs): Promise<SessionCanvasSuperviseResult> =>
    ipcRenderer.invoke('sessionCanvas:supervise', args),
  listExternalSessions: (): Promise<SessionCanvasListExternalSessionsResult> =>
    ipcRenderer.invoke('sessionCanvas:listExternalSessions'),
  listMessages: (args: SessionCanvasListMessagesArgs): Promise<SessionCanvasListMessagesResult> =>
    ipcRenderer.invoke('sessionCanvas:listMessages', args),
  recordPassAlong: (
    args: SessionCanvasRecordPassAlongArgs
  ): Promise<SessionCanvasRecordPassAlongResult> =>
    ipcRenderer.invoke('sessionCanvas:recordPassAlong', args)
} satisfies PreloadApi['sessionCanvas']
