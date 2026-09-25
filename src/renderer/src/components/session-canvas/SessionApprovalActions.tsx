import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AgentQuestionIcon } from '@/components/AgentQuestionIcon'
import type { ChatApproval } from '../native-chat/native-chat-interactive-prompt'
import { sendToSession } from './session-canvas-send'

/** Inline approval choices for a waiting session; remount (key) when the request changes. */
export function SessionApprovalActions({
  paneKey,
  approval,
  disabled = false
}: {
  paneKey: string
  approval: ChatApproval
  disabled?: boolean
}): React.JSX.Element {
  // 'sent' keeps the buttons off until the agent clears the request, so a choice isn't sent twice.
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent'>('idle')
  const choose = async (send: string): Promise<void> => {
    setPhase('sending')
    const ok = await sendToSession({ paneKey, text: send, keys: true })
    setPhase(ok ? 'sent' : 'idle')
  }
  return (
    <div className="flex shrink-0 flex-col gap-1 rounded-md bg-agent-question/15 px-2 py-1.5 text-[11px] text-agent-question-text ring-1 ring-inset ring-agent-question/25">
      <div className="flex min-w-0 items-start gap-1">
        <AgentQuestionIcon className="mt-px size-3 shrink-0" />
        <span className="font-medium">{approval.title}</span>
      </div>
      {approval.detail ? <p className="line-clamp-2 break-all">{approval.detail}</p> : null}
      <div className="nodrag nopan flex flex-wrap gap-1">
        {approval.options.map((option) => (
          <Button
            key={`${option.send}:${option.label}`}
            type="button"
            variant="outline"
            size="xs"
            disabled={disabled || phase !== 'idle'}
            onClick={() => void choose(option.send)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
