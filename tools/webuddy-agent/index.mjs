#!/usr/bin/env node
/**
 * webuddy-agent — collects local coding-agent sessions into normalized,
 * attributable records and (optionally) ships them to the Webuddy server.
 *
 * Usage:
 *   webuddy-agent login [--username <u>] [--json]
 *   webuddy-agent scan --manifest <file> [--json] [--force]
 *   webuddy-agent scan [--json] [--force]   (deprecated discovery scan)
 *   webuddy-agent status
 *   webuddy-agent push
 *   webuddy-agent config show
 *   webuddy-agent config set <key>=<value>
 *
 * Nothing leaves the machine until `endpoint` is configured AND `push` runs.
 * The transcript body always ships with the record (redacted first) — this is
 * team-management data, not an opt-in.
 */

import { homedir, hostname } from 'node:os'

import { AGENTS, SCHEMA_VERSION } from './lib/schema.mjs'
import { login } from './lib/login.mjs'
import { pendingCount, pushPending } from './lib/upload.mjs'
import { scanDiscovered } from './lib/scan.mjs'
import { manifestSummary, scanManifest } from './lib/manifest.mjs'
import {
  ensureDeviceId,
  loadConfig,
  loadState,
  paths,
  saveConfig,
  writeJson
} from './lib/state.mjs'

const homeDir = process.env.WEBUDDY_HOME || homedir()
const VALUE_FLAGS = new Set(['--manifest'])

function parseArgs(argv) {
  const flags = new Set()
  const values = new Map()
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg : arg.slice(0, eq)
    flags.add(name)
    if (eq !== -1) {
      values.set(name, arg.slice(eq + 1))
    } else if (VALUE_FLAGS.has(name) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      values.set(name, argv[++i])
    }
  }
  return { flags, values, positional }
}

async function main() {
  const [, , command = 'status', ...rest] = process.argv
  const { flags, values, positional } = parseArgs(rest)
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
    const options = { force: flags.has('--force'), json: flags.has('--json'), homeDir }
    if (flags.has('--manifest')) {
      const manifestPath = values.get('--manifest')
      if (!manifestPath) {
        process.stderr.write('usage: webuddy-agent scan --manifest <file>\n')
        process.exitCode = 2
        return
      }
      const result = await scanManifest(config, { ...options, manifestPath })
      process.stdout.write(`${JSON.stringify(manifestSummary(result))}\n`)
      return
    }
    process.stderr.write(
      'webuddy-agent: discovery `scan` is deprecated; the app now uses `scan --manifest <file>`\n'
    )
    const result = await scanDiscovered(config, options)
    if (!flags.has('--json')) {
      process.stdout.write(
        `${[
          `actor:    ${result.actor.userId} @ ${result.actor.deviceLabel} (${result.actor.deviceId})`,
          `agents:   ${AGENTS.map((agent) => agent.id).join(', ')}`,
          `scanned:  ${result.total} session(s)`,
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
    try {
      const deviceId = await ensureDeviceId()
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
