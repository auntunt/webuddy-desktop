import React, { useMemo, useState } from 'react'
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
import { liveSessionTitle } from './live-session-card-model'
import { composePassAlongPrompt } from './pass-along-prompt-model'
import { sendToSession } from './session-canvas-send'
import { previewPassAlongText, type ResolvedSessionConnection } from './session-connect-model'

async function recordPassAlong(connection: ResolvedSessionConnection): Promise<void> {
  const failed = (reason: string): void => {
    // Why: the prompt already reached B; only the "messaged" edge is missing.
    toast.error(
      `${translate('sessionCanvas.passAlong.logFailed', '已送达，但没能记下这次传话')}：${reason}`
    )
  }
  try {
    const result = await window.api.sessionCanvas.recordPassAlong({
      fromPaneKey: connection.from.paneKey,
      toPaneKey: connection.to.paneKey
    })
    if (!result.ok) {
      failed(result.reason)
    }
  } catch (error) {
    failed(error instanceof Error ? error.message : String(error))
  }
}

function PassAlongForm({
  connection,
  onDone,
  onSent
}: {
  connection: ResolvedSessionConnection
  onDone: () => void
  onSent: () => void
}): React.JSX.Element {
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const fromTitle = liveSessionTitle(connection.from)
  const toTitle = liveSessionTitle(connection.to)
  const prompt = useMemo(
    () =>
      composePassAlongPrompt({
        fromTitle,
        result: connection.from.lastCompletedAssistantMessage ?? null,
        note
      }),
    [fromTitle, connection.from.lastCompletedAssistantMessage, note]
  )
  const submit = async (): Promise<void> => {
    if (sending) {
      return
    }
    setSending(true)
    const ok = await sendToSession({ paneKey: connection.to.paneKey, text: prompt })
    if (!ok) {
      setSending(false)
      return
    }
    await recordPassAlong(connection)
    onSent()
    toast.success(
      translate('sessionCanvas.passAlong.sent', '已传话给「{{title}}」', { title: toTitle })
    )
    onDone()
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{translate('sessionCanvas.passAlong.title', '传话')}</DialogTitle>
        <DialogDescription>
          {translate(
            'sessionCanvas.passAlong.description',
            '把「{{from}}」的最新结果发给「{{to}}」。',
            {
              from: fromTitle,
              to: toTitle
            }
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="session-pass-along-note">
          {translate('sessionCanvas.passAlong.noteLabel', '附言（可选）')}
        </Label>
        <Textarea
          id="session-pass-along-note"
          rows={2}
          autoFocus
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          {translate('sessionCanvas.passAlong.preview', '将发送的内容')}
        </div>
        <pre
          data-testid="pass-along-preview"
          className="scrollbar-sleek max-h-40 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-sans text-xs whitespace-pre-wrap break-words"
        >
          {previewPassAlongText(prompt)}
        </pre>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {translate('sessionCanvas.dialog.cancel', '取消')}
        </Button>
        <Button type="submit" disabled={sending}>
          {translate('sessionCanvas.passAlong.submit', '传话')}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Compose A's latest result (+ optional note) and send it to B's terminal. */
export function PassAlongDialog({
  connection,
  onOpenChange,
  onSent
}: {
  connection: ResolvedSessionConnection | null
  onOpenChange: (open: boolean) => void
  onSent: () => void
}): React.JSX.Element {
  return (
    <Dialog open={connection !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {connection ? (
          <PassAlongForm
            connection={connection}
            onDone={() => onOpenChange(false)}
            onSent={onSent}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
