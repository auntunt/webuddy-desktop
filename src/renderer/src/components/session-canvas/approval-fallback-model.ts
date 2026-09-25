import { translate } from '@/i18n/i18n'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import {
  parseApprovalFromStatus,
  parseAskFromStatus,
  type ChatApproval
} from '../native-chat/native-chat-interactive-prompt'

// Why: desktop only parses the structured `{ approval }` envelope, but many agents only print
// their ask as TUI text. This is a minimal port of mobile's detectAgentPermission
// (mobile/src/session/mobile-native-chat-permission.ts; mobile is a separate package).

type ApprovalInput = Pick<
  AgentStatusEntry,
  'state' | 'interactivePrompt' | 'lastAssistantMessage' | 'toolName'
>

const PERMISSION_PATTERNS: RegExp[] = [
  /\bpermission\b/i,
  /\bapprov(e|al)\b/i,
  /\ballow\b/i,
  /\bdeny\b/i,
  /\bgrant\b/i,
  /\bauthorize\b/i,
  /\bdo you want to\b/i,
  /\bwould you like to\b/i,
  /\bproceed\?/i,
  /\bconfirm\b/i,
  /\by\/n\b/i,
  /\byes\/no\b/i
]
const NUMBERED_OPTION_RE = /(?:^|\n)\s*(\d+)[.)]\s*([^\n]+)/g
const ALWAYS_RE = /\balways\b|don't ask again|do not ask again|for the rest|this session/i

function shortLabel(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

function detectTextApproval(text: string): ChatApproval | null {
  if (!text.trim() || !PERMISSION_PATTERNS.some((pattern) => pattern.test(text))) {
    return null
  }
  const title = translate('sessionCanvas.approval.title', '请求权限')
  const detail = shortLabel(text.split('\n')[0] ?? '', 160) || undefined
  const numbered = [...text.matchAll(NUMBERED_OPTION_RE)].flatMap(([, num, body]) =>
    num && body?.trim() ? [{ label: shortLabel(body, 40), send: num }] : []
  )
  if (numbered.length >= 2) {
    return { title, detail, options: numbered }
  }
  const options = [
    { label: translate('sessionCanvas.approval.allow', '允许'), send: 'y' },
    { label: translate('sessionCanvas.approval.deny', '拒绝'), send: 'n' }
  ]
  if (ALWAYS_RE.test(text)) {
    options.splice(1, 0, {
      label: translate('sessionCanvas.approval.allowAlways', '总是允许'),
      send: 'a'
    })
  }
  return { title, detail, options }
}

/** Approval options for a paused session; each option's `send` is written to the PTY as-is. */
export function resolveSessionApproval(entry: ApprovalInput): ChatApproval | null {
  if (entry.state !== 'waiting' && entry.state !== 'blocked') {
    return null
  }
  // Why: a structured question needs its answer keys, not approval keys.
  if (parseAskFromStatus(entry.interactivePrompt, entry.toolName)) {
    return null
  }
  // Why: the host-emitted request always wins; prose may hold an unrelated numbered list.
  return (
    parseApprovalFromStatus(entry.interactivePrompt) ??
    detectTextApproval(entry.lastAssistantMessage ?? '')
  )
}
