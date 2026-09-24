/**
 * Legacy discovery scan: walks the known agent roots under the home directory,
 * parses each transcript and queues one record per changed session.
 *
 * The app now drives collection through `scan --manifest` (see manifest.mjs);
 * this path stays for command-line users for one more version.
 */

import { createReadStream } from 'node:fs'
import { hostname, platform, userInfo } from 'node:os'
import { basename } from 'node:path'
import { createInterface } from 'node:readline'

import {
  ACTIVE_CONSENT_SCOPE,
  CONSENT_SCOPES,
  REDACTION_POLICY_VERSION,
  buildActor,
  buildSessionRecord,
  localDateOf,
  validateRecord
} from './schema.mjs'
import { collectorFor, discoverSessions, statTranscript } from './collectors.mjs'
import { enqueue } from './upload.mjs'
import { maskPath, redactTranscript } from './redact.mjs'
import { ensureDeviceId, loadState, saveState, sha256File, STATE_VERSION } from './state.mjs'

export const COLLECTOR_VERSION = '0.1.0'

export function withinWorkspace(cwd, config) {
  if (!cwd) {
    return !config.includeWorkspaces?.length
  }
  const includes = config.includeWorkspaces ?? []
  const excludes = config.excludeWorkspaces ?? []
  if (excludes.some((prefix) => cwd.startsWith(prefix))) {
    return false
  }
  if (includes.length === 0) {
    return true
  }
  return includes.some((prefix) => cwd.startsWith(prefix))
}

export async function readTranscriptText(path, limit) {
  const chunks = []
  let size = 0
  const stream = createReadStream(path, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    size += Buffer.byteLength(line) + 1
    if (size > limit) {
      break
    }
    chunks.push(line)
  }
  rl.close()
  stream.close()
  const truncated = size > limit
  return { text: chunks.join('\n'), truncated }
}

export async function currentActor(config) {
  const deviceId = await ensureDeviceId()
  return buildActor({
    config,
    deviceId,
    hostname: hostname(),
    osUser: userInfo().username,
    platform: platform()
  })
}

/** Reads + redacts a transcript file into `record` exactly as the legacy scan always has. */
export async function attachRawTranscript(record, path, maxBytes) {
  const raw = await readTranscriptText(path, maxBytes)
  const redacted = redactTranscript(raw.text)
  record.redaction.rulesApplied = redacted.rulesApplied
  record.redaction.transcriptTruncated = raw.truncated
  return redacted.text
}

export function baseRecord({ actor, agent, session, workspace, transcript, scope }) {
  return buildSessionRecord({
    actor,
    agent,
    session,
    workspace,
    transcript,
    collection: { collectedAt: new Date().toISOString(), collectorVersion: COLLECTOR_VERSION },
    redaction: {
      policyVersion: REDACTION_POLICY_VERSION,
      rulesApplied: [],
      transcriptTruncated: false
    },
    consent: { scope }
  })
}

function sessionIdFor(path, parsed) {
  return parsed.sessionId || basename(path, '.jsonl')
}

export async function scanDiscovered(config, { force, json, homeDir }) {
  const actor = await currentActor(config)
  const state = await loadState()
  const candidates = await discoverSessions({ homeDir, config })
  const emitted = []
  const skipped = { unchanged: 0, filtered: 0, unreadable: 0 }

  for (const candidate of candidates) {
    const collector = collectorFor(candidate.agentId)
    if (!collector) {
      skipped.unreadable += 1
      continue
    }
    const info = await statTranscript(candidate.path)
    if (!info) {
      skipped.unreadable += 1
      continue
    }
    // Transcript bodies are always collected; there is no reduced mode.
    const scope = ACTIVE_CONSENT_SCOPE
    const previous = state.files[candidate.path]
    const unchanged =
      previous &&
      previous.size === info.bytes &&
      previous.mtimeMs === info.mtimeMs &&
      // Why scope participates in the cursor: if the collection mode ever
      // changes, the session must be re-emitted rather than staying "unchanged".
      previous.consentScope === scope
    if (unchanged && !force && previous.record) {
      skipped.unchanged += 1
      continue
    }

    const digest = await sha256File(candidate.path)
    if (
      !force &&
      previous?.sha256 === digest &&
      previous.record &&
      previous.consentScope === scope
    ) {
      skipped.unchanged += 1
      state.files[candidate.path] = { ...previous, mtimeMs: info.mtimeMs }
      continue
    }

    const parsed = await collector.parse(candidate.path, { homeDir })
    if (!withinWorkspace(parsed.cwd, config)) {
      skipped.filtered += 1
      state.files[candidate.path] = {
        size: info.bytes,
        mtimeMs: info.mtimeMs,
        sha256: digest,
        record: null,
        consentScope: scope,
        skippedReason: 'outside-configured-workspaces',
        lastSeenAt: new Date().toISOString()
      }
      continue
    }

    const startedAt = parsed.startedAt ?? new Date(info.mtimeMs).toISOString()
    const endedAt = parsed.endedAt ?? startedAt
    const record = baseRecord({
      actor,
      agent: {
        id: candidate.agentId,
        label: candidate.agentLabel,
        version: parsed.agentVersion,
        model: parsed.model,
        provider: null
      },
      session: {
        id: sessionIdFor(candidate.path, parsed),
        startedAt,
        endedAt,
        durationMs: Math.max(0, new Date(endedAt) - new Date(startedAt)),
        localDate: localDateOf(startedAt),
        turnCount: parsed.turnCount,
        messageCount: parsed.messageCount,
        tokens: parsed.tokens
      },
      workspace: { cwd: maskPath(parsed.cwd, homeDir), branch: parsed.branch, repo: null },
      transcript: {
        path: maskPath(candidate.path, homeDir),
        relPath: candidate.relPath,
        bytes: info.bytes,
        sha256: digest,
        format: 'jsonl'
      },
      scope
    })

    let transcriptText = null
    if (scope === CONSENT_SCOPES.full) {
      transcriptText = await attachRawTranscript(record, candidate.path, config.maxTranscriptBytes)
    }

    const errors = validateRecord(record)
    if (errors.length > 0) {
      skipped.unreadable += 1
      process.stderr.write(`skip ${candidate.relPath}: ${errors.join('; ')}\n`)
      continue
    }

    await enqueue(record, transcriptText)
    state.files[candidate.path] = {
      size: info.bytes,
      mtimeMs: info.mtimeMs,
      sha256: digest,
      record,
      consentScope: scope,
      lastSeenAt: new Date().toISOString()
    }
    emitted.push(record)
    if (json) {
      process.stdout.write(`${JSON.stringify(record)}\n`)
    }
  }

  state.version = STATE_VERSION
  await saveState(state)
  return { actor, emitted, skipped, total: candidates.length }
}
