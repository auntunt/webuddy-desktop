#!/usr/bin/env node
/**
 * webuddy-agent — collects local coding-agent sessions into normalized,
 * attributable records and (optionally) ships them to the Webuddy server.
 *
 * Usage:
 *   webuddy-agent login [--username <u>] [--json]
 *   webuddy-agent scan [--json] [--force]
 *   webuddy-agent status
 *   webuddy-agent push
 *   webuddy-agent config show
 *   webuddy-agent config set <key>=<value>
 *
 * Nothing leaves the machine until `endpoint` is configured AND `push` runs.
 * The transcript body always ships with the record (redacted first) — this is
 * team-management data, not an opt-in.
 */

import { createReadStream } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { basename } from 'node:path'
import { createInterface } from 'node:readline'
import { platform } from 'node:os'
import { userInfo } from 'node:os'

import {
  ACTIVE_CONSENT_SCOPE,
  AGENTS,
  CONSENT_SCOPES,
  REDACTION_POLICY_VERSION,
  SCHEMA_VERSION,
  buildActor,
  buildSessionRecord,
  localDateOf,
  timeZoneOffsetMinutes,
  validateRecord
} from './lib/schema.mjs'
import { collectorFor, discoverSessions, statTranscript } from './lib/collectors.mjs'
import { login } from './lib/login.mjs'
import { enqueue, pendingCount, pushPending } from './lib/upload.mjs'
import { maskPath, redactTranscript } from './lib/redact.mjs'
import {
  ensureDeviceId,
  loadConfig,
  loadState,
  paths,
  saveConfig,
  saveState,
  sha256File,
  STATE_VERSION,
  writeJson
} from './lib/state.mjs'

const COLLECTOR_VERSION = '0.1.0'
const homeDir = process.env.WEBUDDY_HOME || homedir()

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')))
  const positional = argv.filter((arg) => !arg.startsWith('--'))
  return { flags, positional }
}

function withinWorkspace(cwd, config) {
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

async function readTranscriptText(path, limit) {
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

function sessionIdFor(path, parsed) {
  return parsed.sessionId || basename(path, '.jsonl')
}

async function scan(config, { force, json }) {
  const deviceId = await ensureDeviceId()
  const actor = buildActor({
    config,
    deviceId,
    hostname: (await import('node:os')).hostname(),
    osUser: userInfo().username,
    platform: platform()
  })
  const state = await loadState()
  const offsetMinutes = timeZoneOffsetMinutes()
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
    const record = buildSessionRecord({
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
        localDate: localDateOf(startedAt, offsetMinutes),
        turnCount: parsed.turnCount,
        messageCount: parsed.messageCount,
        tokens: parsed.tokens
      },
      workspace: {
        cwd: maskPath(parsed.cwd, homeDir),
        branch: parsed.branch,
        repo: null
      },
      transcript: {
        path: maskPath(candidate.path, homeDir),
        relPath: candidate.relPath,
        bytes: info.bytes,
        sha256: digest,
        format: 'jsonl'
      },
      collection: {
        collectedAt: new Date().toISOString(),
        collectorVersion: COLLECTOR_VERSION
      },
      redaction: {
        policyVersion: REDACTION_POLICY_VERSION,
        rulesApplied: [],
        transcriptTruncated: false
      },
      consent: { scope }
    })

    let transcriptText = null
    if (scope === CONSENT_SCOPES.full) {
      const raw = await readTranscriptText(candidate.path, config.maxTranscriptBytes)
      const redacted = redactTranscript(raw.text)
      transcriptText = redacted.text
      record.redaction.rulesApplied = redacted.rulesApplied
      record.redaction.transcriptTruncated = raw.truncated
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

async function main() {
  const [, , command = 'status', ...rest] = process.argv
  const { flags, positional } = parseArgs(rest)
  const config = await loadConfig()

  if (command === 'login') {
    const result = await login({
      username: positional[0] ?? process.env.WEBUDDY_LOGIN_USER,
      password: process.env.WEBUDDY_LOGIN_PASSWORD,
      label: `cli:${hostname()}`,
      json: flags.has('--json')
    })
    if (flags.has('--json')) {
      process.stdout.write(`${JSON.stringify(result)}\n`)
    } else {
      process.stdout.write(
        [
          `已登录: ${result.user.displayName ?? result.user.username} (${result.user.role})`,
          `token:  ${result.tokenPrefix}…（已写入 ${result.configPath}，权限 600）`,
          `归属:   之后所有记录都会记在 ${result.user.username} 名下`,
          ''
        ].join('\n')
      )
    }
    return
  }

  if (command === 'scan') {
    const result = await scan(config, {
      force: flags.has('--force'),
      json: flags.has('--json')
    })
    if (!flags.has('--json')) {
      process.stdout.write(
        `${[
          `actor:    ${result.actor.userId} @ ${result.actor.deviceLabel} (${result.actor.deviceId})`,
          `agents:   ${AGENTS.map((agent) => agent.id).join(', ')}`,
          `scanned:  ${result.total} transcript file(s)`,
          `recorded: ${result.emitted.length}`,
          `skipped:  ${result.skipped.unchanged} unchanged, ${result.skipped.filtered} outside workspace, ${result.skipped.unreadable} unreadable`,
          `consent:  正文随记录一起发送（脱敏后）`,
          `outbox:   ${await pendingCount()} record(s) queued at ${paths.outbox}`
        ].join('\n')}\n`
      )
    }
    return
  }

  if (command === 'status') {
    const state = await loadState()
    const tracked = Object.keys(state.files).length
    const lastRecord = Object.values(state.files)
      .map((entry) => entry.record?.collectedAt)
      .filter(Boolean)
      .sort()
      .at(-1)
    process.stdout.write(
      `${[
        `schema:        ${SCHEMA_VERSION}`,
        `state dir:     ${paths.dir}`,
        `user:          ${config.userId || '(unset — scan will refuse)'}`,
        `endpoint:      ${config.endpoint || '(unset — local only)'}`,
        `consent:       正文随记录一起发送（脱敏后）`,
        `tracked files: ${tracked}`,
        `queued:        ${await pendingCount()}`,
        `last collect:  ${lastRecord ?? 'never'}`
      ].join('\n')}\n`
    )
    return
  }

  if (command === 'push') {
    const deviceId = await ensureDeviceId()
    try {
      const result = await pushPending({
        endpoint: config.endpoint,
        token: config.token,
        deviceId
      })
      await writeJson(paths.lastPush, {
        at: new Date().toISOString(),
        authRejected: false,
        ...result
      })
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    } catch (error) {
      await writeJson(paths.lastPush, {
        at: new Date().toISOString(),
        pushed: 0,
        failed: 0,
        exhausted: 0,
        authRejected: false,
        error: String(error?.message ?? error)
      })
      throw error
    }
    return
  }

  if (command === 'config') {
    const [sub, assignment] = positional
    if (sub === 'set' && assignment) {
      const index = assignment.indexOf('=')
      if (index === -1) {
        process.stderr.write('usage: webuddy-agent config set key=value\n')
        process.exitCode = 2
        return
      }
      const key = assignment.slice(0, index)
      const raw = assignment.slice(index + 1)
      const value = raw.includes(',') ? raw.split(',') : raw
      await saveConfig({ ...config, [key]: value })
      process.stdout.write(`set ${key}\n`)
      return
    }
    process.stdout.write(
      `${JSON.stringify({ ...config, token: config.token ? '***' : '' }, null, 2)}\n`
    )
    return
  }

  process.stderr.write(`unknown command: ${command}\n`)
  process.exitCode = 2
}

main().catch((error) => {
  process.stderr.write(`webuddy-agent failed: ${error?.message ?? error}\n`)
  process.exitCode = 1
})
