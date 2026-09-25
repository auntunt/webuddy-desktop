import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type {
  SessionCanvasExternalSession,
  SessionCanvasMessage
} from '../../../../shared/session-canvas-types'
import type { CanvasPoint } from './session-layout-model'

export type SessionCanvasFilters = {
  query: string
  /** Normalized agent ids (AI Vault naming); empty means all. */
  agents: string[]
  /** Live `AgentStatusState` values, plus `'external'` to keep read-only cards; empty means all. */
  states: string[]
  showExternal: boolean
  hideIdleOlderThanMs: number | null
}

export type SessionCanvasInputs = {
  liveEntries: AgentStatusEntry[]
  externalSessions: SessionCanvasExternalSession[]
  /** worktreeId → changed files relative to the repo root. */
  changedFilesByWorktree: Record<string, string[]>
  /** worktreeId → repo id; files are only compared within one repo. */
  repoIdByWorktree: Record<string, string>
  messages: SessionCanvasMessage[]
  /** Keyed by node id (`live:<paneKey>`, `ext:<key>`, `group:<id>`); relative to the parent group. */
  savedPositions: Record<string, CanvasPoint>
  filters: SessionCanvasFilters
  now: number
}

export type SessionNodeData =
  | { kind: 'live'; entry: AgentStatusEntry; repoLabel: string | null }
  | { kind: 'external'; session: SessionCanvasExternalSession; repoLabel: string | null }

export type SessionEdgeKind = 'started' | 'messaged' | 'same-file'

export type SessionGraphNode = {
  id: string
  type: 'live' | 'external' | 'group'
  position: CanvasPoint
  parentId?: string
  data: SessionNodeData | { label: string }
  /** Set on group nodes so React Flow can size the background region. */
  width?: number
  height?: number
}

export type SessionGraphEdge = {
  id: string
  source: string
  target: string
  kind: SessionEdgeKind
  animated: boolean
  files?: string[]
}

export type SessionGraph = { nodes: SessionGraphNode[]; edges: SessionGraphEdge[] }

/** A session that survived dedup and filters, with its resolved group. */
export type CanvasSession = {
  id: string
  groupId: string
  repoId: string | null
  data: SessionNodeData
}
