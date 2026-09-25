import React, { useMemo, useState } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { MessageSquare, SquareTerminal, X } from 'lucide-react'
import { toast } from 'sonner'
import { AgentStateDot } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { AgentIcon } from '@/lib/agent-catalog'
import { formatCompactDuration } from '@/lib/agent-row-decay-state'
import { agentTypeToIconAgent } from '@/lib/agent-status'
import { cn } from '@/lib/utils'
import {
  resolveWorktreeBranchLabel,
  resolveWorktreeDisplayName
} from '@/lib/worktree-default-display-name'
import { useAppStore } from '@/store'
import { toSshExecutionHostId } from '../../../../shared/execution-host'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import { DashboardHostBadge } from '../dashboard-popout/DashboardHostBadge'
import { revealDashboardAgent } from '../dashboard/reveal-dashboard-agent'
import { ActionStream } from './ActionStream'
import { resolveSessionApproval } from './approval-fallback-model'
import {
  liveSessionHostVerdict,
  liveSessionRevealArgs,
  liveSessionTabId,
  liveSessionTitle
} from './live-session-card-model'
import { SessionApprovalActions } from './SessionApprovalActions'
import { sessionCanvasStateLabel } from './session-canvas-labels'
import { closeSessionPane } from './session-card-close'
import type { SessionNodeData } from './session-graph-types'
import { SessionMessageComposer } from './SessionMessageComposer'

type LiveData = Extract<SessionNodeData, { kind: 'live' }>

const ELAPSED_TICK_MS = 30_000

function CardIconButton({
  label,
  hint,
  disabled,
  onClick,
  children
}: {
  label: string
  /** Tooltip text when it should say more than the label. */
  hint?: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          aria-description={hint}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {hint ?? label}
      </TooltipContent>
    </Tooltip>
  )
}

/** "Mini terminal" card for a Webuddy agent session: live actions, approvals and quick actions. */
export function LiveSessionCard({ data }: NodeProps<Node<LiveData, 'live'>>): React.JSX.Element {
  const { entry, repoLabel } = data
  const [composerOpen, setComposerOpen] = useState(false)
  const now = useNow(ELAPSED_TICK_MS)
  const { worktreeId, connectionId } = entry
  const branchLabel = useAppStore((state) => {
    if (!worktreeId) {
      return null
    }
    const worktree = state.worktreesByRepo[getRepoIdFromWorktreeId(worktreeId)]?.find(
      (candidate) => candidate.id === worktreeId
    )
    return worktree
      ? resolveWorktreeBranchLabel(worktree) || resolveWorktreeDisplayName(worktree)
      : null
  })
  const sshStatus = useAppStore((state) =>
    connectionId ? (state.sshConnectionStates.get(connectionId)?.status ?? null) : null
  )
  const skipCloseConfirm = useAppStore(
    (state) => state.settings?.skipCloseTerminalWithRunningProcessConfirm === true
  )
  const hostLabel = useAppStore((state) =>
    connectionId ? state.sshTargetLabels.get(connectionId) : undefined
  )
  const verdict = liveSessionHostVerdict(connectionId, sshStatus)
  const unverifiable = verdict === 'unverifiable'
  const approval = useMemo(() => resolveSessionApproval(entry), [entry])
  const needsYou = entry.state === 'waiting' || entry.state === 'blocked'
  const title = liveSessionTitle(entry)
  const reply = entry.lastAssistantMessage ?? entry.lastCompletedAssistantMessage
  const tabId = liveSessionTabId(entry)
  const revealArgs = liveSessionRevealArgs(entry)
  const footer = [repoLabel, branchLabel, formatCompactDuration(now - entry.stateStartedAt)]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      role="group"
      aria-label={title}
      className={cn(
        'flex h-[220px] w-80 flex-col gap-1.5 rounded-xl border bg-card p-3 text-card-foreground shadow-xs',
        needsYou && !unverifiable ? 'border-agent-question/60' : 'border-border'
      )}
      data-testid="session-live-card"
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="inline-flex shrink-0">
          <AgentIcon agent={agentTypeToIconAgent(entry.agentType)} size={14} />
        </span>
        <span className="truncate text-[13px] font-medium">{title}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          <AgentStateDot state={unverifiable ? 'unverifiable' : entry.state} title={null} />
          {unverifiable
            ? translate('sessionCanvas.state.unverifiable', '无法确认')
            : sessionCanvasStateLabel(entry.state)}
        </span>
      </div>
      <ActionStream actions={entry.actionHistory ?? []} />
      {reply ? <p className="line-clamp-1 shrink-0 text-xs text-foreground/90">{reply}</p> : null}
      {approval && needsYou ? (
        <SessionApprovalActions
          key={JSON.stringify(approval)}
          paneKey={entry.paneKey}
          approval={approval}
          disabled={unverifiable}
        />
      ) : null}
      {composerOpen ? (
        <SessionMessageComposer paneKey={entry.paneKey} disabled={unverifiable} />
      ) : null}
      {entry.subagents?.length ? (
        <ul className="flex shrink-0 gap-1 overflow-hidden">
          {entry.subagents.map((subagent) => (
            <li
              key={subagent.id}
              className="flex max-w-32 shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-px text-[10.5px] text-muted-foreground"
            >
              <AgentStateDot state={subagent.state} />
              <span className="truncate">
                {subagent.description || subagent.agentType || subagent.id}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        {connectionId ? (
          <DashboardHostBadge
            hostKind="ssh"
            executionHostId={toSshExecutionHostId(connectionId)}
            hostLabel={hostLabel}
          />
        ) : null}
        <span className="truncate">{footer}</span>
        <div className="nodrag nopan ml-auto flex shrink-0 items-center">
          <CardIconButton
            label={translate('sessionCanvas.card.message', '发消息')}
            onClick={() => setComposerOpen((open) => !open)}
          >
            <MessageSquare />
          </CardIconButton>
          <CardIconButton
            label={translate('sessionCanvas.card.reveal', '跳到终端')}
            disabled={!revealArgs}
            onClick={() => {
              if (revealArgs && !revealDashboardAgent(revealArgs)) {
                toast.error(translate('sessionCanvas.card.revealFailed', '无法打开这个终端。'))
              }
            }}
          >
            <SquareTerminal />
          </CardIconButton>
          <CardIconButton
            label={translate('sessionCanvas.card.close', '关闭终端')}
            hint={
              unverifiable
                ? translate(
                    'sessionCanvas.card.closeUnverifiable',
                    '关闭终端（主机连接中断，关闭结果无法确认）'
                  )
                : undefined
            }
            onClick={() =>
              closeSessionPane({
                paneKey: entry.paneKey,
                tabId,
                title,
                // Why: the host may still be running an unverifiable agent, so ask as if busy.
                confirm: !skipCloseConfirm && (entry.state === 'working' || unverifiable)
              })
            }
          >
            <X />
          </CardIconButton>
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
