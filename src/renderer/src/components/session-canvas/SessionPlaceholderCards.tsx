import React from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import { sessionCanvasStateLabel } from './session-canvas-labels'
import type { SessionNodeData } from './session-graph-types'

type LiveData = Extract<SessionNodeData, { kind: 'live' }>
type ExternalData = Extract<SessionNodeData, { kind: 'external' }>

// Placeholder cards for the canvas skeleton; Task 6 replaces them with the live/read-only cards.

export function LiveSessionPlaceholderCard({
  data
}: NodeProps<Node<LiveData, 'live'>>): React.JSX.Element {
  const { entry, repoLabel } = data
  const title = entry.terminalTitle || entry.prompt || entry.agentType || entry.paneKey
  return (
    <div
      className="flex h-[220px] w-80 flex-col gap-2 rounded-xl border border-border bg-card p-3 text-card-foreground shadow-xs"
      data-testid="session-live-card"
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-muted-foreground">
          {entry.agentType}
        </span>
        <Badge variant="outline">{sessionCanvasStateLabel(entry.state)}</Badge>
      </div>
      <div className="line-clamp-3 text-sm font-medium">{title}</div>
      <div className="mt-auto truncate text-xs text-muted-foreground">{repoLabel ?? ''}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function ExternalSessionPlaceholderCard({
  data
}: NodeProps<Node<ExternalData, 'external'>>): React.JSX.Element {
  const { session, repoLabel } = data
  return (
    <div
      className="flex h-[220px] w-80 flex-col gap-2 rounded-xl border border-border bg-muted p-3 text-muted-foreground"
      data-testid="session-external-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold">{session.agentLabel}</span>
        <Badge variant="outline">
          {translate('sessionCanvas.card.externalReadOnly', '外部 · 只读')}
        </Badge>
      </div>
      <div className="line-clamp-3 text-sm font-medium">{session.title}</div>
      <div className="mt-auto truncate text-xs">{repoLabel ?? session.cwd ?? ''}</div>
    </div>
  )
}
