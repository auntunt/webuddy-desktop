import type {
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
  supervise: (args: SessionCanvasSuperviseArgs) => Promise<SessionCanvasSuperviseResult>
  listExternalSessions: () => Promise<SessionCanvasListExternalSessionsResult>
  listMessages: (args: SessionCanvasListMessagesArgs) => Promise<SessionCanvasListMessagesResult>
  recordPassAlong: (
    args: SessionCanvasRecordPassAlongArgs
  ) => Promise<SessionCanvasRecordPassAlongResult>
}
