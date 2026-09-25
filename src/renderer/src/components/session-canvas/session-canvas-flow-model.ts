import { MarkerType, type Edge, type Node, type NodeChange } from '@xyflow/react'
import type {
  SessionEdgeKind,
  SessionGraph,
  SessionGroupData,
  SessionNodeData
} from './session-graph-types'
import type { CanvasPoint } from './session-layout-model'

export const SESSION_GROUP_DRAG_HANDLE_CLASS = 'session-group-drag-handle'

// Why: not React Flow's built-in 'group' type, whose base.css draws its own border.
export type SessionFlowNode =
  | Node<SessionNodeData, 'live' | 'external'>
  | Node<SessionGroupData, 'sessionGroup'>

export type SessionFlowEdgeData = { kind: SessionEdgeKind; animated: boolean; files: string[] }
export type SessionFlowEdge = Edge<SessionFlowEdgeData, 'session'>

/** What React Flow owns between graph rebuilds: measured sizes, in-flight drags, selection. */
export type SessionFlowLocalState = {
  measured: Record<string, { width: number; height: number }>
  dragging: Record<string, CanvasPoint>
  selected: ReadonlySet<string>
}

export const EMPTY_SESSION_FLOW_LOCAL_STATE: SessionFlowLocalState = {
  measured: {},
  dragging: {},
  selected: new Set()
}

export function toFlowNodes(graph: SessionGraph, local: SessionFlowLocalState): SessionFlowNode[] {
  return graph.nodes.map((node): SessionFlowNode => {
    const common = {
      id: node.id,
      position: local.dragging[node.id] ?? node.position,
      selected: local.selected.has(node.id),
      // Why: React Flow keeps controlled nodes hidden until `measured` is echoed back.
      ...(local.measured[node.id] ? { measured: local.measured[node.id] } : {})
    }
    if ('kind' in node.data) {
      return {
        ...common,
        type: node.data.kind,
        data: node.data,
        parentId: node.parentId,
        connectable: node.data.kind === 'live'
      }
    }
    return {
      ...common,
      type: 'sessionGroup',
      data: node.data,
      width: node.width,
      height: node.height,
      // Why: only the title drags the group so the body still pans the canvas.
      dragHandle: `.${SESSION_GROUP_DRAG_HANDLE_CLASS}`,
      selectable: false
    }
  })
}

export function toFlowEdges(graph: SessionGraph): SessionFlowEdge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'session',
    data: { kind: edge.kind, animated: edge.animated, files: edge.files ?? [] },
    ...(edge.kind === 'started'
      ? { markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--muted-foreground)' } }
      : {})
  }))
}

export function applySessionFlowChanges(
  local: SessionFlowLocalState,
  changes: readonly NodeChange[]
): SessionFlowLocalState {
  let { measured, dragging, selected } = local
  for (const change of changes) {
    if (change.type === 'dimensions' && change.dimensions) {
      const current = measured[change.id]
      const { width, height } = change.dimensions
      if (current?.width !== width || current?.height !== height) {
        measured = { ...measured, [change.id]: { width, height } }
      }
    } else if (change.type === 'position' && change.position) {
      dragging = { ...dragging, [change.id]: change.position }
    } else if (change.type === 'select' && selected.has(change.id) !== change.selected) {
      const next = new Set(selected)
      if (change.selected) {
        next.add(change.id)
      } else {
        next.delete(change.id)
      }
      selected = next
    }
  }
  return measured === local.measured && dragging === local.dragging && selected === local.selected
    ? local
    : { measured, dragging, selected }
}

/** Drops finished drags once their positions have been handed to the graph. */
export function clearSessionFlowDrags(
  local: SessionFlowLocalState,
  nodeIds: readonly string[]
): SessionFlowLocalState {
  if (!nodeIds.some((id) => id in local.dragging)) {
    return local
  }
  const dragging = { ...local.dragging }
  for (const id of nodeIds) {
    delete dragging[id]
  }
  return { ...local, dragging }
}

/** Drops measured/selected/drag entries of nodes that left the graph so the maps can't grow forever. */
export function pruneSessionFlowLocalState(
  local: SessionFlowLocalState,
  graph: SessionGraph
): SessionFlowLocalState {
  const ids = new Set(graph.nodes.map((node) => node.id))
  const keep = <T>(record: Record<string, T>): Record<string, T> | null =>
    Object.keys(record).every((id) => ids.has(id))
      ? null
      : Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)))
  const measured = keep(local.measured)
  const dragging = keep(local.dragging)
  const selectedStale = [...local.selected].some((id) => !ids.has(id))
  if (!measured && !dragging && !selectedStale) {
    return local
  }
  return {
    measured: measured ?? local.measured,
    dragging: dragging ?? local.dragging,
    selected: selectedStale
      ? new Set([...local.selected].filter((id) => ids.has(id)))
      : local.selected
  }
}
