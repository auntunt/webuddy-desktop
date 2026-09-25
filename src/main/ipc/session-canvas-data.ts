import { app, ipcMain } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { listAiVaultSessions } from '../ai-vault/cached-session-list'
import type { AiVaultListResult, AiVaultSession } from '../../shared/ai-vault-types'
import { AI_VAULT_AGENT_LABELS } from '../../shared/ai-vault-types'
import type { MessageRow } from '../runtime/orchestration/types'
import type {
  SessionCanvasExternalSession,
  SessionCanvasListExternalSessionsResult,
  SessionCanvasListMessagesArgs,
  SessionCanvasListMessagesResult,
  SessionCanvasMessage,
  SessionCanvasRecordPassAlongArgs,
  SessionCanvasRecordPassAlongResult
} from '../../shared/session-canvas-types'
import {
  appendPassAlongLogEntry,
  passAlongLogPath,
  readPassAlongMessages
} from './session-canvas-pass-along-log'
import { sessionCanvasSenderRefusal } from './session-canvas-sender-trust'

export const EXTERNAL_SESSION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const EXTERNAL_SESSION_MAX_COUNT = 200
export const EXTERNAL_SESSION_PREVIEW_COUNT = 3
export const EXTERNAL_SESSION_PREVIEW_MAX_CHARS = 300
// Why: read-only mailbox projection, bounded so a busy run can't make every poll scan the whole table.
export const MAILBOX_PROJECTION_MAX_ROWS = 500

export type SessionCanvasDataDeps = {
  listAiVaultSessions: (args: { unlimited: boolean }) => Promise<AiVaultListResult>
  getMailboxInbox: (limit: number) => MessageRow[]
  passAlongLogFilePath: string
  now?: () => number
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

function sessionRecencyMs(session: AiVaultSession): number {
  const parsed = Date.parse(session.updatedAt ?? session.modifiedAt)
  return Number.isNaN(parsed) ? 0 : parsed
}

function toExternalSession(session: AiVaultSession): SessionCanvasExternalSession {
  return {
    key: session.id,
    agent: session.agent,
    agentLabel: AI_VAULT_AGENT_LABELS[session.agent],
    title: session.title,
    cwd: session.cwd,
    updatedAt: session.updatedAt,
    filePath: session.filePath,
    providerSessionId: session.sessionId,
    preview: session.previewMessages.slice(-EXTERNAL_SESSION_PREVIEW_COUNT).map((message) => ({
      role: message.role,
      text: truncate(message.text, EXTERNAL_SESSION_PREVIEW_MAX_CHARS),
      timestamp: message.timestamp
    }))
  }
}

function messageDeliveredAtMs(message: MessageRow): number | null {
  if (!message.delivered_at) {
    return null
  }
  const parsed = Date.parse(message.delivered_at)
  return Number.isNaN(parsed) ? null : parsed
}

function toMailboxMessage(message: MessageRow): SessionCanvasMessage | null {
  const at = messageDeliveredAtMs(message)
  if (at === null) {
    return null
  }
  return {
    // Why: `sender_pane_key` is recorded at send time and is public on the row;
    // there is no equivalent public reverse lookup from `to_handle` to a pane key.
    fromPaneKey: message.sender_pane_key ?? null,
    toPaneKey: null,
    fromHandle: message.from_handle,
    toHandle: message.to_handle,
    at,
    kind: 'mailbox'
  }
}

export function createSessionCanvasData(deps: SessionCanvasDataDeps): {
  listExternalSessions: () => Promise<SessionCanvasListExternalSessionsResult>
  listMessages: (args: SessionCanvasListMessagesArgs) => Promise<SessionCanvasListMessagesResult>
  recordPassAlong: (
    args: SessionCanvasRecordPassAlongArgs
  ) => Promise<SessionCanvasRecordPassAlongResult>
} {
  const now = deps.now ?? Date.now

  return {
    async listExternalSessions() {
      const { sessions } = await deps.listAiVaultSessions({ unlimited: false })
      const cutoff = now() - EXTERNAL_SESSION_WINDOW_MS
      const recent = sessions
        .filter((session) => sessionRecencyMs(session) >= cutoff)
        .sort((a, b) => sessionRecencyMs(b) - sessionRecencyMs(a))
        .slice(0, EXTERNAL_SESSION_MAX_COUNT)
      return { ok: true, sessions: recent.map(toExternalSession) }
    },

    async listMessages({ sinceMs }) {
      const mailbox = deps
        .getMailboxInbox(MAILBOX_PROJECTION_MAX_ROWS)
        .map(toMailboxMessage)
        .filter(
          (message): message is SessionCanvasMessage => message !== null && message.at >= sinceMs
        )
      const passAlong = (await readPassAlongMessages(deps.passAlongLogFilePath)).filter(
        (message) => message.at >= sinceMs
      )
      return { ok: true, messages: [...mailbox, ...passAlong].sort((a, b) => a.at - b.at) }
    },

    async recordPassAlong({ fromPaneKey, toPaneKey }) {
      await appendPassAlongLogEntry(deps.passAlongLogFilePath, {
        fromPaneKey,
        toPaneKey,
        at: now()
      })
      return { ok: true }
    }
  }
}

function toFailure(error: unknown): { ok: false; reason: string } {
  return { ok: false, reason: error instanceof Error ? error.message : String(error) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseListMessagesArgs(value: unknown): SessionCanvasListMessagesArgs | null {
  return isRecord(value) && typeof value.sinceMs === 'number' ? { sinceMs: value.sinceMs } : null
}

function parseRecordPassAlongArgs(value: unknown): SessionCanvasRecordPassAlongArgs | null {
  return isRecord(value) &&
    typeof value.fromPaneKey === 'string' &&
    typeof value.toPaneKey === 'string'
    ? { fromPaneKey: value.fromPaneKey, toPaneKey: value.toPaneKey }
    : null
}

/** Read-only projections for the canvas: external AI Vault sessions and the mailbox/pass-along message log. */
export function registerSessionCanvasDataHandlers(
  runtime: OrcaRuntimeService,
  options: { userDataDir?: string } = {}
): void {
  const data = createSessionCanvasData({
    listAiVaultSessions: (args) => listAiVaultSessions(args),
    getMailboxInbox: (limit) => runtime.getOrchestrationDb().getInbox(limit),
    passAlongLogFilePath: passAlongLogPath(options.userDataDir ?? app.getPath('userData'))
  })

  ipcMain.removeHandler('sessionCanvas:listExternalSessions')
  ipcMain.handle('sessionCanvas:listExternalSessions', async (event) => {
    const refusal = sessionCanvasSenderRefusal(event)
    return refusal ? toFailure(refusal) : data.listExternalSessions().catch(toFailure)
  })

  ipcMain.removeHandler('sessionCanvas:listMessages')
  ipcMain.handle('sessionCanvas:listMessages', async (event, value: unknown) => {
    const refusal = sessionCanvasSenderRefusal(event)
    if (refusal) {
      return toFailure(refusal)
    }
    const args = parseListMessagesArgs(value)
    return args ? data.listMessages(args).catch(toFailure) : toFailure('参数无效。')
  })

  ipcMain.removeHandler('sessionCanvas:recordPassAlong')
  ipcMain.handle('sessionCanvas:recordPassAlong', async (event, value: unknown) => {
    const refusal = sessionCanvasSenderRefusal(event)
    if (refusal) {
      return toFailure(refusal)
    }
    const args = parseRecordPassAlongArgs(value)
    return args ? data.recordPassAlong(args).catch(toFailure) : toFailure('参数无效。')
  })
}
