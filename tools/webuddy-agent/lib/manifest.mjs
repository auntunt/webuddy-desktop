/**
 * `scan --manifest <file>`: the app lists changed sessions (one JSON object per
 * line, see WebuddyManifestEntry in src/main/webuddy/vault-session-manifest.ts)
 * and this turns each line into the same record the legacy scan would build.
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

import { ACTIVE_CONSENT_SCOPE, isLocalDate, localDateOf, validateRecord } from './schema.mjs'
import { statTranscript } from './collectors.mjs'
import { enqueue } from './upload.mjs'
import { maskPath, redactLine } from './redact.mjs'
import { loadState, saveState, sha256File, STATE_VERSION } from './state.mjs'
import { attachRawTranscript, baseRecord, currentActor, withinWorkspace } from './scan.mjs'

export const CONVERSATION_FORMAT = 'webuddy.conversation.v1'

/** Redacts each message text whole, so a multi-line secret block still matches. */
export function redactConversation(conversation) {
  const applied = new Set()
  const messages = (Array.isArray(conversation) ? conversation : []).map((message) => {
    const result = redactLine(String(message?.text ?? ''))
    for (const id of result.applied) {
      applied.add(id)
    }
    return { role: message?.role ?? null, text: result.line, timestamp: message?.timestamp ?? null }
  })
  return { messages, rulesApplied: [...applied] }
}

export function conversationJsonl(messages) {
  return messages
    .map(({ role, text, timestamp }) => JSON.stringify({ role, text, timestamp }))
    .join('\n')
}

function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function nullableCount(value) {
  return Number.isFinite(value) ? value : 0
}

/** Everything but the transcript body; mirrors the legacy scan's field-for-field shape. */
export function recordFromEntry(entry, { actor, homeDir, scope, transcript }) {
  const durationMs = Number.isFinite(entry.durationMs)
    ? Math.max(0, entry.durationMs)
    : Math.max(0, new Date(entry.endedAt) - new Date(entry.startedAt)) || 0
  return baseRecord({
    actor,
    agent: {
      id: entry.agentId,
      label: entry.agentLabel,
      version: null,
      model: entry.model ?? null,
      provider: null
    },
    session: {
      id: entry.sessionId,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      durationMs,
      localDate: isLocalDate(entry.localDate) ? entry.localDate : localDateOf(entry.startedAt),
      turnCount: nullableCount(entry.turnCount),
      messageCount: nullableCount(entry.messageCount),
      tokens: { input: null, output: null, total: entry.tokensTotal || null }
    },
    // Why mask here: the manifest carries the raw cwd, which leaks the OS username.
    workspace: {
      cwd: maskPath(entry.cwd ?? null, homeDir),
      branch: entry.branch ?? null,
      repo: null
    },
    transcript: {
      path: maskPath(entry.filePath, homeDir),
      relPath: entry.relPath,
      ...transcript,
      conversationTruncated: entry.conversationTruncated === true
    },
    scope
  })
}

export function cursorKeyFor(entry) {
  return entry.transcriptFormat === 'raw-file'
    ? entry.filePath
    : `${entry.relPath}\u0000${entry.sessionId}`
}

async function processEntry(entry, ctx) {
  const { actor, config, homeDir, state, force, skipped } = ctx
  const scope = ACTIVE_CONSENT_SCOPE
  const key = cursorKeyFor(entry)
  const previous = state.files[key]
  const conversation = redactConversation(entry.conversation)
  const isRaw = entry.transcriptFormat === 'raw-file'

  let digest
  let info = null
  let conversationText = null
  if (isRaw) {
    info = await statTranscript(entry.filePath)
    if (!info) {
      skipped.unreadable += 1
      return null
    }
    digest = await sha256File(entry.filePath)
  } else {
    conversationText = conversationJsonl(conversation.messages)
    digest = sha256Text(conversationText)
  }
  if (!force && previous?.sha256 === digest && previous.record && previous.consentScope === scope) {
    skipped.unchanged += 1
    return null
  }

  const cursor = {
    ...(info ? { size: info.bytes, mtimeMs: info.mtimeMs } : {}),
    sha256: digest,
    consentScope: scope,
    lastSeenAt: new Date().toISOString()
  }
  if (!withinWorkspace(entry.cwd, config)) {
    skipped.filtered += 1
    state.files[key] = { ...cursor, record: null, skippedReason: 'outside-configured-workspaces' }
    return null
  }

  const transcript = isRaw
    ? {
        bytes: info.bytes,
        sha256: digest,
        format: entry.filePath.endsWith('.json') ? 'json' : 'jsonl'
      }
    : { bytes: Buffer.byteLength(conversationText), sha256: digest, format: CONVERSATION_FORMAT }
  const record = recordFromEntry(entry, { actor, homeDir, scope, transcript })
  let transcriptText = conversationText
  if (isRaw) {
    transcriptText = await attachRawTranscript(record, entry.filePath, config.maxTranscriptBytes)
  } else {
    record.redaction.transcriptTruncated = entry.conversationTruncated === true
  }
  record.redaction.rulesApplied = [
    ...new Set([...record.redaction.rulesApplied, ...conversation.rulesApplied])
  ].sort()

  const errors = validateRecord(record)
  if (errors.length > 0) {
    skipped.unreadable += 1
    process.stderr.write(`skip ${entry.relPath}: ${errors.join('; ')}\n`)
    return null
  }
  await enqueue(record, transcriptText, conversation.messages)
  state.files[key] = { ...cursor, record }
  return record
}

/**
 * Malformed lines are reported and counted as `invalid`; the caller exits
 * non-zero so the app keeps its cursor and retries the batch.
 */
export async function scanManifest(config, { manifestPath, force, json, homeDir }) {
  const actor = await currentActor(config)
  const state = await loadState()
  const emitted = []
  const skipped = { unchanged: 0, filtered: 0, unreadable: 0, invalid: 0 }
  const ctx = { actor, config, homeDir, state, force, skipped }
  let total = 0

  const stream = createReadStream(manifestPath, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (!line.trim()) {
        continue
      }
      total += 1
      let entry
      try {
        entry = JSON.parse(line)
      } catch {
        entry = null
      }
      if (!entry || typeof entry !== 'object' || !entry.sessionId || !entry.agentId) {
        skipped.invalid += 1
        process.stderr.write(`skip manifest line ${total}: not a manifest entry\n`)
        continue
      }
      const record = await processEntry(entry, ctx)
      if (record) {
        emitted.push(record)
        if (json) {
          process.stdout.write(`${JSON.stringify(record)}\n`)
        }
      }
    }
  } finally {
    rl.close()
    stream.close()
    state.version = STATE_VERSION
    await saveState(state)
  }
  return { actor, emitted, skipped, total }
}
