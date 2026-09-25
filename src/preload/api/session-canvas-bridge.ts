import { ipcRenderer } from 'electron'
import type {
  SessionCanvasSendPromptArgs,
  SessionCanvasSendPromptResult,
  SessionCanvasSuperviseArgs,
  SessionCanvasSuperviseResult
} from '../../shared/session-canvas-actions'
import type { PreloadApi } from '../api-types'

export const sessionCanvasApi = {
  sendPrompt: (args: SessionCanvasSendPromptArgs): Promise<SessionCanvasSendPromptResult> =>
    ipcRenderer.invoke('sessionCanvas:sendPrompt', args),
  supervise: (args: SessionCanvasSuperviseArgs): Promise<SessionCanvasSuperviseResult> =>
    ipcRenderer.invoke('sessionCanvas:supervise', args)
} satisfies PreloadApi['sessionCanvas']
