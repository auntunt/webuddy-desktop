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
import type { DashboardRevealAgentArgs } from '../../shared/dashboard-snapshot'
import type { SessionCanvasPopoutSnapshot } from '../../shared/session-canvas-popout'
import type { PreloadApi } from '../api-types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

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
    ipcRenderer.invoke('sessionCanvas:recordPassAlong', args),
  openPopout: (): Promise<void> => ipcRenderer.invoke('sessionCanvasPopout:open'),
  publishSnapshot: (snapshot: SessionCanvasPopoutSnapshot): Promise<void> =>
    ipcRenderer.invoke('sessionCanvas:publishSnapshot', snapshot),
  getPopoutOpen: (): Promise<boolean> => ipcRenderer.invoke('sessionCanvas:getPopoutOpen'),
  onPopoutOpenChanged: (callback: (open: boolean) => void): (() => void) =>
    subscribe('sessionCanvas:popoutOpenChanged', callback),
  onSnapshotRequested: (callback: () => void): (() => void) =>
    subscribe('sessionCanvas:snapshotRequested', () => callback()),
  onRevealAgent: (callback: (args: DashboardRevealAgentArgs) => void): (() => void) =>
    subscribe('ui:revealSessionCanvasAgent', callback),
  requestSnapshot: (): Promise<void> => ipcRenderer.invoke('sessionCanvas:requestSnapshot'),
  onSnapshot: (callback: (snapshot: SessionCanvasPopoutSnapshot) => void): (() => void) =>
    subscribe('sessionCanvas:snapshot', callback),
  revealAgent: (args: DashboardRevealAgentArgs): Promise<void> =>
    ipcRenderer.invoke('sessionCanvasPopout:revealAgent', args)
} satisfies PreloadApi['sessionCanvas']
