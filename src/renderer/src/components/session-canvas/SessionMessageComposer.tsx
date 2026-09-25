import React, { useState } from 'react'
import { SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { sendToSession } from './session-canvas-send'

/** Expandable one-line prompt box on a live card; Enter sends. */
export function SessionMessageComposer({
  paneKey,
  disabled = false
}: {
  paneKey: string
  disabled?: boolean
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const submit = async (): Promise<void> => {
    const message = text.trim()
    if (!message || sending) {
      return
    }
    setSending(true)
    const ok = await sendToSession({ paneKey, text: message })
    setSending(false)
    if (ok) {
      setText('')
    }
  }
  return (
    <div className="nodrag nopan flex shrink-0 items-center gap-1">
      <Input
        aria-label={translate('sessionCanvas.composer.label', '给这个会话发消息')}
        placeholder={translate('sessionCanvas.composer.placeholder', '发消息…')}
        value={text}
        disabled={disabled}
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      <Button
        type="button"
        size="icon"
        aria-label={translate('sessionCanvas.composer.send', '发送')}
        disabled={disabled || sending}
        onClick={() => void submit()}
      >
        <SendHorizontal />
      </Button>
    </div>
  )
}
