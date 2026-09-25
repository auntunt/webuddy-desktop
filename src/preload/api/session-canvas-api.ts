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

export type SessionCanvasApi = {
  sendPrompt: (args: SessionCanvasSendPromptArgs) => Promise<SessionCanvasSendPromptResult>
  closePane: (args: SessionCanvasClosePaneArgs) => Promise<SessionCanvasClosePaneResult>
  supervise: (args: SessionCanvasSuperviseArgs) => Promise<SessionCanvasSuperviseResult>
  listExternalSessions: () => Promise<SessionCanvasListExternalSessionsResult>
  listMessages: (args: SessionCanvasListMessagesArgs) => Promise<SessionCanvasListMessagesResult>
  recordPassAlong: (
    args: SessionCanvasRecordPassAlongArgs
  ) => Promise<SessionCanvasRecordPassAlongResult>
  // Pop-out window: the main window produces snapshots, the pop-out consumes them.
  openPopout: () => Promise<void>
  publishSnapshot: (snapshot: SessionCanvasPopoutSnapshot) => Promise<void>
  getPopoutOpen: () => Promise<boolean>
  onPopoutOpenChanged: (callback: (open: boolean) => void) => () => void
  onSnapshotRequested: (callback: () => void) => () => void
  onRevealAgent: (callback: (args: DashboardRevealAgentArgs) => void) => () => void
  requestSnapshot: () => Promise<void>
  onSnapshot: (callback: (snapshot: SessionCanvasPopoutSnapshot) => void) => () => void
  revealAgent: (args: DashboardRevealAgentArgs) => Promise<void>
}
