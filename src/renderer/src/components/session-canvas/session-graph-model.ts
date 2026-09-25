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

/** Saved positions first, then parents before children so a child can sit beside its parent. */
function placeGroupMembers(
  members: CanvasSession[],
  savedPositions: SessionCanvasInputs['savedPositions'],
  parents: Map<string, string>
): Map<string, CanvasPoint> {
  const placed = new Map<string, CanvasPoint>()
  const pending: CanvasSession[] = []
  for (const member of members) {
    const saved = savedPositions[member.id]
    if (saved) {
      placed.set(member.id, saved)
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

/** Projects agent status, external sessions and messages into React Flow nodes and edges. */
export function buildSessionGraph(inputs: SessionCanvasInputs): SessionGraph {
  const { sessions, groupLabels } = resolveCanvasMembership(inputs)
  const startedParents = resolveStartedParents(inputs.liveEntries)
  const membersByGroup = new Map<string, CanvasSession[]>()
  for (const session of sessions) {
    const members = membersByGroup.get(session.groupId)
    if (members) {
      members.push(session)
    } else {
      membersByGroup.set(session.groupId, [session])
    }
  }

  const groupNodes: SessionGraphNode[] = []
  const memberNodes: SessionGraphNode[] = []
  let cursorX = 0
  for (const [groupId, label] of [...groupLabels.entries()].sort(compareGroups)) {
    const members = membersByGroup.get(groupId) ?? []
    const positions = placeGroupMembers(members, inputs.savedPositions, startedParents)
    const size = measureGroupSize([...positions.values()])
    groupNodes.push({
      id: groupId,
      type: 'group',
      position: inputs.savedPositions[groupId] ?? { x: cursorX, y: 0 },
      data: { label },
      ...size
    })
    cursorX += size.width + GROUP_GAP
    for (const member of members) {
      memberNodes.push({
        id: member.id,
        type: member.data.kind,
        position: positions.get(member.id) ?? { x: 0, y: 0 },
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
