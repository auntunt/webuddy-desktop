import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import type { SessionCanvasMessage } from '../../../../shared/session-canvas-types'
import { buildAgentRowLineageTree } from '../dashboard/agent-row-lineage-model'
import { liveNodeId } from './session-graph-membership-model'
import { buildSameFileEdges } from './session-same-file-edges-model'
import type { CanvasSession, SessionGraphEdge } from './session-graph-types'

export const MESSAGE_EDGE_ANIMATION_WINDOW_MS = 10 * 60_000

/** childNodeId → parentNodeId for panes started by another pane (same rule as the dashboard). */
export function resolveStartedParents(liveEntries: AgentStatusEntry[]): Map<string, string> {
  const { childrenByParentPaneKey } = buildAgentRowLineageTree(
    liveEntries.map((entry) => ({ paneKey: entry.paneKey, entry }))
  )
  const parents = new Map<string, string>()
  for (const [parentPaneKey, children] of childrenByParentPaneKey) {
    for (const child of children) {
      parents.set(liveNodeId(child.paneKey), liveNodeId(parentPaneKey))
    }
  }
  return parents
}

function buildStartedEdges(parents: Map<string, string>, visible: Set<string>): SessionGraphEdge[] {
  const edges: SessionGraphEdge[] = []
  for (const [child, parent] of parents) {
    if (visible.has(child) && visible.has(parent)) {
      edges.push({
        id: `started:${parent}->${child}`,
        source: parent,
        target: child,
        kind: 'started',
        animated: false
      })
    }
  }
  return edges
}

function buildMessagedEdges(
  messages: SessionCanvasMessage[],
  liveEntries: AgentStatusEntry[],
  visible: Set<string>,
  now: number
): SessionGraphEdge[] {
  const paneKeyByHandle = new Map<string, string>()
  for (const entry of liveEntries) {
    if (entry.terminalHandle && !paneKeyByHandle.has(entry.terminalHandle)) {
      paneKeyByHandle.set(entry.terminalHandle, entry.paneKey)
    }
  }
  // Why: mailbox rows only carry handles; pass-along rows carry pane keys.
  const resolve = (paneKey: string | null, handle: string | null): string | null => {
    const key = paneKey ?? (handle ? paneKeyByHandle.get(handle) : undefined)
    return key ? liveNodeId(key) : null
  }
  const latestByPair = new Map<string, { source: string; target: string; at: number }>()
  for (const message of messages) {
    const source = resolve(message.fromPaneKey, message.fromHandle)
    const target = resolve(message.toPaneKey, message.toHandle)
    if (!source || !target || source === target || !visible.has(source) || !visible.has(target)) {
      continue
    }
    const pair = `${source}->${target}`
    const current = latestByPair.get(pair)
    if (!current || message.at > current.at) {
      latestByPair.set(pair, { source, target, at: message.at })
    }
  }
  return [...latestByPair.entries()].map(([pair, { source, target, at }]) => ({
    id: `messaged:${pair}`,
    source,
    target,
    kind: 'messaged',
    animated: now - at <= MESSAGE_EDGE_ANIMATION_WINDOW_MS
  }))
}

export function buildSessionEdges(args: {
  sessions: CanvasSession[]
  startedParents: Map<string, string>
  liveEntries: AgentStatusEntry[]
  messages: SessionCanvasMessage[]
  changedFilesByWorktree: Record<string, string[]>
  now: number
}): SessionGraphEdge[] {
  const visible = new Set(args.sessions.map((session) => session.id))
  return [
    ...buildStartedEdges(args.startedParents, visible),
    ...buildMessagedEdges(args.messages, args.liveEntries, visible, args.now),
    ...buildSameFileEdges(args.sessions, args.changedFilesByWorktree)
  ]
}
