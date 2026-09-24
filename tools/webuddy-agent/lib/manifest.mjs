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
import { maskPath, maskWslPath, redactLine } from './redact.mjs'
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
  // Why two maskers: a WSL session's paths live under the distro user's home, not ours.
  const mask = entry.relPath.startsWith('wsl:')
    ? (value) => maskWslPath(value)
    : (value) => maskPath(value, homeDir)
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
      cwd: mask(entry.cwd ?? null),
      branch: entry.branch ?? null,
      repo: null
    },
    transcript: {
      path: mask(entry.filePath),
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

const REQUIRED_FIELDS = ['agentId', 'sessionId', 'filePath', 'relPath', 'transcriptFormat']
const FORMATS = new Set(['raw-file', CONVERSATION_FORMAT])

export function entryProblem(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return 'not a JSON object'
  }
  const missing = REQUIRED_FIELDS.filter((key) => typeof entry[key] !== 'string' || !entry[key])
  if (missing.length > 0) {
    return `missing ${missing.join(', ')}`
  }
  return FORMATS.has(entry.transcriptFormat) ? null : `unknown transcriptFormat`
}

function errorText(error) {
  return error?.code ?? error?.message ?? String(error)
}

async function processEntry(entry, ctx) {
  const { actor, config, homeDir, state, force, counts, io } = ctx
  const scope = ACTIVE_CONSENT_SCOPE
  const key = cursorKeyFor(entry)
  const previous = state.files[key]
  const isRaw = entry.transcriptFormat === 'raw-file'
  const hasConversation = Array.isArray(entry.conversation) && entry.conversation.length > 0
  const unreadable = (reason) => {
    counts.unreadable += 1
    process.stderr.write(`skip ${entry.relPath}: ${reason}\n`)
    return null
  }

  let digest
  let info = null
  let conversation = null
  let conversationText = null
  if (isRaw) {
    try {
      info = await io.stat(entry.filePath)
      digest = info ? await io.sha256File(entry.filePath) : null
    } catch (error) {
      return unreadable(errorText(error))
    }
    if (!info) {
      return unreadable('transcript file not found')
    }
  } else {
    conversation = redactConversation(entry.conversation)
    conversationText = conversationJsonl(conversation.messages)
    digest = sha256Text(conversationText)
  }
  // Why conversationSent: rows the legacy scan already sent share this cursor
  // but never carried a conversation; each must be re-sent once to backfill it.
  const unchanged =
    previous?.sha256 === digest &&
    previous.record &&
    previous.consentScope === scope &&
    (previous.conversationSent || !hasConversation)
  if (!force && unchanged) {
    counts.unchanged += 1
    return null
  }

  const cursor = {
    ...(info ? { size: info.bytes, mtimeMs: info.mtimeMs } : {}),
    sha256: digest,
    consentScope: scope,
    lastSeenAt: new Date().toISOString()
  }
  if (!withinWorkspace(entry.cwd, config)) {
    counts.filtered += 1
    state.files[key] = { ...cursor, record: null, skippedReason: 'outside-configured-workspaces' }
    return null
  }

  conversation ??= redactConversation(entry.conversation)
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
    try {
      transcriptText = await io.attachRawTranscript(
        record,
        entry.filePath,
        config.maxTranscriptBytes
      )
    } catch (error) {
      return unreadable(errorText(error))
    }
  } else {
    record.redaction.transcriptTruncated = entry.conversationTruncated === true
  }
  record.redaction.rulesApplied = [
    ...new Set([...record.redaction.rulesApplied, ...conversation.rulesApplied])
  ].sort()

  const errors = validateRecord(record)
  if (errors.length > 0) {
    return unreadable(errors.join('; '))
  }
  // Outbox write failures are run-level: they propagate and fail the whole scan.
  await enqueue(record, transcriptText, conversation.messages)
  state.files[key] = { ...cursor, record, conversationSent: hasConversation }
  return record
}

const DEFAULT_IO = { stat: statTranscript, sha256File, attachRawTranscript }

/**
 * Per-entry problems are counted and reported on stderr; only run-level
 * failures (manifest unreadable, outbox or state write) throw, so the caller
 * exits non-zero and the app keeps its cursor.
 */
export async function scanManifest(
  config,
  { manifestPath, force, json, homeDir, io = DEFAULT_IO }
) {
  const actor = await currentActor(config)
  const state = await loadState()
  const emitted = []
  const counts = { unchanged: 0, filtered: 0, unreadable: 0, invalid: 0 }
  const ctx = { actor, config, homeDir, state, force, counts, io: { ...DEFAULT_IO, ...io } }
  let total = 0

  // Streamed: a first-run manifest can be hundreds of MB.
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
      const problem = entryProblem(entry)
      if (problem) {
        counts.invalid += 1
        process.stderr.write(`skip manifest line ${total}: ${problem}\n`)
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
  return { actor, emitted, skipped: counts, total }
}

export function manifestSummary(result) {
  const { unchanged, filtered, invalid, unreadable } = result.skipped
  return {
    emitted: result.emitted.length,
    skipped: unchanged + filtered,
    invalid,
    unreadable
  }
}
