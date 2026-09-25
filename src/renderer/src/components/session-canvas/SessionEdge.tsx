import React from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { SessionFlowEdge } from './session-canvas-flow-model'
import type { SessionEdgeKind } from './session-graph-types'

const EDGE_STYLE_BY_KIND: Record<SessionEdgeKind, React.CSSProperties> = {
  started: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 },
  messaged: { stroke: 'var(--muted-foreground)', strokeWidth: 1.5 },
  'same-file': { stroke: 'var(--destructive)', strokeWidth: 1.5, strokeDasharray: '6 4' }
}

/** started = solid arrow; messaged = curve with flowing dots when recent; same-file = red dashes. */
export function SessionEdge(props: EdgeProps<SessionFlowEdge>): React.JSX.Element {
  const { id, data, markerEnd } = props
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition
  })
  const kind = data?.kind ?? 'started'
  const files = data?.files ?? []
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={EDGE_STYLE_BY_KIND[kind]} />
      {kind === 'messaged' && data?.animated ? (
        <path d={path} className="session-edge-flow" data-testid="session-edge-flow" />
      ) : null}
      {kind === 'same-file' && files.length > 0 ? (
        <EdgeLabelRenderer>
          <div
            // nodrag/nopan: React Flow's opt-out classes so hovering the chip doesn't grab the pane.
            className="nodrag nopan pointer-events-auto absolute"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded-full border border-destructive/50 bg-background px-1.5 py-px text-[10px] font-medium text-destructive"
                >
                  {translate('sessionCanvas.edge.sameFileCount', '{{fileCount}} 个相同文件', {
                    fileCount: files.length
                  })}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                <div className="flex max-w-80 flex-col gap-0.5 font-mono text-[11px]">
                  {files.map((file) => (
                    <span key={file} className="truncate">
                      {file}
                    </span>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
