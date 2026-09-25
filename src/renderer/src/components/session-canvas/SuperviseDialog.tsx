import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { SessionCanvasSuperviseResult } from '../../../../shared/session-canvas-actions'
import { liveSessionTitle } from './live-session-card-model'
import type { ResolvedSessionConnection } from './session-connect-model'
import { useSessionConnectionBlock } from './use-session-connection-block'

/** Toasts the outcome; returns whether the dialog should close. */
function reportSuperviseResult(result: SessionCanvasSuperviseResult, workerTitle: string): boolean {
  if (result.ok) {
    toast.success(
      translate('sessionCanvas.supervise.sent', '已把任务派给「{{title}}」', {
        title: workerTitle
      }),
      {
        description: translate('sessionCanvas.supervise.dispatchId', '派发编号：{{id}}', {
          id: result.dispatchId
        })
      }
    )
    return true
  }
  if (result.dispatchId) {
    // Why: the preamble may already be in B's terminal; retrying could double-dispatch.
    toast.warning(
      translate('sessionCanvas.supervise.unknown', '派发结果未知：任务可能已送达，先看看 B 再重试'),
      {
        description: translate(
          'sessionCanvas.supervise.unknownDetail',
          '{{reason}} · 派发编号：{{id}}',
          {
            reason: result.reason,
            id: result.dispatchId
          }
        )
      }
    )
    return true
  }
  toast.error(result.reason)
  return false
}

function SuperviseForm({
  connection,
  onDone
}: {
  connection: ResolvedSessionConnection
  onDone: () => void
}): React.JSX.Element {
  const [task, setTask] = useState('')
  const [pending, setPending] = useState(false)
  const blocked = useSessionConnectionBlock(connection, 'supervise')
  const coordinatorTitle = liveSessionTitle(connection.from)
  const workerTitle = liveSessionTitle(connection.to)
  const trimmed = task.trim()
  const submit = async (): Promise<void> => {
    if (!trimmed || pending || blocked) {
      return
    }
    setPending(true)
    let close = false
    try {
      const result = await window.api.sessionCanvas.supervise({
        coordinatorPaneKey: connection.from.paneKey,
        workerPaneKey: connection.to.paneKey,
        task: trimmed
      })
      close = reportSuperviseResult(result, workerTitle)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    setPending(false)
    if (close) {
      onDone()
    }
  }
  const isMac = navigator.userAgent.includes('Mac')
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{translate('sessionCanvas.supervise.title', '监督')}</DialogTitle>
        <DialogDescription>
          {translate(
            'sessionCanvas.supervise.description',
            '「{{from}}」把任务派给「{{to}}」，由「{{to}}」作为工人执行。',
            { from: coordinatorTitle, to: workerTitle }
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="session-supervise-task">
          {translate('sessionCanvas.supervise.taskLabel', '任务说明')}
        </Label>
        <Textarea
          id="session-supervise-task"
          rows={4}
          autoFocus
          required
          value={task}
          onChange={(event) => setTask(event.target.value)}
          onKeyDown={(event) => {
            const modifier = isMac ? event.metaKey : event.ctrlKey
            if (event.key === 'Enter' && modifier && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        {blocked ? (
          <p role="status" className="text-xs text-muted-foreground">
            {blocked}
          </p>
        ) : null}
        {pending ? (
          <p className="text-xs text-muted-foreground">
            {translate('sessionCanvas.supervise.pendingHint', '正在让 B 接手任务，最长约一分钟。')}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {translate('sessionCanvas.dialog.cancel', '取消')}
        </Button>
        <Button type="submit" className="w-24" disabled={!trimmed || pending || blocked !== null}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending
            ? translate('sessionCanvas.supervise.pending', '派发中…')
            : translate('sessionCanvas.supervise.submit', '派发')}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Bind B as A's worker for a required task via the orchestration worker-start flow. */
export function SuperviseDialog({
  connection,
  onOpenChange
}: {
  connection: ResolvedSessionConnection | null
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={connection !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {connection ? (
          <SuperviseForm connection={connection} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
