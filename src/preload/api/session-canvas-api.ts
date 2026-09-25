import type {
  SessionCanvasSendPromptArgs,
  SessionCanvasSendPromptResult,
  SessionCanvasSuperviseArgs,
  SessionCanvasSuperviseResult
} from '../../shared/session-canvas-actions'

export type SessionCanvasApi = {
  sendPrompt: (args: SessionCanvasSendPromptArgs) => Promise<SessionCanvasSendPromptResult>
  supervise: (args: SessionCanvasSuperviseArgs) => Promise<SessionCanvasSuperviseResult>
}
