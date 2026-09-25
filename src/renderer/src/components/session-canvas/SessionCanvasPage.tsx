import React, { useCallback, useMemo, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeChange,
  type OnNodeDrag,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import './session-canvas.css'
import { translate } from '@/i18n/i18n'
import { ConnectMenu } from './ConnectMenu'
import { ExternalSessionCard } from './ExternalSessionCard'
import { LiveSessionCard } from './LiveSessionCard'
import { PassAlongDialog } from './PassAlongDialog'
import { SessionCanvasToolbar } from './SessionCanvasToolbar'
import { SessionEdge } from './SessionEdge'
import { SessionGroupNode } from './SessionGroupNode'
import { SuperviseDialog } from './SuperviseDialog'
import {
  EMPTY_SESSION_FLOW_LOCAL_STATE,
  applySessionFlowChanges,
  clearSessionFlowDrags,
  pruneSessionFlowLocalState,
  toFlowEdges,
  toFlowNodes,
  type SessionFlowEdge,
  type SessionFlowNode
} from './session-canvas-flow-model'
import type { SessionCanvasFilters } from './session-graph-types'
import { useSessionCanvasData } from './use-session-canvas-data'
import { useSessionConnectGesture } from './use-session-connect-gesture'

const NODE_TYPES: NodeTypes = {
  live: LiveSessionCard,
  external: ExternalSessionCard,
  sessionGroup: SessionGroupNode
}
const EDGE_TYPES: EdgeTypes = { session: SessionEdge }

export const SESSION_CANVAS_DEFAULT_FILTERS: SessionCanvasFilters = {
  query: '',
  agents: [],
  states: [],
  projects: [],
  showExternal: true,
  hideIdleOlderThanMs: 12 * 60 * 60 * 1000
}

function SessionCanvasSurface(): React.JSX.Element {
  const [filters, setFilters] = useState(SESSION_CANVAS_DEFAULT_FILTERS)
  const { graph, agentOptions, projectOptions, savePosition, resetLayout, refreshMessages } =
    useSessionCanvasData(filters)
  const connect = useSessionConnectGesture(graph)
  const connectFor = (mode: 'pass-along' | 'supervise') =>
    connect.request?.mode === mode ? connect.request.connection : null
  const onDialogOpenChange = (open: boolean): void => {
    if (!open) {
      connect.close()
    }
  }
  const [local, setLocal] = useState(EMPTY_SESSION_FLOW_LOCAL_STATE)
  const nodes = useMemo(() => toFlowNodes(graph, local), [graph, local])
  const edges = useMemo(() => toFlowEdges(graph), [graph])
  const { fitView } = useReactFlow()

  const onNodesChange = useCallback(
    (changes: NodeChange<SessionFlowNode>[]) => {
      // Pruning rides on RF's own change stream (new nodes always report dimensions).
      setLocal((current) =>
        pruneSessionFlowLocalState(applySessionFlowChanges(current, changes), graph)
      )
    },
    [graph]
  )
  const onNodeDragStop: OnNodeDrag<SessionFlowNode> = useCallback(
    (_event, _node, dragged) => {
      for (const node of dragged) {
        savePosition(node.id, node.position)
      }
      // Same batch as the save, so the card never flashes back to its old spot.
      setLocal((current) =>
        clearSessionFlowDrags(
          current,
          dragged.map((node) => node.id)
        )
      )
    },
    [savePosition]
  )
  const onResetLayout = useCallback(() => {
    resetLayout()
    // Why: wait a frame so fitView measures the re-laid-out nodes.
    requestAnimationFrame(() => void fitView({ duration: 200 }))
  }, [fitView, resetLayout])

  return (
    <>
      <SessionCanvasToolbar
        filters={filters}
        onFiltersChange={setFilters}
        agentOptions={agentOptions}
        projectOptions={projectOptions}
        onResetLayout={onResetLayout}
        onFitView={() => void fitView({ duration: 200 })}
      />
      <div className="relative min-h-0 flex-1">
        <ReactFlow<SessionFlowNode, SessionFlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          isValidConnection={connect.isValidConnection}
          onConnect={connect.onConnect}
          onConnectEnd={connect.onConnectEnd}
          onlyRenderVisibleElements
          fitView
          minZoom={0.1}
          maxZoom={1.5}
          deleteKeyCode={null}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} />
          <MiniMap pannable zoomable />
        </ReactFlow>
        {graph.nodes.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              {translate(
                'sessionCanvas.empty',
                '还没有会话。在终端里启动一个 agent，它会出现在这里。'
              )}
            </p>
          </div>
        ) : null}
      </div>
      <ConnectMenu
        point={connect.request?.mode === 'menu' ? connect.request.point : null}
        onPick={connect.pick}
        onClose={connect.closeMenu}
      />
      <PassAlongDialog
        connection={connectFor('pass-along')}
        onOpenChange={onDialogOpenChange}
        onSent={refreshMessages}
      />
      <SuperviseDialog connection={connectFor('supervise')} onOpenChange={onDialogOpenChange} />
    </>
  )
}

export default function SessionCanvasPage(): React.JSX.Element {
  return (
    <main className="session-canvas flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center px-3 pt-3 pb-1">
        <h1 className="truncate text-base font-semibold leading-8">
          {translate('sessionCanvas.title', '会话画布')}
        </h1>
      </header>
      <ReactFlowProvider>
        <SessionCanvasSurface />
      </ReactFlowProvider>
    </main>
  )
}
