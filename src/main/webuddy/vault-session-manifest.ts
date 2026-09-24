/**
 * Pure mapping from an AI Vault session (+ its conversation) to one webuddy
 * collection manifest line. No I/O: callers own listing sessions, reading
 * conversations, and writing the JSONL file.
 */

import { relative as nodeRelative } from 'node:path'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { AI_VAULT_AGENT_LABELS, type AiVaultSession } from '../../shared/ai-vault-types'
import type { AiVaultConversationResult } from '../ai-vault/session-conversation-window'

export type WebuddyManifestTranscriptFormat = 'raw-file' | 'webuddy.conversation.v1'

export type WebuddyManifestEntry = {
  agentId: string
  agentLabel: string
  sessionId: string
  filePath: string
  relPath: string
  transcriptFormat: WebuddyManifestTranscriptFormat
  startedAt: string
  endedAt: string
  durationMs: number | null
  messageCount: number
  turnCount: number
  /** Set when the transcript was too large for the full window: turnCount
   * only reflects the head+tail messages actually returned. */
  turnCountApproximate?: true
  tokensTotal: number | null
  model: string | null
  cwd: string | null
  branch: string | null
  /** YYYY-MM-DD in `timeZone`, derived from startedAt (server-side compat aid). */
  localDate: string
  conversation: AiVaultConversationResult['messages']
  conversationTruncated: boolean
}

export type RelativePathFn = (from: string, to: string) => string

export type ToManifestEntryOptions = {
  homeDir: string
  timeZone?: string
  /** Injectable for tests that simulate a foreign platform's path rules. */
  pathModule?: { relative: RelativePathFn }
}

// Dedupe-compat: the already-uploaded claude-code rows use this id, not the
// AI Vault agent id 'claude'. Every other agent id is carried through as-is
// (constraints.md: "codex 不变，其余 id 原样").
function toWebuddyAgentId(agent: AiVaultSession['agent']): string {
  return agent === 'claude' ? 'claude-code' : agent
}

function toWebuddyAgentLabel(agent: AiVaultSession['agent']): string {
  return agent === 'claude' ? 'Claude Code' : AI_VAULT_AGENT_LABELS[agent]
}

/**
 * Matches `tools/webuddy-agent/lib/collectors.mjs:222`'s
 * `relative(homeDir, filePath)` exactly for native paths. A WSL UNC path
 * (`\\wsl.localhost\<Distro>\...`) has no meaningful relation to the host's
 * homeDir, so it gets the `wsl:<distro>/...` prefix instead of guessing.
 */
function toRelPath(
  filePath: string,
  homeDir: string,
  pathModule: { relative: RelativePathFn }
): string {
  const wsl = parseWslUncPath(filePath)
  if (wsl) {
    return `wsl:${wsl.distro}/${wsl.linuxPath.replace(/^\/+/, '')}`
  }
  return pathModule.relative(homeDir, filePath)
}

/** The basename's extension, tolerant of both `/` and `\` separators. */
function fileExtensionOf(filePath: string): string {
  const base = filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
  const dotIndex = base.lastIndexOf('.')
  return dotIndex === -1 ? '' : base.slice(dotIndex).toLowerCase()
}

/**
 * Database-backed agents (OpenCode SQLite, Devin, Cursor, ...) address one
 * row inside a shared store rather than a standalone transcript file: their
 * filePath either isn't a plain .jsonl/.json file, or carries a `#` row
 * suffix (e.g. `<dbPath>#<sessionId>`).
 */
function transcriptFormatFor(filePath: string): WebuddyManifestTranscriptFormat {
  if (filePath.includes('#')) {
    return 'webuddy.conversation.v1'
  }
  const ext = fileExtensionOf(filePath)
  return ext === '.jsonl' || ext === '.json' ? 'raw-file' : 'webuddy.conversation.v1'
}

function clampNonNegative(value: number): number {
  return Math.max(0, value)
}

function localDateOf(iso: string, timeZone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    // ISO-ish fallback: keep the first 10 chars if they look like a date.
    return iso.slice(0, 10)
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

export function toManifestEntry(
  session: AiVaultSession,
  conversation: AiVaultConversationResult,
  options: ToManifestEntryOptions
): WebuddyManifestEntry {
  const pathModule = options.pathModule ?? { relative: nodeRelative }
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone

  const firstMessageAt = conversation.messages[0]?.timestamp ?? null
  const lastMessageAt = conversation.messages.at(-1)?.timestamp ?? null
  const startedAt = session.createdAt ?? firstMessageAt ?? session.modifiedAt
  const endedAt = session.updatedAt ?? lastMessageAt ?? session.modifiedAt

  const startedMs = Date.parse(startedAt)
  const endedMs = Date.parse(endedAt)
  const durationMs =
    Number.isFinite(startedMs) && Number.isFinite(endedMs)
      ? clampNonNegative(endedMs - startedMs)
      : null

  const turnCount = conversation.messages.filter((message) => message.role === 'user').length

  const entry: WebuddyManifestEntry = {
    agentId: toWebuddyAgentId(session.agent),
    agentLabel: toWebuddyAgentLabel(session.agent),
    sessionId: session.sessionId,
    filePath: session.filePath,
    relPath: toRelPath(session.filePath, options.homeDir, pathModule),
    transcriptFormat: transcriptFormatFor(session.filePath),
    startedAt,
    endedAt,
    durationMs,
    messageCount: session.messageCount,
    turnCount,
    tokensTotal: session.totalTokens || null,
    model: session.model,
    cwd: session.cwd,
    branch: session.branch,
    localDate: localDateOf(startedAt, timeZone),
    conversation: conversation.messages,
    conversationTruncated: conversation.truncated
  }
  if (conversation.truncated) {
    entry.turnCountApproximate = true
  }
  return entry
}
