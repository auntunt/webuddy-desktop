import { buildSessionEdges, resolveStartedParents } from './session-graph-edges-model'
import {
  SESSION_CANVAS_OTHER_GROUP_ID,
  resolveCanvasMembership
} from './session-graph-membership-model'
import type {
  CanvasSession,
  SessionCanvasInputs,
  SessionGraph,
  SessionGraphNode
} from './session-graph-types'
import { type CanvasPoint, autoPlace, measureGroupSize } from './session-layout-model'

export { SESSION_CANVAS_OTHER_GROUP_ID } from './session-graph-membership-model'
export type {
  SessionCanvasFilters,
  SessionCanvasInputs,
  SessionEdgeKind,
  SessionGraph,
  SessionGraphEdge,
  SessionGraphNode,
  SessionNodeData
} from './session-graph-types'

const GROUP_GAP = 80

function compareGroups(a: [string, string], b: [string, string]): number {
  // Why: keep the catch-all group last so real projects lead the canvas.
  const aOther = a[0] === SESSION_CANVAS_OTHER_GROUP_ID
  const bOther = b[0] === SESSION_CANVAS_OTHER_GROUP_ID
  if (aOther !== bOther) {
    return aOther ? 1 : -1
  }
  return a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])
}

/** Saved, then previously rendered, positions win; the rest is auto-placed parents-first. */
function placeGroupMembers(
  members: CanvasSession[],
  inputs: SessionCanvasInputs,
  parents: Map<string, string>
): Map<string, CanvasPoint> {
  const placed = new Map<string, CanvasPoint>()
  const pending: CanvasSession[] = []
  for (const member of members) {
    const known = inputs.savedPositions[member.id] ?? inputs.previousPositions[member.id]
    if (known) {
      placed.set(member.id, known)
    } else {
      pending.push(member)
    }
  }
  const memberIds = new Set(members.map((member) => member.id))
  while (pending.length > 0) {
    // Place any member whose in-group parent is already placed; cycles fall back to the first pending.
    const readyIndex = pending.findIndex((member) => {
      const parent = parents.get(member.id)
      return !parent || !memberIds.has(parent) || placed.has(parent)
    })
    const [member] = pending.splice(Math.max(readyIndex, 0), 1)
    const parentId = parents.get(member.id)
    placed.set(member.id, autoPlace({ existing: placed, groupId: member.groupId, parentId }))
  }
  return placed
}

function groupChildOffset(node: SessionGraphNode | undefined): CanvasPoint {
  return node?.type === 'group' && 'label' in node.data && node.data.childOffset
    ? node.data.childOffset
    : { x: 0, y: 0 }
}

/**
 * Converts a rendered (React Flow) position back to the stored coordinate space used by
 * `savedPositions`/`previousPositions`, undoing a group's negative-child shift.
 */
export function toStoredPosition(
  graph: SessionGraph,
  nodeId: string,
  rendered: CanvasPoint
): CanvasPoint {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (node?.type === 'group') {
    const offset = groupChildOffset(node)
    return { x: rendered.x + offset.x, y: rendered.y + offset.y }
  }
  const offset = groupChildOffset(graph.nodes.find((candidate) => candidate.id === node?.parentId))
  return { x: rendered.x - offset.x, y: rendered.y - offset.y }
}

/** Last output positions in stored coordinates; feed back as `previousPositions` for stability. */
export function collectGraphPositions(graph: SessionGraph): Record<string, CanvasPoint> {
  return Object.fromEntries(
    graph.nodes.map((node) => [node.id, toStoredPosition(graph, node.id, node.position)])
  )
}

/** Projects agent status, external sessions and messages into React Flow nodes and edges. */
export function buildSessionGraph(inputs: SessionCanvasInputs): SessionGraph {
  const { sessions, groupLabels } = resolveCanvasMembership(inputs)
  const startedParents = resolveStartedParents(inputs.liveEntries)
  const membersByGroup = new Map<string, CanvasSession[]>()
  for (const session of sessions) {
    const members = membersByGroup.get(session.groupId) ?? []
    membersByGroup.set(session.groupId, members)
    members.push(session)
  }

  const groups = [...groupLabels.entries()].sort(compareGroups).map(([groupId, label]) => {
    const members = membersByGroup.get(groupId) ?? []
    const positions = placeGroupMembers(members, inputs, startedParents)
    const known = inputs.savedPositions[groupId] ?? inputs.previousPositions[groupId]
    return {
      groupId,
      label,
      members,
      positions,
      known,
      size: measureGroupSize([...positions.values()])
    }
  })
  // Why: new groups start right of every already-positioned group so they never cover a dragged one.
  let cursorX = 0
  for (const group of groups) {
    if (group.known) {
      const left = group.known.x - group.size.childOffset.x
      cursorX = Math.max(cursorX, left + group.size.width + GROUP_GAP)
    }
  }

  const groupNodes: SessionGraphNode[] = []
  const memberNodes: SessionGraphNode[] = []
  for (const { groupId, label, members, positions, known, size } of groups) {
    const { childOffset, width, height } = size
    let anchor = known
    if (!anchor) {
      anchor = { x: cursorX + childOffset.x, y: childOffset.y }
      cursorX += width + GROUP_GAP
    }
    const shifted = childOffset.x !== 0 || childOffset.y !== 0
    groupNodes.push({
      id: groupId,
      type: 'group',
      position: { x: anchor.x - childOffset.x, y: anchor.y - childOffset.y },
      data: shifted ? { label, childOffset } : { label },
      width,
      height
    })
    for (const member of members) {
      const stored = positions.get(member.id) ?? { x: 0, y: 0 }
      memberNodes.push({
        id: member.id,
        type: member.data.kind,
        position: { x: stored.x + childOffset.x, y: stored.y + childOffset.y },
        parentId: groupId,
        data: member.data
      })
    }
  }

  const edges = buildSessionEdges({
    sessions,
    startedParents,
    liveEntries: inputs.liveEntries,
    messages: inputs.messages,
    changedFilesByWorktree: inputs.changedFilesByWorktree,
    now: inputs.now
  })
  return { nodes: [...groupNodes, ...memberNodes], edges }
}
