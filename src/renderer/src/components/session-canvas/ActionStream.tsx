import React, { useLayoutEffect, useRef } from 'react'
import { translate } from '@/i18n/i18n'
import type { AgentActionHistoryEntry } from '../../../../shared/agent-status-types'
import { withContentKeys } from './session-card-list-keys-model'

// Within this many px of the end still counts as "at the bottom" (sub-pixel scroll offsets).
const STICK_THRESHOLD_PX = 8

/** Recent tool calls, newest at the bottom; follows new rows unless the user scrolled up. */
export function ActionStream({
  actions
}: {
  actions: readonly AgentActionHistoryEntry[]
}): React.JSX.Element {
  const listRef = useRef<HTMLOListElement>(null)
  const stickToBottomRef = useRef(true)
  const newestAt = actions.at(-1)?.at

  useLayoutEffect(() => {
    const list = listRef.current
    if (list && stickToBottomRef.current) {
      list.scrollTop = list.scrollHeight
    }
  }, [actions.length, newestAt])

  if (actions.length === 0) {
    return (
      <p className="min-h-0 flex-1 text-[11px] text-muted-foreground">
        {translate('sessionCanvas.card.noActions', '暂无动作')}
      </p>
    )
  }
  return (
    <ol
      ref={listRef}
      aria-label={translate('sessionCanvas.card.actions', '最近动作')}
      onScroll={(event) => {
        const list = event.currentTarget
        stickToBottomRef.current =
          list.scrollHeight - list.scrollTop - list.clientHeight <= STICK_THRESHOLD_PX
      }}
      // Why: nowheel/nodrag let wheel and drag scroll the list instead of moving the canvas.
      className="nodrag nowheel scrollbar-sleek min-h-0 flex-1 overflow-y-auto rounded-md bg-muted/50 px-2 py-1 font-mono text-[11px] leading-4"
    >
      {withContentKeys(actions, (action) => `${action.at}:${action.toolName}`).map(
        ({ item: action, key }) => (
          <li key={key} className="flex min-w-0 gap-1.5">
            <span className="shrink-0 font-semibold text-foreground">{action.toolName}</span>
            {action.toolInput ? (
              <span className="truncate text-muted-foreground">{action.toolInput}</span>
            ) : null}
          </li>
        )
      )}
    </ol>
  )
}
