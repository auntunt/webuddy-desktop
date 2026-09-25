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

export type SessionCanvasApi = {
  sendPrompt: (args: SessionCanvasSendPromptArgs) => Promise<SessionCanvasSendPromptResult>
  closePane: (args: SessionCanvasClosePaneArgs) => Promise<SessionCanvasClosePaneResult>
  supervise: (args: SessionCanvasSuperviseArgs) => Promise<SessionCanvasSuperviseResult>
  listExternalSessions: () => Promise<SessionCanvasListExternalSessionsResult>
  listMessages: (args: SessionCanvasListMessagesArgs) => Promise<SessionCanvasListMessagesResult>
  recordPassAlong: (
    args: SessionCanvasRecordPassAlongArgs
  ) => Promise<SessionCanvasRecordPassAlongResult>
}
