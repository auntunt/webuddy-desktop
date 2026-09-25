import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { ReactFlow, type NodeTypes } from '@xyflow/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { SessionNodeData } from './session-graph-types'

/** Mount one session card as a real React Flow node (tests only; needs installReactFlowTestDom). */
export function renderSessionCardNode(
  nodeTypes: NodeTypes,
  data: SessionNodeData,
  wrapper?: RenderOptions['wrapper']
): RenderResult {
  return render(
    <TooltipProvider>
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow
          nodes={[{ id: 'card', type: data.kind, position: { x: 0, y: 0 }, data }]}
          edges={[]}
          nodeTypes={nodeTypes}
        />
      </div>
    </TooltipProvider>,
    { wrapper }
  )
}
