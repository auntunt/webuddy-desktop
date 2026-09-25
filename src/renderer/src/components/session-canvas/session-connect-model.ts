import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { truncateByCodePoints } from './pass-along-prompt-model'
import type { SessionGraph } from './session-graph-types'

/** The dialog shows a readable slice; the full (≤4000-char) prompt is what gets sent. */
export const PASS_ALONG_PREVIEW_MAX_CHARS = 600

const LIVE_NODE_PREFIX = 'live:'

export type SessionConnectionEnds = { source: string; target: string }

export type ResolvedSessionConnection = { from: AgentStatusEntry; to: AgentStatusEntry }

/** Only Webuddy-owned sessions can be wired: external cards are read-only. */
export function isLiveSessionConnection({ source, target }: SessionConnectionEnds): boolean {
  return (
    source !== target && source.startsWith(LIVE_NODE_PREFIX) && target.startsWith(LIVE_NODE_PREFIX)
  )
}

export function resolveSessionConnection(
  graph: SessionGraph,
  connection: SessionConnectionEnds
): ResolvedSessionConnection | null {
  if (!isLiveSessionConnection(connection)) {
    return null
  }
  const entryOf = (id: string): AgentStatusEntry | null => {
    const node = graph.nodes.find((candidate) => candidate.id === id)
    return node && 'kind' in node.data && node.data.kind === 'live' ? node.data.entry : null
  }
  const from = entryOf(connection.source)
  const to = entryOf(connection.target)
  return from && to ? { from, to } : null
}

export function previewPassAlongText(text: string): string {
  return truncateByCodePoints(text, PASS_ALONG_PREVIEW_MAX_CHARS)
}
