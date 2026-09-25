import React from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { sessionCanvasOtherGroupLabel } from './session-canvas-labels'
import { SESSION_CANVAS_OTHER_GROUP_ID } from './session-graph-membership-model'
import type { SessionGroupData } from './session-graph-types'

/** Project background region; only the title bar drags it (see SESSION_GROUP_DRAG_HANDLE_CLASS). */
export function SessionGroupNode({
  id,
  data
}: NodeProps<Node<SessionGroupData, 'sessionGroup'>>): React.JSX.Element {
  const label = id === SESSION_CANVAS_OTHER_GROUP_ID ? sessionCanvasOtherGroupLabel() : data.label
  return (
    <div
      className="size-full rounded-xl border border-border bg-muted/40"
      data-testid="session-group-node"
    >
      <div className="session-group-drag-handle cursor-grab truncate px-4 pt-3 text-xs font-semibold text-muted-foreground active:cursor-grabbing">
        {label}
      </div>
    </div>
  )
}
