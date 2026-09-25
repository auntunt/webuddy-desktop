export type SessionCanvasExternalSession = {
  key: string
  agent: string
  agentLabel: string
  title: string
  cwd: string | null
  updatedAt: string | null
  filePath: string
  providerSessionId: string
  preview: { role: string; text: string; timestamp: string | null }[]
}

export type SessionCanvasMessage = {
  fromPaneKey: string | null
  toPaneKey: string | null
  fromHandle: string | null
  toHandle: string | null
  at: number
  kind: 'dispatch' | 'mailbox' | 'pass-along'
}

export type SessionCanvasListExternalSessionsResult =
  | { ok: true; sessions: SessionCanvasExternalSession[] }
  | { ok: false; reason: string }

export type SessionCanvasListMessagesArgs = { sinceMs: number }

export type SessionCanvasListMessagesResult =
  | { ok: true; messages: SessionCanvasMessage[] }
  | { ok: false; reason: string }

export type SessionCanvasRecordPassAlongArgs = { fromPaneKey: string; toPaneKey: string }

// Why: brief signature says `{ ok: true }`, but constraints.md's IPC contract requires every new
// IPC to return `{ ok: false; reason }` on failure instead of throwing to the renderer.
export type SessionCanvasRecordPassAlongResult = { ok: true } | { ok: false; reason: string }
