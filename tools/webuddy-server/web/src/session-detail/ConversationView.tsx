import { useState } from 'react'
import type { ConversationMessage, ConversationRole } from '../api/session-types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { formatDateTime } from '../format/date-format'
import { TranscriptView } from './TranscriptView'

/** Longer than this and the message starts collapsed. */
export const MESSAGE_COLLAPSE_CHARS = 2000

const ROLE_LABEL: Record<ConversationRole, string> = {
  user: '用户',
  assistant: '助手',
  system: '系统',
  tool: '工具',
  unknown: '未知'
}

const ROLE_TONE: Record<ConversationRole, 'accent' | 'neutral' | 'warn'> = {
  user: 'accent',
  assistant: 'neutral',
  system: 'warn',
  tool: 'warn',
  unknown: 'neutral'
}

/** No stable id in the wire shape; role+timestamp+a text slice is unique enough in practice. */
function messageKey(message: ConversationMessage): string {
  return `${message.role}:${message.timestamp ?? ''}:${message.text.slice(0, 40)}`
}

function Message({ message }: { message: ConversationMessage }) {
  const [expanded, setExpanded] = useState(false)
  const long = message.text.length > MESSAGE_COLLAPSE_CHARS
  const shown =
    long && !expanded ? `${message.text.slice(0, MESSAGE_COLLAPSE_CHARS)}…` : message.text
  return (
    <div
      data-testid="conversation-message"
      data-role={message.role}
      className="flex flex-col gap-1.5 rounded-card border border-line bg-card p-3"
    >
      <div className="flex items-center gap-2 text-[11px] text-dim">
        <Badge tone={ROLE_TONE[message.role] ?? 'neutral'}>
          {ROLE_LABEL[message.role] ?? message.role}
        </Badge>
        <span>{formatDateTime(message.timestamp)}</span>
      </div>
      {/* Plain text only: {shown} is React text content, never markup — a literal <script> renders as text. */}
      <p className="text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-fg-hover">
        {shown}
      </p>
      {long && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起' : '展开'}
        </Button>
      )}
    </div>
  )
}

export function ConversationView({
  conversation,
  truncated,
  transcriptBody,
  transcriptBytes
}: {
  conversation: ConversationMessage[] | null
  truncated: boolean
  transcriptBody: string | null
  transcriptBytes: number | null
}) {
  const [showRaw, setShowRaw] = useState(false)

  if (!conversation || conversation.length === 0) {
    return <TranscriptView body={transcriptBody} bytes={transcriptBytes} />
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {truncated && <p className="text-xs text-dim">对话过长：仅显示开头 200 条与最近 1800 条</p>}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => setShowRaw((value) => !value)}
        >
          {showRaw ? '按对话显示' : '原始记录'}
        </Button>
      </div>
      {showRaw ? (
        <TranscriptView body={transcriptBody} bytes={transcriptBytes} />
      ) : (
        <div className="flex flex-col gap-2">
          {conversation.map((message) => (
            <Message key={messageKey(message)} message={message} />
          ))}
        </div>
      )}
    </div>
  )
}
