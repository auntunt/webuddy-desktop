import type { AiVaultSessionPreviewMessage } from '../../shared/ai-vault-types'
import type { TranscriptMessage, TranscriptMessageSink } from './session-transcript-consumers'

export const CONVERSATION_HEAD_MESSAGES = 200
export const CONVERSATION_TAIL_MESSAGES = 1_800
export const CONVERSATION_MAX_MESSAGE_BYTES = 16 * 1024
export const CONVERSATION_MAX_TOTAL_BYTES = 1024 * 1024

export type AiVaultConversationMessage = AiVaultSessionPreviewMessage

export type AiVaultConversationResult = {
  messages: AiVaultConversationMessage[]
  /** Any message was dropped or cut to fit the caps. */
  truncated: boolean
  /** Messages the transcript holds, before any were dropped. */
  totalMessages: number
}

export const EMPTY_AI_VAULT_CONVERSATION: AiVaultConversationResult = {
  messages: [],
  truncated: false,
  totalMessages: 0
}

type SizedMessage = { message: AiVaultConversationMessage; bytes: number }

/** Cuts at a UTF-8 boundary so a capped message never ends in a broken character. */
function capMessageText(text: string): { text: string; bytes: number; capped: boolean } {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= CONVERSATION_MAX_MESSAGE_BYTES) {
    return { text, bytes, capped: false }
  }
  const encoded = Buffer.from(text, 'utf8')
  let cut = CONVERSATION_MAX_MESSAGE_BYTES
  while (cut > 0 && (encoded[cut] & 0xc0) === 0x80) {
    cut--
  }
  return { text: encoded.subarray(0, cut).toString('utf8'), bytes: cut, capped: true }
}

/**
 * Streams a transcript into a bounded window: the first 200 and last 1800
 * messages, each ≤16 KB, the whole ≤1 MB. Memory stays bounded however long
 * the session is, because the tail is a ring buffer.
 */
export class ConversationWindowSink implements TranscriptMessageSink {
  readonly active = true
  private readonly head: SizedMessage[] = []
  private readonly tail: (SizedMessage | undefined)[] = Array.from({
    length: CONVERSATION_TAIL_MESSAGES
  })
  private tailStart = 0
  private tailLength = 0
  private total = 0
  private capped = false

  push(message: TranscriptMessage): void {
    this.total++
    const text = capMessageText(message.text)
    this.capped ||= text.capped
    const sized: SizedMessage = {
      message: { role: message.role, text: text.text, timestamp: message.timestamp },
      bytes: text.bytes
    }
    if (this.head.length < CONVERSATION_HEAD_MESSAGES) {
      this.head.push(sized)
      return
    }
    if (this.tailLength < CONVERSATION_TAIL_MESSAGES) {
      this.tail[(this.tailStart + this.tailLength) % CONVERSATION_TAIL_MESSAGES] = sized
      this.tailLength++
      return
    }
    this.tail[this.tailStart] = sized
    this.tailStart = (this.tailStart + 1) % CONVERSATION_TAIL_MESSAGES
  }

  finish(): AiVaultConversationResult {
    const kept = [...this.head]
    for (let i = 0; i < this.tailLength; i++) {
      const entry = this.tail[(this.tailStart + i) % CONVERSATION_TAIL_MESSAGES]
      if (entry) {
        kept.push(entry)
      }
    }
    let truncated = this.capped || kept.length < this.total
    let bytes = kept.reduce((sum, entry) => sum + entry.bytes, 0)
    // Why: over budget, the middle gives way so both the opening ask and the
    // newest turns survive.
    while (bytes > CONVERSATION_MAX_TOTAL_BYTES && kept.length > 0) {
      const [dropped] = kept.splice(Math.floor(kept.length / 2), 1)
      bytes -= dropped.bytes
      truncated = true
    }
    return {
      messages: kept.map((entry) => entry.message),
      truncated,
      totalMessages: this.total
    }
  }
}
