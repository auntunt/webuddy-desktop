import React from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { Badge } from '@/components/ui/badge'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { formatCompactDuration } from '@/lib/agent-row-decay-state'
import { basename } from '@/lib/path'
import { withContentKeys } from './session-card-list-keys-model'
import type { SessionNodeData } from './session-graph-types'

type ExternalData = Extract<SessionNodeData, { kind: 'external' }>

const PREVIEW_COUNT = 3
const AGE_TICK_MS = 60_000

/** Grey read-only card for a session running outside Webuddy: no handles, no actions. */
export function ExternalSessionCard({
  data
}: NodeProps<Node<ExternalData, 'external'>>): React.JSX.Element {
  const { session, repoLabel } = data
  const now = useNow(AGE_TICK_MS)
  const updatedAt = session.updatedAt ? Date.parse(session.updatedAt) : Number.NaN
  const footer = [
    session.agentLabel,
    repoLabel ?? (session.cwd ? basename(session.cwd) : null),
    Number.isFinite(updatedAt) ? formatCompactDuration(Math.max(0, now - updatedAt)) : null
  ]
    .filter(Boolean)
    .join(' · ')
  const preview = session.preview.slice(-PREVIEW_COUNT)

  return (
    <div
      role="group"
      aria-label={session.title}
      className="flex h-[220px] w-80 flex-col gap-2 rounded-xl border border-border bg-muted p-3 text-muted-foreground"
      data-testid="session-external-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold">{session.agentLabel}</span>
        <Badge variant="outline" className="shrink-0">
          {translate('sessionCanvas.card.externalReadOnly', '外部 · 只读')}
        </Badge>
      </div>
      <div className="line-clamp-2 text-sm font-medium text-foreground/80">{session.title}</div>
      {preview.length > 0 ? (
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden text-[11px] leading-4">
          {withContentKeys(
            preview,
            (message) => `${message.role}:${message.timestamp ?? ''}:${message.text.slice(0, 32)}`
          ).map(({ item: message, key }) => (
            <li key={key} className="line-clamp-2">
              <span className="font-medium text-foreground/60">
                {message.role === 'user'
                  ? translate('sessionCanvas.card.you', '你')
                  : session.agentLabel}
              </span>{' '}
              <span>{message.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="min-h-0 flex-1 text-[11px]">
          {translate('sessionCanvas.card.noPreview', '暂无预览')}
        </p>
      )}
      <div className="truncate text-[11px]">{footer}</div>
    </div>
  )
}
